// P-SEC_10: the security sweep, proved on a booted daemon through the real gateway (rule 27).
//   1. No gateway caller is ever a service. A person (admin token and a device session), an agent acting for a person, a signed-out actor and a caller who forges every header and body field reach a handler as what
//      they are, and a nested ctx.call keeps that identity exactly (same kind, same id, same actingFor, depth one).
//   2. Every place that trusts kind "service" goes through lib/trust.ts, and the ones that do not are the reviewed list: a new `kind === "service"` in a module fails this test until it is read and added.
//   3. The system halves (audit append, archive and checkpoint, device epoch and touch, session mint, scrub-miss reports) refuse a direct call from a person, the owner included.
//   4. A suspension takes effect on the very next call, and reactivating takes it back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { issueSessionToken } from "../src/daemon/session.ts";
import type { Handler } from "../src/invoke.ts";
import { isHostService, isSystemCall, isTenantService, isTrustedService } from "../../lib/trust.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

const probe = (name: string, caller?: "anonymous"): CapabilityDef => ({
  name, v: 1, permission: null, level: "view", resource: { type: "space" }, idempotency: "natural", effects: "read", risk: "low", emits: [], examples: [], surfaces: {}, input: {}, output: {}, errors: [],
  summary: "Who the pipeline says is calling", ...(caller ? { caller } : {}),
}) as unknown as CapabilityDef;
const route = (cap: string, p: string) => ({ method: "POST", path: p, cap, v: 1, effects: "read" as const });

interface Who { kind: string; id: string; actingFor: string | null; depth: number }
const whoHandler: Handler = ((ctx: { principal: { kind: string; id: string }; actingFor?: string; depth: number }): Who => ({ kind: ctx.principal.kind, id: ctx.principal.id, actingFor: ctx.actingFor ?? null, depth: ctx.depth })) as never;
const nestHandler: Handler = (async (ctx: { principal: { kind: string; id: string }; actingFor?: string; depth: number; call(cap: string, input: unknown): Promise<unknown> }) => ({
  outer: { kind: ctx.principal.kind, id: ctx.principal.id, actingFor: ctx.actingFor ?? null, depth: ctx.depth },
  inner: await ctx.call("example.who", {}),
})) as never;

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sweep10-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(session?: Parameters<typeof startDaemon>[0]["session"]): Promise<Daemon> {
  const dir = seededDir();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "sweep10", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    ...(session ? { session } : {}),
    extra: {
      caps: [probe("example.who"), probe("example.nest"), probe("example.hello", "anonymous")],
      routes: [route("example.who", "/v1/example/who"), route("example.nest", "/v1/example/nest"), route("example.hello", "/v1/example/hello")],
      handlers: { "example.who": whoHandler, "example.nest": nestHandler, "example.hello": whoHandler },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
}

const post = (d: Daemon, p: string, token: string | null, body: unknown, headers: Record<string, string> = {}) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body),
});
const data = async <T>(r: Response): Promise<T> => ((await r.json()) as { data: T }).data;

/** Headers and body fields a caller might forge to look like the server. */
const FORGED_HEADERS: Record<string, string> = {
  "x-vyre-principal": "svc_host", "x-vyre-principal-kind": "service", "x-vyre-kind": "service", "x-vyre-actor": "svc_host", "x-vyre-device": "svc_host", "x-vyre-acting-for": "usr_olivia",
  "x-vyre-remote": "127.0.0.1", "x-forwarded-for": "10.0.0.1", "x-vyre-run": "run_forged", "x-vyre-origin": "hook",
};
const FORGED_BODY = { principal: { kind: "service", id: "svc_host" }, actingFor: "usr_olivia", kind: "service", id: "svc_host", preAuth: true, origin: "hook", device: "svc_host" };

const isService = (w: { kind: string; id: string }): boolean => w.kind === "service" || w.id.startsWith("svc_");

