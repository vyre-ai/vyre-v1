// Reading this computer (lane l-machines): its specs and its load, for the 30-second report. Everything it touches is a dep, so a test feeds numbers and checks the arithmetic; the defaults read the real
// machine with the standard library and, where the platform keeps a number elsewhere, one short read of /proc or one short program run (netstat and vm_stat on a Mac).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import type { Can, Load, Report, Runs, Specs, VyreShare } from "./report.ts";

export interface CpuTimes { idle: number; total: number }
export interface SampleDeps {
  platform: NodeJS.Platform;
  arch: string;
  cpus(): CpuTimes[];
  coreCount(): number;
  totalMem(): number;
  /** Memory in use, bytes (what the machine cannot give back at once: not cache). */
  usedMem(): number;
  /** Disk of the data folder: total and free bytes. */
  disk(): { total: number; free: number };
  /** Bytes in and out since boot, over every real interface. */
  net(): { in: number; out: number };
  /** This process's CPU time in microseconds and its resident memory. */
  self(): { cpuUs: number; rss: number };
  now(): number;
  osName(): string;
  /** The graphics card's name, once known (it takes a moment to ask). */
  gpu(): string | undefined;
  /** Which of Claude Code, Codex, Docker and a connected Chrome this machine runs. */
  can(): Can[];
}

export interface Sampler {
  specs(): Specs;
  /** CPU and network are rates since the last call; the first call reports no load for them. */
  load(): Load;
  vyre(): VyreShare;
}

export function createSampler(d: SampleDeps): Sampler {
  let lastCpu: CpuTimes | null = null, lastNet: { in: number; out: number; at: number } | null = null, lastSelf: { cpuUs: number; at: number } | null = null;
  const sum = (c: CpuTimes[]): CpuTimes => c.reduce((a, x) => ({ idle: a.idle + x.idle, total: a.total + x.total }), { idle: 0, total: 0 });
  return {
    specs() {
      const disk = d.disk(), gpu = d.gpu();
      return { os: d.osName(), arch: d.arch, cores: d.coreCount(), memBytes: d.totalMem(), diskBytes: disk.total, ...(gpu ? { gpu } : {}) };
    },
    load() {
      const now = d.now(), c = sum(d.cpus());
      let cpu = 0;
      if (lastCpu && c.total > lastCpu.total) cpu = Math.max(0, Math.min(100, (1 - (c.idle - lastCpu.idle) / (c.total - lastCpu.total)) * 100));
      lastCpu = c;
      const n = d.net();
      let nin = 0, nout = 0;
      if (lastNet && now > lastNet.at) {
        const s = (now - lastNet.at) / 1000;
        nin = Math.max(0, (n.in - lastNet.in) / s); nout = Math.max(0, (n.out - lastNet.out) / s);
      }
      lastNet = { ...n, at: now };
      return { cpuPct: cpu, memUsedBytes: d.usedMem(), diskFreeBytes: d.disk().free, netInBps: nin, netOutBps: nout };
    },
    vyre() {
      const now = d.now(), s = d.self();
      let cpu = 0;
      if (lastSelf && now > lastSelf.at) cpu = Math.max(0, Math.min(100, ((s.cpuUs - lastSelf.cpuUs) / 1000 / (now - lastSelf.at)) * 100 / Math.max(1, d.coreCount())));
      lastSelf = { cpuUs: s.cpuUs, at: now };
      return { cpuPct: cpu, memBytes: s.rss };
    },
  };
}

/** A whole report: specs, load, Vyre's share, and the parts only the daemon knows (what it runs, its version). */
export function buildReport(s: Sampler, o: { runs: Runs; can: readonly Can[]; version: string }): Report {
  return { specs: s.specs(), load: s.load(), vyre: s.vyre(), runs: o.runs, can: [...o.can], version: o.version };
}

// ---- the real machine ----

