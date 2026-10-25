// P-H_17: the seeded Space has real role grants. Used as it is (no extra events added by the test), the owner manages the Space, a member edits it, an agent has a grant of its own, and a temp
// person holds nothing until someone gives her something. Checked on the access snapshot and through the gateway of a booted daemon with a real token (ruling 27), including a refusal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authorize } from "../../kernel/src/authorize/index.ts";
import type { Req } from "../../kernel/src/authorize/index.ts";
import { bootCore, coreEvents, CORE_SPACE, ROLE_SPACE_LEVEL } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const NOW = 1_790_000_000_000;
const space = { type: "space", id: CORE_SPACE };

test("seed grants: the recipe holds a Space grant per role (temp none) and one per agent, and nothing else is added", () => {
  const grants = coreEvents().filter((e) => e.type === "grant.created").map((e) => e.payload as { id: string; subject_kind: string; subject_id: string; resource_id: string; level: string });
  const roleGrants = grants.filter((g) => g.subject_kind === "role");
  assert.deepEqual(roleGrants.map((g) => [g.subject_id, g.level]), [...ROLE_SPACE_LEVEL]);
  assert.ok(roleGrants.every((g) => g.resource_id === CORE_SPACE));
  assert.ok(!roleGrants.some((g) => g.subject_id === "temp"), "temp holds no Space grant");
  assert.deepEqual(grants.filter((g) => g.subject_kind === "actor" && g.resource_id === CORE_SPACE).map((g) => g.subject_id).sort(), ["agt_helper", "agt_scout"]);
});

test("seed grants: on the seed as it is, the owner manages the Space, a member edits it and cannot manage, an agent edits for its owner, a temp person has no access", () => {
  const c = bootCore();
  try {
    const can = (principal: string, perm: string | null, level: Req["action"]["level"], actingFor?: string): string =>
      authorize(c.snapshot, { principal, ...(actingFor ? { actingFor } : {}), action: { perm, level }, resource: space, now: NOW }).effect;
    assert.equal(can("usr_olivia", "schema.manage", "manage"), "allow", "the owner manages the Space");
    assert.equal(can("usr_adam", "schema.manage", "manage"), "allow", "an admin manages the Space");
    assert.equal(can("usr_noah", "records.edit", "edit"), "allow", "a member edits");
    assert.equal(can("usr_noah", "schema.manage", "edit"), "deny", "but the member role lacks schema.manage");
    assert.equal(can("usr_noah", null, "manage"), "deny", "and holds no manage grant on the Space");
    assert.equal(can("agt_scout", "records.edit", "edit", "usr_noah"), "allow", "an agent edits for its owner");
    assert.equal(can("usr_tess", "records.edit", "view"), "deny", "a temp person holds nothing on the Space itself");
  } finally { c.close(); }
});

function dataDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-seed-grants-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("seed grants: through the gateway of a booted daemon, the owner and a member are let through, the member cannot apply schema, a temp person is refused", async () => {
  const dir = dataDir();
  const tokens: Record<string, string> = { "tok-usr_olivia": "usr_olivia", "tok-usr_noah": "usr_noah", "tok-usr_tess": "usr_tess" };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "seed-grants", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const who = tokens[/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? ""];
      return who === undefined ? null : { space: CORE_SPACE, principal: { kind: "person", id: who }, device: "seed-grants" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string, p: string, body: unknown) => fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    assert.notEqual((await post("tok-usr_olivia", "/v1/schema/types/list", {})).status, 403, "the owner is let through");
    assert.notEqual((await post("tok-usr_noah", "/v1/schema/types/list", {})).status, 403, "a member is let through");
    const refused = await post("tok-usr_tess", "/v1/schema/types/list", {});
    assert.equal(refused.status, 403, "a temp person with no grant is refused");
    const apply = (token: string, key: string) => post(token, "/v1/schema/apply", { idempotencyKey: key, ops: [{ op: "type.create", type: "rt_seedgrants", def: { title: "Probe", plural: "Probes", icon: "box", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }] });
    assert.equal((await apply("tok-usr_noah", "sg-noah")).status, 403, "a member cannot change record types");
    assert.notEqual((await apply("tok-usr_olivia", "sg-olivia")).status, 403, "the owner is let through");
  } finally { await d.stop(); }
});
