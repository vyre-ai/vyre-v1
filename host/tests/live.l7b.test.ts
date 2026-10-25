// P-L7b_LIVE (rulings 27, 31, 32): lane L7b is live. A booted daemon on the seeded `core` Space reports no L7b module as not set up, every L7b module but the two with a gap is live in host/modules.json, and
// each one answers a read and a write through the gateway with a real token; a member without the permission is refused. backup's source is the host's own (host/src/seams/backup.ts).
// Path mapping: the packet owns __live__/L7b; this test sits in host/tests because it boots the daemon.
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

const L7B = ["backup", "console-assistant", "console-views", "health", "logs", "network", "reports-client", "updates"];
// updates and reports-client stay stubs: the daemon builds no release key, feed or installer for updates, and no reports.vyre.run client or replay sandbox for reports-client (gap on P-L7b_LIVE)
const GAP = ["reports-client", "updates"];
const OWNER_TOKEN = "tok-usr_olivia";
const MEMBER_TOKEN = "tok-usr_noah";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l7b-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l7b-live", free: 80e9,
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
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "l7b-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

let n = 0;
const post = (d: { url: string }, token: string, cap: string, body: Record<string, unknown> = {}) => {
  const [mod, name] = cap.split(".") as [string, string];
  const prefix = mod === "reports-client" ? "reports" : mod;
  return fetch(`${d.url}/v1/${prefix}/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ idempotencyKey: `l7b-live-${++n}`, ...body }),
  });
};
const ok = async (d: { url: string }, token: string, cap: string, body: Record<string, unknown> = {}): Promise<unknown> => {
  const r = await post(d, token, cap, body);
  const text = await r.text();
  assert.equal(r.status, 200, `${cap} answers through the live handler: ${text}`);
  return (JSON.parse(text) as { data: unknown }).data;
};

test("l7b live: every L7b module but the two with a gap is live in host/modules.json", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L7b").map((m) => m.id).sort();
  assert.deepEqual(mine, [...L7B].sort());
  for (const m of file.modules.filter((x) => x.owner === "L7b")) assert.equal(m.status, GAP.includes(m.id) ? "stub" : "live", `${m.id} status`);
});

test("l7b live: a booted daemon wires backup and reports no L7b module as not set up", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const notSetUp = (d.seams?.missing ?? []).filter((m) => m.module !== undefined && m.module === "backup");
    assert.deepEqual(notSetUp, [], "backup has its driver");
    assert.ok((d.seams?.wired ?? []).includes("setBackupHost"), "setBackupHost is wired");
  } finally { await d.stop(); }
});

test("l7b live: each module answers a read and a write through the gateway as the owner, and a member is refused", async () => {
  const dir = seededDir();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l7b-target-"));
  const d = await boot(dir);
  try {
    const reads: [string, Record<string, unknown>][] = [
      ["logs.settings_get", {}], ["network.status", {}], ["network.endpoints", {}], ["health.status", {}], ["console.nav", {}], ["console.overview", {}],
      ["backup.config_get", {}], ["backup.list", {}], ["console.assistant_tools", {}],
    ];
    for (const [cap, body] of reads) await ok(d, OWNER_TOKEN, cap, body);

    const writes: [string, Record<string, unknown>][] = [
      ["logs.settings_set", { level: "info" }],
      ["health.run", {}],
      ["network.server_join_code", {}],
      ["console.assistant_open", { page: "access.roles" }],
      ["backup.config_set", { target: { kind: "local", path: target }, schedule: "0 3 * * *", enabled: true }],
    ];
    for (const [cap, body] of writes) await ok(d, OWNER_TOKEN, cap, body);

    // the backup source is the host's: a run writes an archive to the target, and the list shows it
    await ok(d, OWNER_TOKEN, "backup.run", {});
    const listed = (await ok(d, OWNER_TOKEN, "backup.list", {})) as { backups: { backupId: string }[] };
    assert.ok(listed.backups.length >= 1, "the backup is listed");
    const verified = (await ok(d, OWNER_TOKEN, "backup.verify", { backupId: listed.backups[0]!.backupId })) as { ok: boolean };
    assert.equal(verified.ok, true, "the archive restores into a scratch directory and the chain checks");

    // refusals: a member holds none of these permissions
    for (const [cap, body] of [["backup.config_get", {}], ["logs.settings_get", {}], ["network.status", {}], ["logs.settings_set", { level: "debug" }]] as const) {
      const r = await post(d, MEMBER_TOKEN, cap, body);
      assert.equal(r.status, 403, `${cap} refuses a member`);
    }
  } finally { await d.stop(); fs.rmSync(target, { recursive: true, force: true }); }
});