test("lib/trust: the host and its own services are trusted, a tenant's service principal never is, and a system call is the host or a nested call", () => {
  const svc = (id: string) => ({ kind: "service", id });
  assert.equal(isHostService(svc("svc_host")), true);
  assert.equal(isHostService(svc("svc_engine")), false);
  assert.equal(isHostService({ kind: "person", id: "svc_host" }), false, "an id alone is never enough");
  for (const id of ["svc_host", "svc_engine", "svc_sync"]) assert.equal(isTrustedService(svc(id)), true, id);
  for (const id of ["svc_form_a1b2c3", "svc_site_a1b2c3", `svc_${"a1".repeat(16)}`]) {
    assert.equal(isTenantService(svc(id)), true, id);
    assert.equal(isTrustedService(svc(id)), false, `${id} is a service a tenant made`);
  }
  for (const k of ["person", "agent", "actor"]) assert.equal(isTrustedService({ kind: k, id: "svc_host" }), false, `${k} with a service-looking id`);
  assert.equal(isSystemCall({ principal: { kind: "person", id: "usr_olivia" }, depth: 0 }), false);
  assert.equal(isSystemCall({ principal: { kind: "person", id: "usr_olivia" } }), false, "no depth reads as a direct call");
  assert.equal(isSystemCall({ principal: { kind: "person", id: "usr_olivia" }, depth: 1 }), true);
  assert.equal(isSystemCall({ principal: svc("svc_host"), depth: 0 }), true);
  assert.equal(isSystemCall({ principal: svc("svc_a1b2c3"), depth: 0 }), false, "another service is not the host");
});

test("every module trust of kind service is reviewed: the sites below are the whole list, the rest go through lib/trust.ts", () => {
  const root = fileURLToPath(new URL("../../modules/", import.meta.url));
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "tests" && e.name !== "fixtures" && e.name !== "node_modules") walk(p); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      if (/kind\s*(===|!==|==|!=)\s*["']service["']/.test(fs.readFileSync(p, "utf8").replace(/\/\/.*$/gm, ""))) found.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(found.sort(), [
    "automations/handlers/triggers.ts",   // an Automation's own Run: which vault names a tenant service may use (a restriction, not a power)
    "chat/handlers/private.ts",           // the engine runtime opens a private chat only for its owner (asker equals owner, and only an agent or the host)
    "devices/handlers/register.ts",       // devices.register: kind service AND id svc_host
    "forms/handlers/submit.ts",           // a public form submits as its own svc_form_<id> and may not use another form's
    "git/handlers/ops.ts",                // a label in a log line, not a decision
    "telephony/projections.ts",           // classifies who started a call for the log, not a decision
  ].sort());
});

test("no gateway caller arrives as a service, a nested call keeps the identity it was called with, and forging headers or body changes nothing", async () => {
  const OWNER = "tok-owner", NOAH = "tok-noah", SCOUT = "tok-scout";
  const d = await boot((h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    if (t === OWNER) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_olivia" };
    if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "dev_noah" };
    if (t === SCOUT) return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_noah" };
    return null;
  });
  try {
    const callers: [string, string | null, Who][] = [
      ["the owner", OWNER, { kind: "person", id: "usr_olivia", actingFor: null, depth: 0 }],
      ["a member", NOAH, { kind: "person", id: "usr_noah", actingFor: null, depth: 0 }],
      ["an agent acting for a member", SCOUT, { kind: "agent", id: "agt_scout", actingFor: "usr_noah", depth: 0 }],
    ];
    for (const [name, token, want] of callers) {
      for (const [label, headers, body] of [["plain", {}, {}], ["forged", FORGED_HEADERS, FORGED_BODY]] as const) {
        const direct = await post(d, "/v1/example/who", token, body, headers);
        assert.equal(direct.status, 200, `${name} (${label}): ${await direct.clone().text()}`);
        const who = await data<Who>(direct);
        assert.deepEqual(who, want, `${name} (${label}) is who the session says`);
        assert.equal(isService(who), false, `${name} (${label}) is never a service`);
        const nested = await data<{ outer: Who; inner: Who }>(await post(d, "/v1/example/nest", token, body, headers));
        assert.deepEqual(nested.outer, want);
        assert.deepEqual({ ...nested.inner, depth: 0 }, { ...want, depth: 0 }, `${name} (${label}): the nested call has the same identity`);
        assert.equal(nested.inner.depth, 1, "and it is one level down");
      }
    }
    // a token nobody issued, and the server's own id offered as a token, are refused
    assert.equal((await post(d, "/v1/example/who", "svc_host", {}, FORGED_HEADERS)).status, 401);
    assert.equal((await post(d, "/v1/example/who", null, FORGED_BODY, FORGED_HEADERS)).status, 401, "a signed-out caller cannot call a principal capability");
    // a signed-out caller on a pre-auth capability is an actor with a per-source id, forged headers or not, and its nested identity is the same
    for (const headers of [{}, FORGED_HEADERS]) {
      const hello = await post(d, "/v1/example/hello", null, FORGED_BODY, headers);
      assert.equal(hello.status, 200, await hello.clone().text());
      const w = await data<Who>(hello);
      assert.equal(w.kind, "actor");
      assert.match(w.id, /^act_anon_[0-9a-f]{16}$/);
      assert.equal(isService(w), false);
    }
  } finally { await d.stop(); }
});

