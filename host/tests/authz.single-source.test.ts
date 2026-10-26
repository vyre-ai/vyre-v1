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

test("authorize has one source: joins, role changes, suspension and removal take effect on the next call, and survive a restart", async () => {
  const dir = seededDir();
  const people = new Map<string, string>();   // token -> person, filled as people join
  const boot = () => startDaemon({
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
