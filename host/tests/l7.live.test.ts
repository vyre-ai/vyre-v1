// P-L7_LIVE (rulings 31, 32, 53, 59): the L7a modules with a complete handler map are live, a booted daemon on the seeded `core` Space reports none of them as not set up, and each answers
// through the gateway with a real token: one read, one write, and a refusal for a member who lacks the permission.
// Path mapping: the packet owns __live__/L7; this test sits in host/tests because it boots the daemon.
// All ten L7a modules are live. Vault capabilities of the deferred packet P-L7_11 (import, generate, health, providers, policy, site rules) refuse with "Not in this version yet" (ruling 60, docs/deferred.md).
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

const LIVE = ["access", "audit", "devices", "governance", "identity", "members", "settings", "spaces", "vault", "vault-requests"];
const STUB: string[] = [];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER_TOKEN = "tok-usr_olivia";
const MEMBER_TOKEN = "tok-usr_noah";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l7-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

// Per module: a read the owner makes, a write the owner makes, and a call the member is refused (the permission it lacks is named by the manifest).
/** The seeded roles are named owner, admin, member; the contract wants role ids like rol_x, so an invite names a role made through the gateway. */
async function newRole(url: string, token: string, key: string): Promise<string> {
  const r = await fetch(`${url}/v1/access/roles/create`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ name: `Newcomer ${key}`, idempotencyKey: key }) });
  const body = (await r.json()) as { data?: { role?: { id?: string } } };
  assert.ok(body.data?.role?.id, `a role was made: ${JSON.stringify(body)}`);
  return body.data!.role!.id!;
}

const CASES: { module: string; read: [string, unknown]; write?: [string, unknown]; refused?: [string, unknown]; writeAs?: "member" }[] = [
  { module: "access", read: ["/v1/access/roles/list", {}], write: ["/v1/access/groups/create", { name: "L7 live group", idempotencyKey: "l7-live-group" }], refused: ["/v1/access/groups/create", { name: "Nope", idempotencyKey: "l7-live-nope" }] },
  { module: "audit", read: ["/v1/audit/chain_health", {}], write: ["/v1/audit/verify", {}], refused: ["/v1/audit/append", { action: "l7.live", class: "admin" }] },   // append is a module's act, not an owner's (P-SEC_10): a direct call is refused
  { module: "devices", read: ["/v1/devices/mine", {}], write: ["/v1/devices/revoke_others", {}], refused: ["/v1/devices/list", {}] },
  { module: "governance", read: ["/v1/governance/jobs_health", {}], write: ["/v1/governance/retention/set", { kind: "trash", value: "90d" }], refused: ["/v1/governance/retention/get", {}] },
  { module: "identity", read: ["/v1/identity/sign_in_options", {}], write: ["/v1/identity/username_available", { username: "l7live" }], refused: ["/v1/identity/reset_start", { personId: "usr_olivia", idempotencyKey: "l7-live-reset" }] },
  { module: "members", read: ["/v1/members/invites/list", {}], write: ["/v1/members/invites/create", { role: "ROLE", idempotencyKey: "l7-live-invite" }], refused: ["/v1/members/invites/list", {}] },
  { module: "settings", read: ["/v1/settings/list", {}], write: ["/v1/settings/set", { key: "appearance.density", value: "compact" }], refused: ["/v1/settings/set_space", { key: "access.review_every_days", value: 30 }] },
  { module: "vault", read: ["/v1/vault/items/list", {}], write: ["/v1/vault/folders/create", { name: "L7 live folder", scope: "shared", idempotencyKey: "l7-live-vault-folder" }], refused: ["/v1/vault/exports/list", {}] },
  { module: "vault-requests", read: ["/v1/vault/requests/list", {}], refused: undefined },   // a request is decided by the folder's managers, and the seeded Space has none for an unplaced name: only the read is proved here
  { module: "spaces", read: ["/v1/spaces/get", {}], write: ["/v1/stars/toggle", { resource: { type: "space", id: "spc_core" }, on: true }], refused: ["/v1/spaces/update", { logoFileId: null }] },
];

test("l7 live: host/modules.json has the complete L7a modules live and names the two that are not", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L7a");
  assert.deepEqual(mine.map((m) => m.id).sort(), [...LIVE, ...STUB].sort());
  for (const m of mine) assert.equal(m.status, LIVE.includes(m.id) ? "live" : "stub", `${m.id} status`);
});

