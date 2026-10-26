// The Files root folders reach the access module's tables once, however many times the daemon starts (ruling 65 with ruling 70): a second boot on the same data directory neither fails nor
// adds rows, and the folders are there for authorize.
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

test("booting twice on one data directory registers the Files root folders once and fails on nothing", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-files-res-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const boot = () => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "files-res", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const count = (d: Awaited<ReturnType<typeof boot>>): { folders: number; rows: number } => ({
    folders: Number((d.db!.all("SELECT COUNT(*) AS n FROM access_resources WHERE type = 'folder'")[0] as { n: number }).n),
    rows: Number((d.db!.all("SELECT COUNT(*) AS n FROM access_resources")[0] as { n: number }).n),
  });
  const first = await boot();
  const one = count(first);
  await first.stop();
  assert.ok(one.folders > 0, "the Files root folders are in the access module's tables");
  const second = await boot();
  try {
    assert.deepEqual(count(second), one, "a second boot adds nothing");
  } finally { await second.stop(); }
});