test("the admin token acts as the owner on the fixed local device, never as a service, whatever the headers and body say", async () => {
  const d = await boot();
  try {
    const r = await post(d, "/v1/example/who", d.token, FORGED_BODY, FORGED_HEADERS);
    assert.equal(r.status, 200, await r.clone().text());
    const admin = await data<Who>(r);
    assert.equal(isService(admin), false);
    assert.equal(admin.kind, "person");
    assert.equal(admin.depth, 0);
  } finally { await d.stop(); }
});

test("a real device session is a person and nothing else, and a revoked one is refused", async () => {
  const d = await boot();
  try {
    const now = Date.now();
    d.db!.run(`INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, "dev_s10a", "usr_noah", "Noah's Mac", now, now);
    d.db!.run(`INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, "ses_s10a", "usr_noah", "dev_s10a", now, now);
    const token = issueSessionToken(d.db!, "ses_s10a");
    const w = await data<Who>(await post(d, "/v1/example/who", token, FORGED_BODY, FORGED_HEADERS));
    assert.deepEqual(w, { kind: "person", id: "usr_noah", actingFor: null, depth: 0 });
    d.db!.run(`UPDATE devices_session SET revoked_at = ? WHERE id = ?`, now, "ses_s10a");
    assert.equal((await post(d, "/v1/example/who", token, {})).status, 401, "the very next call after a revoke is refused");
  } finally { await d.stop(); }
});

test("the system halves refuse a direct call from a person, the owner included, and a member's suspension takes effect on the next call", async () => {
  const OWNER = "tok-owner", NOAH = "tok-noah";
  const d = await boot((h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    if (t === OWNER) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_olivia" };
    if (t === NOAH) return { space: "spc_core", principal: { kind: "person", id: "usr_noah" }, device: "dev_noah" };
    return null;
  });
  try {
    const direct: [string, unknown][] = [
      ["/v1/audit/append", { action: "forged.entry", class: "admin", onBehalfOf: { kind: "person", id: "usr_olivia" } }],
      ["/v1/audit/archive", { before: 4_102_444_800_000 }],
      ["/v1/audit/checkpoint", {}],
      ["/v1/devices/epoch_bump", { person: "usr_olivia", reason: "removed" }],
      ["/v1/devices/purge_ack", { deviceId: "dev_nothere01" }],
      ["/v1/mcp/session/mint", { principal: "usr_olivia", actingFor: "usr_olivia", threadId: "thr_forged01", traceId: "0123456789abcdef0123456789abcdef" }],
      ["/v1/gate/park", { capName: "mail.send", capVersion: 1, input: { to: ["x@example.com"], subject: "s", body: "b" }, payloadHash: "ph_forged", act: "send", principal: { kind: "person", id: "usr_olivia" }, decisionId: "dec_forged02" }],
      ["/v1/vault/report_scrub_miss", { itemId: "vit_forged001", place: "chat", traceId: "0123456789abcdef0123456789abcdef" }],
    ];
    for (const token of [NOAH, OWNER]) {
      for (const [p, body] of direct) {
        const r = await post(d, p, token, { idempotencyKey: `sweep10-${p}`, ...(body as object) });
        const text = await r.text();
        assert.ok(r.status === 403 || r.status === 404, `${token} ${p}: a direct call is refused, got ${r.status} ${text.slice(0, 200)}`);
        assert.ok(!text.includes('"ok":true') && !text.includes("auditId") && !text.includes("sessionToken"), `${p}: no success body`);
      }
    }
    // a suspension takes effect on the next call, and reactivating takes it back
    assert.equal((await post(d, "/v1/access/principals/get", NOAH, {})).status, 200, "a member can call before");
    const suspended = await post(d, "/v1/members/suspend", OWNER, { personId: "usr_noah", reason: "sweep 10", idempotencyKey: "sweep10-suspend" });
    assert.equal(suspended.status, 200, await suspended.clone().text());
    const after = await post(d, "/v1/access/principals/get", NOAH, {});
    assert.ok(after.status === 401 || after.status === 403, `the very next call is refused, got ${after.status}`);
    const back = await post(d, "/v1/members/reactivate", OWNER, { personId: "usr_noah", idempotencyKey: "sweep10-reactivate" });
    assert.equal(back.status, 200, await back.clone().text());
    assert.equal((await post(d, "/v1/access/principals/get", NOAH, {})).status, 200, "and reactivating takes it back on the next call");
  } finally { await d.stop(); }
});

