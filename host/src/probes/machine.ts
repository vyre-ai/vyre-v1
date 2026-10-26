// The machine probe (P-H_20, console spec 4): CPU, memory and the data folder's disk, written to health_probe as the row named `machine` so health.machine, and through it the Console
// Overview tiles, show real numbers. The daemon samples once a minute. CPU is the share of non-idle time between two samples; the first sample has only the time since the probe was made,
// and falls back to the one-minute load average per core when that is under a second.
import fs from "node:fs";
import os from "node:os";
import type { Platform } from "../platform/index.ts";
import type { ProbeResult } from "../platform/probes.ts";

export interface CpuTimes { idle: number; total: number }
export interface MachineSource {
  cpus(): CpuTimes;
  loadPerCore(): number;
  memory(): { used: number; total: number };
  /** free and total bytes of the volume that holds `dir`, or null when it cannot be read */
  disk(dir: string): { free: number; total: number } | null;
}

/** Idle and total CPU ticks summed over every core, from os.cpus(). */
export function cpuTimes(cpus: readonly { times: Record<string, number> }[]): CpuTimes {
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const [k, v] of Object.entries(c.times)) { total += v; if (k === "idle") idle += v; }
  }
  return { idle, total };
}

export function nodeMachineSource(): MachineSource {
  return {
    cpus: () => cpuTimes(os.cpus()),
    loadPerCore: () => os.loadavg()[0]! / Math.max(1, os.cpus().length),
    memory: () => ({ used: os.totalmem() - os.freemem(), total: os.totalmem() }),
    disk(dir) {
      try {
        const s = fs.statfsSync(dir);
        return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
      } catch { return null; }
    },
  };
}

const MEMORY_DEGRADED = 0.95;
const DISK_DEGRADED_FREE = 0.05;
const MIN_WINDOW_MS = 1000;

export interface MachineProbe { sample(): ProbeResult }

export function createMachineProbe(o: { platform: Pick<Platform, "now" | "freeBytes">; dataDir: string; source?: MachineSource }): MachineProbe {
  const src = o.source ?? nodeMachineSource();
  let last = { at: o.platform.now(), t: src.cpus() };
  return {
    sample() {
      const at = o.platform.now(), t = src.cpus();
      const total = t.total - last.t.total, idle = t.idle - last.t.idle;
      const windowed = at - last.at >= MIN_WINDOW_MS && total > 0;
      const cpuPercent = Math.min(100, Math.max(0, windowed ? (1 - idle / total) * 100 : src.loadPerCore() * 100));
      last = { at, t };
      const mem = src.memory();
      const disk = src.disk(o.dataDir);
      const free = disk?.free ?? o.platform.freeBytes(o.dataDir);
      const values: Record<string, number> = {
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memoryUsedBytes: Math.trunc(mem.used),
        memoryTotalBytes: Math.trunc(mem.total),
      };
      if (free !== null) values["diskFreeBytes"] = Math.trunc(free);
      if (disk) values["diskTotalBytes"] = Math.trunc(disk.total);
      const memFull = mem.total > 0 && mem.used / mem.total > MEMORY_DEGRADED;
      const diskFull = disk !== null && disk.total > 0 && disk.free / disk.total < DISK_DEGRADED_FREE;
      const state = memFull || diskFull ? "degraded" : "healthy";
      const detail = memFull ? "Memory is almost full." : diskFull ? "The data volume is almost full." : `CPU ${values["cpuPercent"]}%.`;
      return { state, detail, values };
    },
  };
}

/** The write the daemon makes for the `machine` probe (the same row shape the host writes for its other probes). */
export function writeMachineProbe(db: { run(sql: string, ...args: unknown[]): unknown }, now: number, r: ProbeResult): void {
  db.run(
    "INSERT INTO health_probe (name, state, detail, latency_ms, values_json, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, detail = excluded.detail, latency_ms = excluded.latency_ms, values_json = excluded.values_json, at = excluded.at",
    "machine", r.state, r.detail ?? null, null, r.values ? JSON.stringify(r.values) : null, now,
  );
}
