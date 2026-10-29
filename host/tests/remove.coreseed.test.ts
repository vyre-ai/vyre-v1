// P-L7_30: the exact path of the automations.exec removal case (P-L6_24): a daemon booted on the bare `core` seed (bootCore, its events in the log, no table fill), members.remove on a seeded member through the
// gateway. The seed stores roles by the kernel's names; the removal must still take them away (access.roles.unassign wants rol_ ids).
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
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const NOAH = "tok-usr_noah";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-remove-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
const boot = (dir: string): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "remove-core", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    const who = t === OWNER ? "usr_olivia" : t === NOAH ? "usr_noah" : null;
    return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "remove-core" };
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
});
const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; text: string; data: Record<string, unknown> }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, text, data: (JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {} };
};

test("members.remove removes a person of the bare core seed: 200, the roles are gone, and the owner is still protected", async () => {
  const d = await boot(seededDir());
  try {
    const before = await call(d, "/v1/access/principals/get", { principal: { kind: "person", id: "usr_noah" } });
    assert.equal(before.status, 200, before.text);
    const roles = (before.data["principal"] as { roles: string[] }).roles;
    const removed = await call(d, "/v1/members/remove", { personId: "usr_noah", plan: [], reason: "test" });
    assert.equal(removed.status, 200, `members.remove with roles ${JSON.stringify(roles)}: ${removed.text}`);
    const after = await call(d, "/v1/access/principals/get", { principal: { kind: "person", id: "usr_noah" } });
    assert.deepEqual((after.data["principal"] as { roles: string[] }).roles, [], "no role is left");
    const own = await call(d, "/v1/members/remove", { personId: "usr_olivia", plan: [] });
    assert.ok(own.status >= 400 && own.status < 500, `the owner cannot be removed: ${own.status}`);
  } finally { await d.stop(); }
});
