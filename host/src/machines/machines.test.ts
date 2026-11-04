// The report and the sampler (lane l-machines): what a report may carry, and the arithmetic of the load numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { parseReport } from "./report.ts";
import { buildReport, createSampler, linuxNet, linuxUsedMem, macNet, macUsedMem } from "./sample.ts";
import type { SampleDeps } from "./sample.ts";

const GB = 1024 ** 3;
const good = {
  specs: { os: "macOS 15.1", arch: "arm64", cores: 10, memBytes: 32 * GB, diskBytes: 994 * GB, gpu: "Apple M2 Pro" },
  load: { cpuPct: 12.34, memUsedBytes: 8 * GB, diskFreeBytes: 600 * GB, netInBps: 1000, netOutBps: 500 },
  runs: { turns: 2, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code", "docker", "bogus", "docker"], version: "1.4.1", vyre: { cpuPct: 2, memBytes: 500_000_000 },
};

test("a report keeps known names, clamps numbers and cuts text", () => {
  const r = parseReport(good)!;
  assert.deepEqual(r.can, ["claude_code", "docker"]);
  assert.equal(r.load.cpuPct, 12.3);
  const hostile = parseReport({ ...good, specs: { ...good.specs, os: "x".repeat(500), cores: 99999 }, load: { ...good.load, cpuPct: 4000, memUsedBytes: 999 * GB, diskFreeBytes: 9e15 } })!;
  assert.equal(hostile.specs.os.length, 80);
  assert.equal(hostile.specs.cores, 4096);
  assert.equal(hostile.load.cpuPct, 100);
  assert.equal(hostile.load.memUsedBytes, 32 * GB, "memory in use is never more than the memory there is");
  assert.equal(hostile.load.diskFreeBytes, 994 * GB);
});

test("a thing that is not a report is not one", () => {
  for (const bad of [null, "x", 5, {}, { ...good, version: "" }, { ...good, specs: { ...good.specs, arch: 3 } }, { ...good, load: { ...good.load, cpuPct: "high" } }, { ...good, load: undefined }]) assert.equal(parseReport(bad), null);
});

function deps(over: Partial<SampleDeps> = {}): SampleDeps & { t: number; cpu: { idle: number; total: number }; netv: { in: number; out: number }; cpuUs: number } {
  const d = {
    t: 1_000_000, cpu: { idle: 0, total: 0 }, netv: { in: 0, out: 0 }, cpuUs: 0,
    platform: "linux" as const, arch: "x64", cpus: () => [d.cpu], coreCount: () => 4, totalMem: () => 8 * GB, usedMem: () => 3 * GB, disk: () => ({ total: 100 * GB, free: 40 * GB }),
    net: () => d.netv, self: () => ({ cpuUs: d.cpuUs, rss: 700_000_000 }), now: () => d.t, osName: () => "Ubuntu 24.04", gpu: () => undefined, can: () => ["claude_code" as const],
    ...over,
  };
  return d as never;
}

test("CPU and network are rates since the last read; the first read has none", () => {
  const d = deps();
  const s = createSampler(d);
  assert.deepEqual(s.load(), { cpuPct: 0, memUsedBytes: 3 * GB, diskFreeBytes: 40 * GB, netInBps: 0, netOutBps: 0 });
  d.t += 10_000; d.cpu = { idle: 600, total: 1000 }; d.netv = { in: 50_000, out: 20_000 };
  const l = s.load();
  assert.equal(Math.round(l.cpuPct), 40);
  assert.equal(l.netInBps, 5000);
  assert.equal(l.netOutBps, 2000);
});

test("Vyre's own share is its CPU time over the wall time and the cores", () => {
  const d = deps();
  const s = createSampler(d);
  s.vyre();
  d.t += 10_000; d.cpuUs = 4_000_000;   // 4 CPU seconds in 10 s on 4 cores = 10%
  assert.deepEqual(s.vyre(), { cpuPct: 10, memBytes: 700_000_000 });
});

test("the specs and a whole report", () => {
  const s = createSampler(deps());
  assert.deepEqual(s.specs(), { os: "Ubuntu 24.04", arch: "x64", cores: 4, memBytes: 8 * GB, diskBytes: 100 * GB });
  const r = buildReport(s, { runs: { turns: 1, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code"], version: "1.0.0" });
  assert.ok(parseReport(r), "what a daemon builds is what the Space accepts");
});

test("the platform readers", () => {
  assert.equal(linuxUsedMem("MemTotal: 8000000 kB\nMemAvailable:    2000000 kB\n", 8_000_000 * 1024), 6_000_000 * 1024);
  assert.deepEqual(linuxNet("Inter-|   Receive\n face |bytes\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 1000 5 0 0 0 0 0 0 2000 6 0 0 0 0 0 0\ndocker0: 77 1 0 0 0 0 0 0 88 1 0 0 0 0 0 0\n"), { in: 1000, out: 2000 });
  assert.equal(macUsedMem("Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\nPages active: 1000.\nPages wired down: 500.\nPages occupied by compressor: 100.\n"), 1600 * 16384);
  assert.deepEqual(macNet("Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nlo0 16384 <Link#1> 10 0 5000 10 0 5000 0\nen0 1500 <Link#4> a4:83:e7:1:2:3 1000 0 123456 900 0 654321 0\nen0 1500 192.168.1 192.168.1.5 1000 - 123456 900 - 654321 -\n"), { in: 123456, out: 654321 });
});
