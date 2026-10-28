import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = { name: "example.audited", v: 1, summary: "Audited mutation", permission: null, level: "view", resource: { type: "space" }, effects: "write", idempotency: "natural", risk: "medium", audit: "always", emits: ["example.changed"], input: {}, output: {}, examples: [], errors: [], surfaces: {} } as unknown as CapabilityDef;

test("booted mutations reach audit.list with attribution and no credential inputs; members cannot forge rows", async () => {
  const core = bootCore();
  const grant = core.store.appendBatch([{ id: "evt_audit_agent_grant", type: "grant.created", sv: 1, trace_id: "c0".repeat(16), actor: "svc_seed", vis: "space", entity: "grant", entity_id: "gnt_auditscout", payload: { id: "gnt_auditscout", subject_kind: "actor", subject_id: "agt_scout", resource_type: "space", resource_id: CORE_SPACE, level: "view", by: "usr_olivia" } }]);
  assert.ok(grant.every((item) => item.ok));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-daemon-audit-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db")); core.close();
  let token = "";
  const daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.0.0-test"),
    platform: fakePlatform({ os: "linux", hostname: "audit-test", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"apps":{"http":{}}}' }),
    session: (headers) => {
      if (headers["authorization"] !== `Bearer ${token}`) return null;
      const as = headers["x-test-as"];
      const principal = as === "agent" ? { kind: "agent" as const, id: "agt_scout" } : { kind: "person" as const, id: as === "member" ? "usr_sana" : as === "guest" ? "usr_tess" : "usr_olivia" };
      return { space: CORE_SPACE, principal, ...(as === "agent" ? { actingFor: "usr_olivia" } : {}), device: "test-device" };
    },
    extra: { caps: [cap], routes: [{ method: "POST", path: "/v1/example/audited", cap: cap.name, v: 1, effects: "write" }], events: ["example.changed"], handlers: { "example.audited": (ctx) => { ctx.emit("example.changed" as never, "test:1", { changed: true }); return { ok: true }; } } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
  token = daemon.token;
  const call = (endpoint: string, body?: unknown, as = "owner") => fetch(`${daemon.url}${endpoint}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-test-as": as }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  try {
    const made = await call("/v1/access/roles/create", { name: "Audit role proof", cloneFrom: "rol_member", idempotencyKey: "audit-role" });
    assert.equal(made.status, 200, await made.clone().text());
    const listed = await call("/v1/audit/list", { action: "access.roles.create" });
    assert.equal(listed.status, 200, await listed.clone().text());
    const rows = ((await listed.json()) as { data: { rows: Array<{ actor: { kind: string; id: string }; action: string; after?: { targets?: { kind: string; id: string }[] } }> } }).data.rows;
    assert.ok(rows.some((row) => row.action === "access.roles.create" && row.actor.kind === "person" && row.actor.id === "usr_olivia"));
    const role = ((await made.json()) as { data: { role: { id: string } } }).data.role;
    assert.ok(rows.some((row) => row.after?.targets?.some((target) => target.kind === "role" && target.id === role.id)), "object Activity can find the created role by declared target id");
    assert.ok(!JSON.stringify(rows).includes("Audit role proof"), "arbitrary role labels are not copied from inputs");
    const targetRows = ((await (await call("/v1/audit/list", { target: { kind: "role", id: role.id }, limit: 10 })).json()) as { data: { rows: { action: string }[] } }).data.rows;
    assert.deepEqual(targetRows.map((row) => row.action), ["access.roles.create"]);
    for (const as of ["member", "guest"]) assert.equal((await call("/v1/audit/list", { target: { kind: "role", id: role.id } }, as)).status, 403, "target filtering cannot grant audit.read");
    const actorResponse = await call("/v1/access/actors/create", { name: "Actor target proof", provider: "codex", roleIds: ["rol_member"], idempotencyKey: "audit-actor" });
    assert.equal(actorResponse.status, 200, "create the outside actor without printing its one-time credential");
    const actor = ((await actorResponse.json()) as { data: { actor: { id: string }; oneTimeToken: string } }).data;
    assert.equal((await call("/v1/access/actors/update", { actorId: actor.actor.id, provider: "claude" })).status, 200);
    assert.equal((await call("/v1/access/actors/set_engineer_mcp", { actorId: actor.actor.id, enabled: true })).status, 200);
    assert.equal((await call("/v1/access/actors/revoke", { actorId: actor.actor.id })).status, 200);
    const actorHistory = ((await (await call("/v1/audit/list", { target: { kind: "actor", id: actor.actor.id }, limit: 20 })).json()) as { data: { rows: { action: string }[] } }).data.rows;
    for (const action of ["access.actors.create", "access.actors.update", "access.actors.set_engineer_mcp", "access.actors.revoke"]) assert.ok(actorHistory.some((row) => row.action === action), action);
    assert.ok(!JSON.stringify(daemon.db!.all("SELECT * FROM audit_row")).includes(actor.oneTimeToken), "one-time actor credentials never enter audit metadata");
    assert.equal((await call("/v1/example/audited", { password: "synthetic-secret-password", apiKey: "synthetic-secret-api-key", arbitrary: "do-not-log-input" }, "agent")).status, 200);
    const attribution = ((await (await call("/v1/audit/list", { action: "example.audited" })).json()) as { data: { rows: Array<{ actor: { kind: string; id: string }; onBehalfOf?: { kind: string; id: string }; after: Record<string, unknown> }> } }).data.rows;
    assert.equal(attribution.length, 1, "one pipeline row, with no recursive append calls");
    assert.deepEqual(attribution[0]!.actor, { kind: "agent", id: "agt_scout" });
    assert.deepEqual(attribution[0]!.onBehalfOf, { kind: "person", id: "usr_olivia" });
    assert.deepEqual(Object.keys(attribution[0]!.after).sort(), ["capabilityVersion", "decisionId", "outcome", "reason", "risk"]);
    const stored = JSON.stringify(daemon.db!.all("SELECT * FROM audit_row"));
    for (const secret of ["synthetic-secret-password", "synthetic-secret-api-key", "do-not-log-input"]) assert.ok(!stored.includes(secret));
    for (const as of ["member", "guest"]) {
      const forged = await call("/v1/audit/append", { action: "forged", class: "admin", onBehalfOf: { kind: "person", id: "usr_olivia" } }, as);
      assert.ok(forged.status === 403 || forged.status === 404);
    }
    assert.equal(daemon.db!.all("SELECT id FROM audit_row WHERE action = ?", "forged").length, 0);
  } finally { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
