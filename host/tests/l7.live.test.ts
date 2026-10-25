// P-L7_LIVE (rulings 31, 32, 53, 59): the L7a modules with a complete handler map are live, a booted daemon on the seeded `core` Space reports none of them as not set up, and each answers
// through the gateway with a real token: one read, one write, and a refusal for a member who lacks the permission.
// Path mapping: the packet owns __live__/L7; this test sits in host/tests because it boots the daemon.
// Still stub, and why (commented on the packet): vault and vault-requests (modules/vault has 15 of 42 handlers; the rest are P-L7_10 and P-L7_11, not merged).
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

const LIVE = ["access", "audit", "devices", "governance", "identity", "members", "settings", "spaces"];
const STUB = ["vault", "vault-requests"];

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
const CASES: { module: string; read: [string, unknown]; write: [string, unknown]; refused: [string, unknown] }[] = [
  { module: "access", read: ["/v1/access/roles/list", {}], write: ["/v1/access/groups/create", { name: "L7 live group", idempotencyKey: "l7-live-group" }], refused: ["/v1/access/groups/create", { name: "Nope", idempotencyKey: "l7-live-nope" }] },
  { module: "audit", read: ["/v1/audit/chain_health", {}], write: ["/v1/audit/append", { action: "l7.live", class: "admin" }], refused: ["/v1/audit/list", {}] },
  { module: "devices", read: ["/v1/devices/mine", {}], write: ["/v1/devices/register", { person: "usr_olivia", name: "L7 live laptop", class: "desktop", idempotencyKey: "l7-live-device" }], refused: ["/v1/devices/list", {}] },
  { module: "governance", read: ["/v1/governance/jobs_health", {}], write: ["/v1/governance/retention/set", { kind: "trash", value: "90d" }], refused: ["/v1/governance/retention/get", {}] },
  { module: "identity", read: ["/v1/identity/sign_in_options", {}], write: ["/v1/identity/username_available", { username: "l7live" }], refused: ["/v1/identity/reset_start", { personId: "usr_olivia", idempotencyKey: "l7-live-reset" }] },
  { module: "members", read: ["/v1/members/invites/list", {}], write: ["/v1/members/invites/create", { role: "member", idempotencyKey: "l7-live-invite" }], refused: ["/v1/members/invites/list", {}] },
  { module: "settings", read: ["/v1/settings/list", {}], write: ["/v1/settings/set", { key: "appearance.density", value: "compact" }], refused: ["/v1/settings/set_space", { key: "access.review_every_days", value: 30 }] },
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
      const refused = await post(MEMBER_TOKEN, c.refused[0], c.refused[1]);
      assert.equal(refused.status, 403, `${c.module}: a member is refused ${c.refused[0]}: ${await refused.clone().text()}`);
    }
    assert.equal((await post("nope", "/v1/spaces/get", {})).status, 401, "no valid token, no answer");
  } finally { await d.stop(); }
});
