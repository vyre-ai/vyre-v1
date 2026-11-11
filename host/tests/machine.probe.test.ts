// The Console's Infrastructure page reads health.machine, which reads the health_probe row named machine. The host writes it from the one sampler the machine report uses: at start and then on a timer.
// Daemon level, real health module; only the computer's numbers are a fake, so the test can say what they are and change them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { SampleDeps } from "../src/machines/sample.ts";
import { machineProbe } from "../src/machines/probe.ts";
import { createSampler } from "../src/machines/sample.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const GB = 1e9;

const fakeComputer = (state: { used: number; free: number; idle: number; total: number }): SampleDeps => ({
  platform: "linux", arch: "x64", coreCount: () => 4, totalMem: () => 16 * GB, usedMem: () => state.used,
  cpus: () => [{ idle: state.idle, total: state.total }], disk: () => ({ total: 500 * GB, free: state.free }), net: () => ({ in: 0, out: 0 }),
  self: () => ({ cpuUs: 0, rss: 1e8 }), now: () => Date.now(), osName: () => "Linux", gpu: () => undefined, can: () => [],
});

test("machineProbe turns one reading into the numbers health.machine shows, and is degraded when memory or disk is nearly full", () => {
  const st = { used: 4 * GB, free: 200 * GB, idle: 0, total: 0 };
  const sampler = createSampler(fakeComputer(st));
  sampler.load();
  st.idle = 750; st.total = 1000;
  const ok = machineProbe(sampler);
  assert.equal(ok.state, "healthy");
  assert.deepEqual(ok.values, { cpuPercent: 25, memoryTotalBytes: 16 * GB, memoryUsedBytes: 4 * GB, diskTotalBytes: 500 * GB, diskFreeBytes: 200 * GB });
  st.used = 16 * GB;
  assert.equal(machineProbe(sampler).state, "degraded", "memory almost full");
  st.used = 4 * GB; st.free = 10 * GB;
  assert.equal(machineProbe(sampler).state, "degraded", "disk almost full");
});

test("after start the host has written the machine reading, health.machine returns sane numbers, and the reading refreshes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-machine-probe-"));
  const st = { used: 6 * GB, free: 300 * GB, idle: 0, total: 0 };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_mach", "--space-name", "Mach Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "mach", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    machineDeps: fakeComputer(st),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, machineProbe: 150 },
  });
  const post = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: { data?: any } }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    assert.equal((await post(null, "/v1/identity/claim_owner", { code, spaceId: "spc_mach", username: "olivia", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS })).status, 200);
    const owner = (await post(null, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, deviceName: "Laptop", deviceClass: "desktop" })).body.data.session.token as string;

    const first = await post(owner, "/v1/health/machine", {});
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const m = first.body.data.machine as Record<string, number>;
    assert.ok(m, `the machine reading is present right after start: ${JSON.stringify(first.body.data)}`);
    assert.equal(m["memoryTotalBytes"], 16 * GB);
    assert.equal(m["memoryUsedBytes"], 6 * GB);
    assert.equal(m["diskTotalBytes"], 500 * GB);
    assert.equal(m["diskFreeBytes"], 300 * GB);
    assert.ok(m["cpuPercent"]! >= 0 && m["cpuPercent"]! <= 100, "cpu is a percentage");
    assert.ok(m["memoryUsedBytes"]! <= m["memoryTotalBytes"]!, "used memory is within the total");
    assert.ok(m["diskFreeBytes"]! <= m["diskTotalBytes"]!, "free disk is within the total");
    assert.equal(first.body.data.state, "healthy");

    // it refreshes: the computer's numbers change and the reading follows
    st.used = 9 * GB; st.free = 250 * GB;
    let seen = 0;
    for (let i = 0; i < 40 && seen !== 9 * GB; i++) {
      await new Promise((r) => setTimeout(r, 100));
      seen = ((await post(owner, "/v1/health/machine", {})).body.data.machine as Record<string, number>)["memoryUsedBytes"]!;
    }
    assert.equal(seen, 9 * GB, "the reading refreshed on its timer");
    assert.equal(((await post(owner, "/v1/health/machine", {})).body.data.machine as Record<string, number>)["diskFreeBytes"], 250 * GB);
  } finally { await d.stop(); }
});