test("l7 live: a booted daemon serves every live L7a module from its own handlers; each answers a read and a write for the owner and refuses a member", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l7-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER_TOKEN ? "usr_olivia" : t === MEMBER_TOKEN ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "l7-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    const notSetUp = (d.seams?.missing ?? []).filter((m) => m.module !== undefined && LIVE.includes(m.module));
    assert.deepEqual(notSetUp, [], "no live L7a module is reported as not set up");
    const row = (d.db!.all("SELECT detail FROM health_probe WHERE name = ?", "module_drivers")[0] ?? { detail: "" }) as { detail: string };
    for (const id of LIVE) assert.ok(!new RegExp(`\\b${id}\\b \\(`).test(row.detail), `health does not list ${id} as not set up`);
    const roleId = await newRole(d.url, OWNER_TOKEN, "l7-live-role");
    for (const c of CASES) {
      if (c.module === "members" && c.write) (c.write[1] as { role: string }).role = roleId;
      const read = await post(OWNER_TOKEN, c.read[0], c.read[1]);
      assert.equal(read.status, 200, `${c.module} read ${c.read[0]}: ${await read.clone().text()}`);
      assert.ok(((await read.json()) as { data?: unknown }).data !== undefined, `${c.module}: a data body`);
      if (c.write) {
        const write = await post(c.writeAs === "member" ? MEMBER_TOKEN : OWNER_TOKEN, c.write[0], c.write[1]);
        assert.equal(write.status, 200, `${c.module} write ${c.write[0]}: ${await write.clone().text()}`);
      }
      if (!c.refused) continue;
      const refused = await post(MEMBER_TOKEN, c.refused[0], c.refused[1]);
      assert.equal(refused.status, 403, `${c.module}: a member is refused ${c.refused[0]}: ${await refused.clone().text()}`);
    }
    assert.equal((await post("nope", "/v1/spaces/get", {})).status, 401, "no valid token, no answer");
  } finally { await d.stop(); }
});

test("l7 live: through the gateway a Shared item is put, used by name and filled; the value never appears in the use answer; a deferred capability refuses", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l7-vault", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER_TOKEN ? "usr_olivia" : t === MEMBER_TOKEN ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "l7-vault" };
    },
    seams: { vaultSinks: { env: () => undefined } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const SECRET = "sk-live-l7-NEVER-IN-A-LOG";
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "vault"), [], "the vault seams (filler key, sinks) are wired");
    const folder = await post(OWNER_TOKEN, "/v1/vault/folders/create", { name: "Team keys", scope: "shared", idempotencyKey: "l7-vault-f" });
    assert.equal(folder.status, 200, await folder.clone().text());
    const folderId = ((await folder.json()) as { data: { folder: { id: string } } }).data.folder.id;
    const put = await post(OWNER_TOKEN, "/v1/vault/item/put", { folderId, name: "Dana Lawmatics", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "l7-vault-i" });
    assert.equal(put.status, 200, await put.clone().text());
    const used = await post(OWNER_TOKEN, "/v1/vault/use", { item: "Dana Lawmatics" });
    assert.equal(used.status, 200, await used.clone().text());
    const usedText = await used.text();
    assert.ok(usedText.includes("#Dana_Lawmatics") && !usedText.includes(SECRET), "use answers a handle, never the value");
    const filled = await post(OWNER_TOKEN, "/v1/vault/fill", { handle: "#Dana_Lawmatics.api_key", target: { kind: "env", ref: "proc/KEY" } });
    assert.equal(filled.status, 200, await filled.clone().text());
    assert.ok(!(await filled.text()).includes(SECRET), "fill into a place answers filled, never the value");
    const noSink = await post(OWNER_TOKEN, "/v1/vault/fill", { handle: "#Dana_Lawmatics.api_key", target: { kind: "terminal", ref: "t" } });
    assert.equal(((await noSink.json()) as { error?: { code?: string } }).error?.code, "internal.unavailable", "a place with no sink is refused");
    const pulled = await fetch(`${d.url}/exports/vex_nothing?token=nope`);
    assert.equal(pulled.status, 404, "the export pull route is mounted and refuses an unknown link");
    const deferred = await post(OWNER_TOKEN, "/v1/vault/generate", { kind: "password" });
    const body = (await deferred.json()) as { error?: { code?: string; message?: string } };
    assert.deepEqual([body.error?.code, body.error?.message], ["internal.unavailable", "Not in this version yet"]);
  } finally { await d.stop(); }
});

