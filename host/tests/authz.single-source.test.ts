// P-L7_22 (ruling 70): authorize reads one source, the access module's snapshot. A person who joins is known to it on their next call, a role given or taken changes what they may do,
// suspending and removing end their access, and all of it is still true after a restart (the log seeds the module once; a cursor keeps a restart from undoing a change made since).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER_TOKEN = "tok-usr_olivia";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-authz-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const COMPANY = {
  op: "type.create", type: "rt_company",
  def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "industry", type: "text", title: "Industry" }] },
};

/** token -> person for everyone but the owner; the test fills it as people join */
function bootDaemon(dir: string, people: Map<string, string>) {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "authz-single", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? "";
      const who = t === OWNER_TOKEN ? "usr_olivia" : people.get(t);
      return who === undefined ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "authz-single" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
function client(d: { url: string }) {
  return async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) as Json : {} };
  };
}

test("authorize has one source: joins, role changes, suspension and removal take effect on the next call, and survive a restart", async () => {
  const dir = seededDir();
  const people = new Map<string, string>();   // token -> person, filled as people join
  const boot = () => bootDaemon(dir, people);
  let d = await boot();
  const post = (token: string | null, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  let n = 0;
  /** the one thing an admin may do and a person without the permission may not */
  const tryAdmin = async (token: string): Promise<number> => (await post(token, "/v1/access/groups/create", { name: `Probe ${++n}`, idempotencyKey: `authz-probe-${n}` })).status;
  const ok = async (token: string, p: string, body: unknown): Promise<void> => {
    const r = await post(token, p, body);
    assert.equal(r.status, 200, `${p}: ${await r.clone().text()}`);
  };
  const join = async (who: string): Promise<{ personId: string; token: string }> => {
    const role = await post(OWNER_TOKEN, "/v1/access/roles/create", { name: `Newcomer ${who}`, idempotencyKey: `authz-role-${who}` });
    const roleId = ((await role.json()) as { data: { role: { id: string } } }).data.role.id;
    const made = await post(OWNER_TOKEN, "/v1/members/invites/create", { role: roleId, idempotencyKey: `authz-invite-${who}` });
    assert.equal(made.status, 200, await made.clone().text());
    const link = ((await made.json()) as { data: { link: string } }).data.link;
    const code = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");
    const joined = await post(null, "/v1/members/accept", { code, username: who, password: "correct horse battery staple 9", deviceName: `${who}'s Mac`, deviceClass: "desktop", keys: KEYS });
    assert.equal(joined.status, 200, await joined.clone().text());
    const data = ((await joined.json()) as { data: { personId: string } }).data;
    const token = `tok-${data.personId}`;
    people.set(token, data.personId);
    return { personId: data.personId, token };
  };
  try {
    const ann = await join("ann");
    const bob = await join("bob");
    assert.equal(await tryAdmin(ann.token), 403, "a person who joined with a role that holds no permissions is known and refused");

    // a role given changes what they may do on the next call, and taken away changes it back
    await ok(OWNER_TOKEN, "/v1/access/roles/assign", { subject: { kind: "person", id: ann.personId }, roleId: "admin" });
    assert.equal(await tryAdmin(ann.token), 200, "the seeded admin role is in force on the next call");
    await ok(OWNER_TOKEN, "/v1/access/roles/unassign", { subject: { kind: "person", id: ann.personId }, roleId: "admin" });
    assert.equal(await tryAdmin(ann.token), 403, "taking the role away ends it on the next call");
    await ok(OWNER_TOKEN, "/v1/access/roles/assign", { subject: { kind: "person", id: ann.personId }, roleId: "admin" });
    await ok(OWNER_TOKEN, "/v1/access/roles/assign", { subject: { kind: "person", id: bob.personId }, roleId: "admin" });
    assert.equal(await tryAdmin(bob.token), 200);

    // suspending ends all access at once, reactivating gives it back
    await ok(OWNER_TOKEN, "/v1/members/suspend", { personId: ann.personId });
    assert.notEqual(await tryAdmin(ann.token), 200, "a suspended person is refused on the next call");
    await ok(OWNER_TOKEN, "/v1/members/reactivate", { personId: ann.personId });
    assert.equal(await tryAdmin(ann.token), 200, "reactivated, they act again");

    // removing ends it for good
    await ok(OWNER_TOKEN, "/v1/members/remove", { personId: ann.personId, plan: [] });
    assert.notEqual(await tryAdmin(ann.token), 200, "a removed person is refused");
    assert.equal(await tryAdmin(bob.token), 200, "someone else is untouched");

    // a restart seeds from the log and the module's own tables: nothing done above is undone or forgotten
    await d.stop();
    d = await boot();
    assert.notEqual(await tryAdmin(ann.token), 200, "the removal survives a restart");
    assert.equal(await tryAdmin(bob.token), 200, "the role survives a restart");
    assert.equal(await tryAdmin(OWNER_TOKEN), 200, "the owner still acts");
    await ok(OWNER_TOKEN, "/v1/access/roles/unassign", { subject: { kind: "person", id: bob.personId }, roleId: "admin" });
    assert.equal(await tryAdmin(bob.token), 403, "a role taken away after the restart ends on the next call");
  } finally { await d.stop(); }
});

const withDaemon = async (people: Map<string, string>, run: (d: Awaited<ReturnType<typeof bootDaemon>>, post: ReturnType<typeof client>) => Promise<void>): Promise<void> => {
  const dir = seededDir();
  const d = await bootDaemon(dir, people);
  try { await run(d, client(d)); } finally { await d.stop(); }
};

test("share and revoke: a person with no grant is refused a record type, a share opens it on their next call and over sync.pull, and a revoke closes both", async () => {
  await withDaemon(new Map([["tok-usr_tess", "usr_tess"]]), async (_d, post) => {
    const TESS = "tok-usr_tess";
    const applied = await post(OWNER_TOKEN, "/v1/schema/apply", { idempotencyKey: "authz-type", ops: [COMPANY] });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    const made = await post(OWNER_TOKEN, "/v1/records/create", { idempotencyKey: "authz-rec", type: "rt_company", fields: { name: "Acme", industry: "Law" } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const id = made.body.data.record.id as string;
    const query = (): Promise<{ status: number; body: Json }> => post(TESS, "/v1/records/query", { type: "rt_company" });
    const pulled = async (): Promise<boolean> => {
      const r = await post(TESS, "/sync/v1/pull", { cursor: 0, epoch: 0 });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
      return JSON.stringify(r.body.data.changes).includes(id);
    };
    assert.equal((await query()).status, 403, "no grant, no read");
    assert.equal(await pulled(), false, "no grant, no row in the sync feed");

    const shared = await post(OWNER_TOKEN, "/v1/access/share", { idempotencyKey: "authz-share", resource: { type: "record_type", id: "rt_company" }, subject: { kind: "person", id: "usr_tess" }, level: "view" });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    const grantId = shared.body.data.grant.id as string;
    const open = await query();
    assert.equal(open.status, 200, `the share is in force on the next call: ${JSON.stringify(open.body)}`);
    assert.ok(JSON.stringify(open.body.data).includes(id), "the shared record is listed");
    assert.equal(await pulled(), true, "the shared row reaches sync.pull");

    const revoked = await post(OWNER_TOKEN, "/v1/access/unshare", { grantId });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal((await query()).status, 403, "the revoke is in force on the next call");
    assert.equal(await pulled(), false, "the revoked rows stop coming over sync.pull");
  });
});

test("a custom role made by access.roles.create confers its permissions when assigned and stops when unassigned", async () => {
  await withDaemon(new Map([["tok-usr_tess", "usr_tess"]]), async (_d, post) => {
    const TESS = "tok-usr_tess";
    assert.equal((await post(OWNER_TOKEN, "/v1/schema/apply", { idempotencyKey: "authz-type2", ops: [COMPANY] })).status, 200);
    let n = 0;
    const create = (): Promise<{ status: number; body: Json }> => post(TESS, "/v1/records/create", { idempotencyKey: `authz-tess-${++n}`, type: "rt_company", fields: { name: `Tess ${n}` } });
    assert.equal((await create()).status, 403, "a temp person cannot create records");
    const role = await post(OWNER_TOKEN, "/v1/access/roles/create", { name: "Writer", cloneFrom: "rol_member", idempotencyKey: "authz-writer" });
    assert.equal(role.status, 200, JSON.stringify(role.body));
    const roleId = role.body.data.role.id as string;
    assert.ok((role.body.data.role.permissions as string[]).includes("records.create"), "the clone holds records.create");
    const subject = { kind: "person", id: "usr_tess" };
    assert.equal((await post(OWNER_TOKEN, "/v1/access/roles/assign", { subject, roleId })).status, 200);
    const made = await create();
    assert.equal(made.status, 200, `the custom role is in force on the next call: ${JSON.stringify(made.body)}`);
    assert.equal((await post(OWNER_TOKEN, "/v1/access/roles/unassign", { subject, roleId })).status, 200);
    assert.equal((await create()).status, 403, "unassigned, it is refused again");

    // a custom role with no permissions confers nothing, and neither does the built-in Temp role
    const empty = await post(OWNER_TOKEN, "/v1/access/roles/create", { name: "Nothing", idempotencyKey: "authz-nothing" });
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.deepEqual(empty.body.data.role.permissions, [], "a role made without a clone holds no permissions");
    assert.equal((await post(OWNER_TOKEN, "/v1/access/roles/assign", { subject, roleId: empty.body.data.role.id })).status, 200);
    assert.equal((await create()).status, 403, "a role with no permissions confers nothing");
  });
});

test("fail closed: when the module cannot take a suspension, the suspended person is never let through and the owner keeps access; the Space heals once it can", async () => {
  await withDaemon(new Map([["tok-usr_noah", "usr_noah"]]), async (d, post) => {
    const NOAH = "tok-usr_noah";
    let n = 0;
    const tryAdmin = (): Promise<{ status: number; body: Json }> => post(NOAH, "/v1/access/groups/create", { name: `Probe ${++n}`, idempotencyKey: `authz-fc-${n}` });
    assert.equal((await post(OWNER_TOKEN, "/v1/access/roles/assign", { subject: { kind: "person", id: "usr_noah" }, roleId: "admin" })).status, 200);
    assert.equal((await tryAdmin()).status, 200, "an admin acts");

    d.db!.run("DROP TABLE access_meta");   // the module can no longer persist, so no sync can succeed
    const suspended = await post(OWNER_TOKEN, "/v1/members/suspend", { personId: "usr_noah" });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    const held = await tryAdmin();
    assert.notEqual(held.status, 200, "a suspended person is not let through on a stale snapshot");
    assert.equal(held.body.error?.code, "internal.unavailable", JSON.stringify(held.body));
    assert.equal((await post(OWNER_TOKEN, "/v1/access/roles/list", {})).status, 200, "the owner keeps access to fix it");

    d.db!.run('CREATE TABLE IF NOT EXISTS "access_meta" ("id" TEXT PRIMARY KEY, "epoch" INTEGER NOT NULL)');
    let last = held;
    for (let i = 0; i < 40 && last.body.error?.code === "internal.unavailable"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      last = await tryAdmin();
      assert.notEqual(last.status, 200, "never let through while healing");
    }
    assert.equal(last.status, 403, `healed, the suspension is in force: ${JSON.stringify(last.body)}`);
  });
});