const run = (file: string, args: string[], ms = 3000): Promise<string> => new Promise((resolve) => { execFile(file, args, { timeout: ms, encoding: "utf8" }, (e, out) => resolve(e ? "" : out)); });
const readText = (p: string): string => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/** MemAvailable from /proc/meminfo: what is not in use, caches counted as free. */
export function linuxUsedMem(meminfo: string, total: number): number {
  const m = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo);
  return m ? Math.max(0, total - Number(m[1]) * 1024) : 0;
}
/** Sum of bytes in and out over every interface but loopback and virtual bridges (/proc/net/dev). */
export function linuxNet(dev: string): { in: number; out: number } {
  let i = 0, o = 0;
  for (const line of dev.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!name || !rest) continue;
    const n = name.trim();
    if (n === "lo" || /^(docker|br-|veth|virbr)/.test(n)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    i += f[0] ?? 0; o += f[8] ?? 0;
  }
  return { in: i, out: o };
}
/** Pages in use from `vm_stat` (active, wired and compressed), times the page size. */
export function macUsedMem(vmstat: string): number {
  const size = Number(/page size of (\d+) bytes/.exec(vmstat)?.[1] ?? 16384);
  const pages = (k: string): number => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(vmstat)?.[1] ?? 0);
  return (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * size;
}
/** Bytes in and out over the real interfaces from `netstat -ib` (the <Link#n> row of each en*). */
export function macNet(netstat: string): { in: number; out: number } {
  let i = 0, o = 0;
  const seen = new Set<string>();
  for (const line of netstat.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (!f[0] || !/^en\d+$/.test(f[0]) || !/^<Link#/.test(f[2] ?? "") || seen.has(f[0])) continue;
    seen.add(f[0]);
    // Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll (the Address column is absent for some links)
    const nums = f.slice(3).filter((x) => /^\d+$/.test(x)).map(Number);
    const tail = nums.slice(-7);
    i += tail[2] ?? 0; o += tail[5] ?? 0;
  }
  return { in: i, out: o };
}

let gpuName: string | undefined, gpuAsked = false;
function askGpu(platform: NodeJS.Platform): void {
  if (gpuAsked) return;
  gpuAsked = true;
  if (platform === "darwin") void run("/usr/sbin/system_profiler", ["SPDisplaysDataType"], 8000).then((t) => { gpuName = /Chipset Model:\s*(.+)/.exec(t)?.[1]?.trim() || undefined; });
  else if (platform === "linux") void run("lspci", [], 4000).then((t) => { gpuName = /(?:VGA compatible controller|3D controller)[^:]*:\s*(.+)/.exec(t)?.[1]?.trim().slice(0, 80) || undefined; });
}
let osText: string | undefined;
function askOs(platform: NodeJS.Platform): void {
  if (osText) return;
  osText = `${os.type()} ${os.release()}`;
  if (platform === "darwin") void run("/usr/bin/sw_vers", ["-productVersion"], 2000).then((t) => { if (t.trim()) osText = `macOS ${t.trim()}`; });
  else if (platform === "linux") osText = /^PRETTY_NAME="?([^"\n]+)/m.exec(readText("/etc/os-release"))?.[1] ?? osText;
  else if (platform === "win32") osText = os.version();
}
let netNow = { in: 0, out: 0 }, netBusy = false, macMem = 0, memBusy = false;

/** The real thing for this computer. `dataDir` is the folder whose disk is reported; `can` says what the daemon found it can run. */
export function realDeps(o: { dataDir: string; can(): Can[] }): SampleDeps {
  const platform = process.platform;
  askGpu(platform); askOs(platform);
  return {
    platform, arch: os.arch(),
    cpus: () => os.cpus().map((c) => ({ idle: c.times.idle, total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq })),
    coreCount: () => Math.max(1, os.cpus().length),
    totalMem: () => os.totalmem(),
    usedMem: () => {
      if (platform === "linux") return linuxUsedMem(readText("/proc/meminfo"), os.totalmem()) || os.totalmem() - os.freemem();
      if (platform === "darwin" && !memBusy) { memBusy = true; void run("/usr/bin/vm_stat", [], 2000).then((t) => { if (t) macMem = macUsedMem(t); memBusy = false; }); }
      return platform === "darwin" && macMem > 0 ? macMem : os.totalmem() - os.freemem();
    },
    disk: () => { try { const s = fs.statfsSync(o.dataDir); return { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) }; } catch { return { total: 0, free: 0 }; } },
    net: () => {
      if (platform === "linux") return linuxNet(readText("/proc/net/dev"));
      if (platform === "darwin" && !netBusy) { netBusy = true; void run("/usr/sbin/netstat", ["-ib"], 2000).then((t) => { if (t) netNow = macNet(t); netBusy = false; }); }
      return netNow;
    },
    self: () => { const c = process.cpuUsage(); return { cpuUs: c.user + c.system, rss: process.memoryUsage().rss }; },
    now: () => Date.now(), osName: () => osText ?? `${os.type()} ${os.release()}`, gpu: () => gpuName, can: o.can,
  };
}
