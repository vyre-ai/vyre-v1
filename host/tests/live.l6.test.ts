// P-L6_LIVE (ruling 32): a booted daemon on the seeded `core` Space reports no L6 module as not set up, and every L6 module is live in host/modules.json.
// Path mapping: the packet owns __live__/L6; this test sits in host/tests because it boots the daemon.
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

const L6 = ["automations", "events", "gate", "home", "journeys", "notifications", "runs", "scheduler-api", "steps-core", "tasks"];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l6-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("l6 live: every L6 module is live in host/modules.json", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L6").map((m) => m.id).sort();
  assert.deepEqual(mine, [...L6].sort());
  for (const m of file.modules.filter((x) => x.owner === "L6")) assert.equal(m.status, "live", `${m.id} is live`);
});

test("l6 live: a booted daemon has a driver for every L6 module, its health lists none of them, and the L6 consumers run", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l6-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const notSetUp = (d.seams?.missing ?? []).filter((m) => m.module !== undefined && L6.includes(m.module));
    assert.deepEqual(notSetUp, [], "no L6 module is reported as not set up");
    const row = (d.db!.all("SELECT detail FROM health_probe WHERE name = ?", "module_drivers")[0] ?? { detail: "" }) as { detail: string };
    for (const id of L6) assert.ok(!new RegExp(`\\b${id}\\b \\(`).test(row.detail), `health does not list ${id} as not set up`);
    const consumers = d.hooks!.consumers.map((c) => c.name);
    for (const name of ["notifications.fanout", "runs.alerts", "events.webhooks_out"]) assert.ok(consumers.includes(name), `${name} is registered`);
    assert.ok(d.hooks!.periodic.some((p) => p.name === "runs.escalations"), "runs.escalations is scheduled");
  } finally { await d.stop(); }
});