test("l7 live: an invite made by the owner is accepted by a stranger through the gateway (identity reaches members through the host), and the code works once", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l7-join", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      return t === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "l7-join" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = (token: string | null, p: string, body: unknown) =>
    fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const join = (code: string, username: string) => post(null, "/v1/members/accept", {
    code, username, password: "correct horse battery staple 9", deviceName: "Stranger's Mac", deviceClass: "desktop",
    keys: { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] },
  });
  try {
    const made = await post(OWNER_TOKEN, "/v1/members/invites/create", { role: await newRole(d.url, OWNER_TOKEN, "l7-join-role"), idempotencyKey: "l7-join-invite" });
    assert.equal(made.status, 200, await made.clone().text());
    const link = ((await made.json()) as { data: { link: string } }).data.link;
    const code = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");   // the fingerprint rides in the fragment
    const joined = await join(code, "newbie");
    assert.equal(joined.status, 200, await joined.clone().text());
    // the offboarding wizard (preview, legal hold, remove) needs the removed person in the access module's store, which the daemon does not have yet (P-L7_22 adds it and the booted test)
    const again = await join(code, "newbie2");
    assert.notEqual(again.status, 200, "an accepted invite cannot be used again");
    const bad = await join("NOPE-NOPE", "newbie3");
    assert.notEqual(bad.status, 200, "an unknown code is refused");
    const who = await post(OWNER_TOKEN, "/v1/identity/sign_in_options", {});
    assert.equal(who.status, 200);
  } finally { await d.stop(); }
});

test("l7 live: whoami names the device of the call, and GitHub sign-in says it is not set up when the server has no OAuth app, or goes to GitHub when it has one", async () => {
  const run = async (githubOAuth: { clientId: string; clientSecret: string; fetch: typeof fetch } | null) => {
    const dir = seededDir();
    const d = await startDaemon({
      config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
      platform: fakePlatform({
        os: "linux", hostname: "l7-gh", free: 80e9,
        commands: {
          [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
          "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
          "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
        },
      }),
      fetch: caddyFetch,
      githubOAuth,
      session: (h) => {
        const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
        return t === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "dev_l7gh" } : null;
      },
      intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    });
    try {
      const gh = await fetch(`${d.url}/v1/identity/github_sign_in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "abc", deviceName: "Mac", deviceClass: "desktop" }) });
      return { status: gh.status, body: (await gh.json()) as { error?: { code?: string; message?: string } } };
    } finally { await d.stop(); }
  };
  const none = await run(null);
  assert.equal(none.body.error?.code, "internal.unavailable");
  assert.equal(none.body.error?.message, "GitHub sign-in isn't set up on this server");
  const seen: string[] = [];
  const fake = (async (url: string) => {
    seen.push(String(url));
    return String(url).includes("access_token") ? new Response(JSON.stringify({ access_token: "gho_x" })) : new Response(JSON.stringify({ id: 42, login: "octo" }));
  }) as unknown as typeof fetch;
  const some = await run({ clientId: "cid", clientSecret: "sec", fetch: fake });
  assert.notEqual(some.body.error?.message, "GitHub sign-in isn't set up on this server", "with an OAuth app the code goes to GitHub");
  assert.deepEqual(seen, ["https://github.com/login/oauth/access_token", "https://api.github.com/user"]);
});

test("l7 live: sign-in is rate limited per source address: one address using up its tries leaves another untouched", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l7-rate", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  // the test's socket is loopback, like a reverse proxy on this machine, so x-forwarded-for names the client
  const signIn = async (from: string): Promise<number> => (await fetch(`${d.url}/v1/identity/sign_in`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify({ username: "nobody", password: "wrong password here", deviceName: "Mac", deviceClass: "desktop" }),
  })).status;
  try {
    for (let i = 0; i < 10; i++) assert.notEqual(await signIn("203.0.113.9"), 429, `try ${i + 1} from the first address`);
    assert.equal(await signIn("203.0.113.9"), 429, "the eleventh try from one address is limited");
    assert.notEqual(await signIn("198.51.100.4"), 429, "another address has its own bucket");
    assert.equal(await signIn("203.0.113.9"), 429, "and the first is still limited");
  } finally { await d.stop(); }
});