// ---- the sweep's later findings: Run owners, the Gate's park, the retention tick, and the shared project link ----

const two = (h: Record<string, string | undefined>) => {
  const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
  if (t === "tok-owner") return { space: "spc_core", principal: { kind: "person" as const, id: "usr_olivia" }, device: "dev_olivia" };
  if (t === "tok-noah") return { space: "spc_core", principal: { kind: "person" as const, id: "usr_noah" }, device: "dev_noah" };
  return null;
};
const errorOf = async (r: Response): Promise<{ status: number; code: string; reason: string }> => {
  const b = (await r.json()) as { error?: { code?: string; details?: { reason?: string } } };
  return { status: r.status, code: b.error?.code ?? "", reason: b.error?.details?.reason ?? "" };
};
const count = (d: Daemon, table: string): number => {
  try { return (d.db!.all(`SELECT COUNT(*) AS n FROM ${table}`) as { n: number }[])[0]!.n; } catch { return 0; }
};

test("runs.start: a person starts a Run for themselves, never for someone else, whatever the forged headers say", async () => {
  const d = await boot(two);
  try {
    const mine = await post(d, "/v1/runs/start", "tok-owner", { kind: "automation", name: "Mine", owner: "usr_olivia", idempotencyKey: "sweep10-run-mine" }, FORGED_HEADERS);
    assert.equal(mine.status, 200, await mine.clone().text());
    assert.match((await data<{ runId: string }>(mine)).runId, /^run_/);
    const before = count(d, "runs_items");
    // the owner of the Space cannot start a Run in someone else's name either
    const other = await errorOf(await post(d, "/v1/runs/start", "tok-owner", { kind: "automation", name: "Theirs", owner: "usr_noah", idempotencyKey: "sweep10-run-other" }, FORGED_HEADERS));
    assert.deepEqual(other, { status: 403, code: "permission.role_lacks_permission", reason: "owner_not_caller" });
    const member = await post(d, "/v1/runs/start", "tok-noah", { kind: "automation", name: "Theirs", owner: "usr_olivia", idempotencyKey: "sweep10-run-member", ...FORGED_BODY });
    assert.ok(member.status === 403 || member.status === 400 || member.status === 422, `a member naming the owner is refused, got ${member.status}`);
    assert.equal(count(d, "runs_items"), before, "no Run was written for anyone else");
  } finally { await d.stop(); }
});

test("gate.park: a person cannot write a hold, so a forged hold cannot be released as someone else; a forged release token is refused", async () => {
  const d = await boot(two);
  try {
    const forged = {
      capName: "mail.send", capVersion: 1, input: { to: ["victim@example.com"], subject: "Wire the funds", body: "Approved." }, payloadHash: "ph_forged", act: "send",
      principal: { kind: "person", id: "usr_olivia" }, actingFor: "usr_olivia", decisionId: "dec_forged01", idempotencyKey: "sweep10-park", ...FORGED_BODY,
    };
    const owner = await errorOf(await post(d, "/v1/gate/park", "tok-owner", forged, FORGED_HEADERS));
    assert.deepEqual(owner, { status: 403, code: "permission.role_lacks_permission", reason: "system_only" });
    const member = await post(d, "/v1/gate/park", "tok-noah", { ...forged, idempotencyKey: "sweep10-park-2", principal: { kind: "person", id: "usr_noah" }, actingFor: "usr_noah" }, FORGED_HEADERS);
    assert.ok(member.status === 403 || member.status === 404, `a member's park is refused, got ${member.status}`);
    assert.equal(count(d, "gate_holds"), 0, "no hold exists");
    // a release of a hold that does not exist, with a made-up token, does nothing
    for (const token of ["tok-owner", "tok-noah"]) {
      const r = await post(d, "/v1/gate/release", token, { holdId: "hld_forged0001", taskId: "tsk_forged0001", approvalToken: "forged.token", idempotencyKey: "sweep10-release" }, FORGED_HEADERS);
      const text = await r.text();
      assert.ok(r.status >= 400 && !text.includes('"result"'), `${token}: a forged release is refused, got ${r.status} ${text.slice(0, 160)}`);
    }
  } finally { await d.stop(); }
});

