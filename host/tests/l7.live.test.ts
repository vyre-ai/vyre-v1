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
const CASES: { module: string; read: [string, unknown]; write: [string, unknown]; refused?: [string, unknown] }[] = [
  { module: "access", read: ["/v1/access/roles/list", {}], write: ["/v1/access/groups/create", { name: "L7 live group", idempotencyKey: "l7-live-group" }], refused: ["/v1/access/groups/create", { name: "Nope", idempotencyKey: "l7-live-nope" }] },
  { module: "audit", read: ["/v1/audit/chain_health", {}], write: ["/v1/audit/append", { action: "l7.live", class: "admin" }], refused: ["/v1/audit/list", {}] },
  { module: "devices", read: ["/v1/devices/mine", {}], write: ["/v1/devices/register", { person: "usr_olivia", name: "L7 live laptop", class: "desktop", idempotencyKey: "l7-live-device" }], refused: ["/v1/devices/list", {}] },
  { module: "governance", read: ["/v1/governance/jobs_health", {}], write: ["/v1/governance/retention/set", { kind: "trash", value: "90d" }], refused: ["/v1/governance/retention/get", {}] },
  { module: "identity", read: ["/v1/identity/sign_in_options", {}], write: ["/v1/identity/username_available", { username: "l7live" }], refused: ["/v1/identity/reset_start", { personId: "usr_olivia", idempotencyKey: "l7-live-reset" }] },
  { module: "members", read: ["/v1/members/invites/list", {}], write: ["/v1/members/invites/create", { role: "member", idempotencyKey: "l7-live-invite" }], refused: ["/v1/members/invites/list", {}] },
  { module: "settings", read: ["/v1/settings/list", {}], write: ["/v1/settings/set", { key: "appearance.density", value: "compact" }], refused: ["/v1/settings/set_space", { key: "access.review_every_days", value: 30 }] },
  { module: "vault", read: ["/v1/vault/items/list", {}], write: ["/v1/vault/folders/create", { name: "L7 live folder", scope: "shared", idempotencyKey: "l7-live-vault-folder" }], refused: ["/v1/vault/exports/list", {}] },
  { module: "vault-requests", read: ["/v1/vault/requests/list", {}], write: ["/v1/vault/request", { name: "Stripe key", reason: "billing", idempotencyKey: "l7-live-vault-request" }] },
  { module: "spaces", read: ["/v1/spaces/get", {}], write: ["/v1/spaces/stars/toggle", { resource: { type: "space", id: "spc_core" }, on: true }], refused: ["/v1/spaces/update", { logoFileId: null }] },
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
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
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
    for (const c of CASES) {
      const read = await post(OWNER_TOKEN, c.read[0], c.read[1]);
      assert.equal(read.status, 200, `${c.module} read ${c.read[0]}: ${await read.clone().text()}`);
      assert.ok(((await read.json()) as { data?: unknown }).data !== undefined, `${c.module}: a data body`);
      const write = await post(OWNER_TOKEN, c.write[0], c.write[1]);
      assert.equal(write.status, 200, `${c.module} write ${c.write[0]}: ${await write.clone().text()}`);
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
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
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
    const memberUse = await post(MEMBER_TOKEN, "/v1/vault/use", { item: "Dana Lawmatics" });
    assert.notEqual(memberUse.status, 200, "a member with no grant on the item cannot use it");
    const deferred = await post(OWNER_TOKEN, "/v1/vault/generate", { kind: "password" });
    const body = (await deferred.json()) as { error?: { code?: string; message?: string } };
    assert.deepEqual([body.error?.code, body.error?.message], ["internal.unavailable", "Not in this version yet"]);
  } finally { await d.stop(); }
});
