// What a relay Space tells people outside, on a booted daemon: its phone name, never this computer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-addr-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "addr-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "addr-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

test("a relay Space with a phone name invites at that name, not at this computer's loopback", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await ok(d, "/v1/spaces/get", {});
    const file = (fs.readdirSync(dir, { recursive: true }) as string[]).map((f) => path.join(dir, f)).filter((f) => f.endsWith(".db")).find((f) => {
      const probe = new DatabaseSync(f, { readOnly: true });
      try { return probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'network_phone'").get() !== undefined; } finally { probe.close(); }
    });
    assert.ok(file, "the store with the network tables");
    const db = new DatabaseSync(file);
    db.prepare("UPDATE network_config SET mode = 'relay' WHERE id = 1").run();
    db.prepare("INSERT OR REPLACE INTO network_phone (id, name, state, reported_at) VALUES (1, 'alex', 'claimed', 1)").run();
    db.close();
    const space = (await ok(d, "/v1/spaces/get", {}))["space"] as { address: { mode: string; host?: string } };
    assert.deepEqual(space.address, { mode: "relay", host: "alex.vyre.run" });
    const made = await ok(d, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "addr-invite" });
    assert.match(String(made["link"]), /^https:\/\/alex\.vyre\.run\/join\//);
  } finally { await d.stop(); }
});