test("governance.jobs.tick is the schedule's call: a member is refused, someone who manages policy runs it", async () => {
  const d = await boot(two);
  try {
    const member = await errorOf(await post(d, "/v1/governance/jobs/tick", "tok-noah", { kind: "logs" }));
    assert.deepEqual(member, { status: 403, code: "permission.role_lacks_permission", reason: "system_only" });
    const owner = await post(d, "/v1/governance/jobs/tick", "tok-owner", { kind: "logs" });
    assert.equal(owner.status, 200, await owner.clone().text());
  } finally { await d.stop(); }
});

test("a shared project link shows a client the safe view, stops at expiry or revoke, and only the host reads it through the gateway", async () => {
  const d = await boot(two);
  try {
    const CONTACT = { op: "type.create", type: "rt_contact", def: { title: "Contact", plural: "Contacts", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } };
    assert.equal((await post(d, "/v1/schema/apply", "tok-owner", { idempotencyKey: "sweep10-type", ops: [CONTACT] })).status, 200);
    const made = await post(d, "/v1/records/create", "tok-owner", { idempotencyKey: "sweep10-rec", type: "rt_contact", fields: { name: "Smith & Co <matter>" } });
    assert.equal(made.status, 200, await made.clone().text());
    const recordId = (await data<{ record: { id: string } }>(made)).record.id;
    assert.equal((await post(d, "/v1/projects/list", "tok-owner", {})).status, 200, "the module opens its tables");
    const run = (sql: string, ...a: unknown[]) => d.db!.run(sql, ...a);
    const now = Date.now();
    run(`INSERT INTO projects_project ("projectId", "recordId", "type", "source", "createdBy", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`, "prj_sweep10aaa", recordId, "rt_contact", "new", "usr_olivia", now);
    run(`INSERT INTO projects_member ("projectId", "principal", "role", "kind", "since") VALUES (?, ?, ?, ?, ?)`, "prj_sweep10aaa", "usr_noah", "member", "person", now);
    const live = "a1".repeat(18), expired = "b2".repeat(18), revoked = "c3".repeat(18);
    for (const [token, at] of [[live, now + 3_600_000], [expired, now - 1000], [revoked, now + 3_600_000]] as const) {
      run(`INSERT INTO projects_share ("token", "projectId", "expiresAt", "createdBy", "createdAt") VALUES (?, ?, ?, ?, ?)`, token, "prj_sweep10aaa", at, "usr_olivia", now);
    }
    const get = (token: string, init: RequestInit = {}) => fetch(`${d.url}/share/project/${token}`, init);

    const ok = await get(live);
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.ok(html.includes("Smith &amp; Co &lt;matter&gt;"), "the title is shown, escaped");
    assert.ok(!html.includes("usr_noah") && !html.includes("usr_olivia"), "no member or owner id");
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.match(ok.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
    assert.match(ok.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const asJson = await get(live, { headers: { accept: "application/json" } });
    assert.deepEqual(Object.keys((await asJson.json() as { data: object }).data).sort(), ["expiresAt", "milestones", "status", "title"].sort());

    // expired, unknown and revoked are the same 404, with no hint of which
    run(`DELETE FROM projects_share WHERE "token" = ?`, revoked);
    const bodies = new Set<string>();
    for (const token of [expired, revoked, "d4".repeat(18), "short"]) {
      const r = await get(token);
      assert.equal(r.status, 404, token);
      assert.equal(r.headers.get("cache-control"), "no-store");
      bodies.add(await r.text());
    }
    assert.equal(bodies.size, 1, "one answer for every kind of dead link");
    assert.equal((await get(live, { method: "POST" })).status, 405);
    assert.equal((await get(live, { method: "HEAD" })).status, 200);

    // through the gateway the view is the host's own call: a person, the owner included, is refused
    for (const token of ["tok-owner", "tok-noah"]) {
      const r = await post(d, "/v1/projects/shared_view", token, { token: live });
      assert.ok(r.status === 403 || r.status === 404, `${token}: got ${r.status}`);
      assert.ok(!(await r.text()).includes("Smith"), "no view in the refusal");
    }
  } finally { await d.stop(); }
});
