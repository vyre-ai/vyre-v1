// P-H_20: the daemon writes a health_probe row named `machine` (CPU, memory, the data folder's disk), and a person with console.access reads it through console.overview. The probe's own arithmetic
// is tested with a scripted source; the booted test goes the way a person does, through the gateway with a token, and includes the refusal for a member without console.access (rule 27).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { cpuTimes, createMachineProbe } from "../src/probes/machine.ts";
import type { CpuTimes, MachineSource } from "../src/probes/machine.ts";

// ---- the probe ----

function scripted(): { src: MachineSource; set(v: Partial<{ cpus: CpuTimes; load: number; mem: { used: number; total: number }; disk: { free: number; total: number } | null }>): void } {
  const v = { cpus: { idle: 0, total: 0 }, load: 0.5, mem: { used: 4_000, total: 16_000 }, disk: { free: 700, total: 1_000 } as { free: number; total: number } | null };
  return { src: { cpus: () => v.cpus, loadPerCore: () => v.load, memory: () => v.mem, disk: () => v.disk }, set: (p) => { Object.assign(v, p); } };
}

test("cpuTimes sums idle and total ticks over every core", () => {
  assert.deepEqual(cpuTimes([{ times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } }, { times: { user: 30, nice: 0, sys: 10, idle: 60, irq: 0 } }]), { idle: 145, total: 200 });
});

test("machine probe: CPU is the busy share between two samples, memory and disk are as read, and a full disk or memory degrades it", () => {
  let clock = 0;
  const s = scripted();
  const p = createMachineProbe({ platform: { now: () => clock, freeBytes: () => null }, dataDir: "/d", source: s.src });
  clock = 60_000;
  s.set({ cpus: { idle: 75, total: 100 } });
  const a = p.sample();
  assert.equal(a.state, "healthy");
  assert.deepEqual(a.values, { cpuPercent: 25, memoryUsedBytes: 4_000, memoryTotalBytes: 16_000, diskFreeBytes: 700, diskTotalBytes: 1_000 });
  clock = 120_000;
  s.set({ cpus: { idle: 175, total: 300 }, mem: { used: 15_900, total: 16_000 } });
  const b = p.sample();
  assert.equal(b.values!["cpuPercent"], 50, "the second sample counts only the time since the first");
  assert.equal(b.state, "degraded");
  assert.match(b.detail!, /Memory is almost full/);
  s.set({ mem: { used: 1, total: 16_000 }, disk: { free: 20, total: 1_000 } });
  clock = 180_000;
  assert.match(p.sample().detail!, /data volume is almost full/);
});

test("machine probe: a sample under a second after the last uses the load average, and an unreadable volume leaves the disk numbers out", () => {
  const s = scripted();
  s.set({ load: 0.25, disk: null });
  const p = createMachineProbe({ platform: { now: () => 5, freeBytes: () => null }, dataDir: "/d", source: s.src });
  const r = p.sample();
  assert.equal(r.values!["cpuPercent"], 25);
  assert.equal("diskFreeBytes" in r.values!, false);
  assert.equal("diskTotalBytes" in r.values!, false);
});

// ---- booted ----

const OLIVIA = "usr_olivia";   // the seeded owner
const SANA = "usr_sana";   // a member without console.access
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-machine-probe-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** The real code root, except host/modules.json lists health and console-views as live (the live flips are P-CI_02). */
function codeRootWithConsoleLive(): string {
  const root = tmp("vyre-machine-probe-root-");
  for (const name of fs.readdirSync(CODE_ROOT)) {
    if (name.startsWith(".") || name === "host") continue;
    fs.symlinkSync(path.join(CODE_ROOT, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "host"))) {
    if (name !== "modules.json") fs.symlinkSync(path.join(CODE_ROOT, "host", name), path.join(root, "host", name));
  }
  const list = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  for (const id of ["health", "console-views"]) {
    const m = list.modules.find((x) => x.id === id);
    assert.ok(m, `${id} is in host/modules.json`);
    m.status = "live";
  }
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

async function boot(dir: string): Promise<Daemon> {
  let token = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithConsoleLive(),
    platform: fakePlatform({
      os: "linux", hostname: "machine-probe", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    // who calls: the owner by default; a member when the request says so
    session: (h) => {
      if (h["authorization"] !== `Bearer ${token}`) return null;
      return h["x-test-as"] === "member"
        ? { space: CORE_SPACE, principal: { kind: "person", id: SANA }, device: "test-device" }
        : { space: CORE_SPACE, principal: { kind: "person", id: OLIVIA }, device: "test-device" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, machine: 3_600_000 },
  });
  token = d.token;
  return d;
}

const post = (d: Daemon, cap: string, as?: "member"): Promise<Response> =>
  fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}`, ...(as ? { "x-test-as": as } : {}) }, body: "{}" });

test("the daemon writes the machine probe at start, and console.overview returns its numbers to a person with console.access and refuses a member without it", async () => {
  const d = await boot(seededDir());
  try {
    const row = d.db!.all("SELECT state, values_json FROM health_probe WHERE name = 'machine'")[0] as { state: string; values_json: string } | undefined;
    assert.ok(row, "the probe row is written at start");
    const values = JSON.parse(row.values_json) as Record<string, number>;
    for (const k of ["cpuPercent", "memoryUsedBytes", "memoryTotalBytes", "diskFreeBytes", "diskTotalBytes"]) assert.equal(typeof values[k], "number", k);
    assert.ok(values["memoryTotalBytes"]! > 0 && values["diskTotalBytes"]! > 0);

    const ok = await post(d, "console.overview");
    const body = (await ok.json()) as { data?: { machine?: Record<string, number> }; error?: unknown };
    assert.equal(ok.status, 200, JSON.stringify(body));
    assert.deepEqual(Object.keys(body.data!.machine ?? {}).sort(), ["cpuPercent", "diskFreeBytes", "diskTotalBytes", "memoryTotalBytes", "memoryUsedBytes"], "the tiles get real numbers");
    assert.ok(body.data!.machine!["memoryTotalBytes"]! > 0);

    const refused = await post(d, "console.overview", "member");
    assert.equal(refused.status, 403, "a member without console.access is refused");
  } finally { await d.stop(); }
});
