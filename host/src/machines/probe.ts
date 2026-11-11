// The `machine` probe row: CPU, memory and disk of this computer as health.machine (and through it the Console's Infrastructure page) reads them. It is the same sampler the 30-second machine
// report uses (sample.ts), so there is one way of reading the computer; a sampler of its own keeps the report's rates from being disturbed by this one's calls.
import type { Sampler } from "./sample.ts";
import type { ProbeResult } from "../platform/probes.ts";

const MEMORY_DEGRADED = 0.95;
const DISK_DEGRADED_FREE = 0.05;

/** One reading as the probe row health.machine expects it. A number the computer would not give (0 total) is left out, so the page says Unavailable only when it is. */
export function machineProbe(s: Pick<Sampler, "specs" | "load">): ProbeResult {
  const specs = s.specs(), load = s.load();
  const values: Record<string, number> = { cpuPercent: Math.round(load.cpuPct * 10) / 10 };
  if (specs.memBytes > 0) { values["memoryTotalBytes"] = Math.trunc(specs.memBytes); values["memoryUsedBytes"] = Math.trunc(Math.min(load.memUsedBytes, specs.memBytes)); }
  if (specs.diskBytes > 0) { values["diskTotalBytes"] = Math.trunc(specs.diskBytes); values["diskFreeBytes"] = Math.trunc(load.diskFreeBytes); }
  const memFull = specs.memBytes > 0 && load.memUsedBytes / specs.memBytes > MEMORY_DEGRADED;
  const diskFull = specs.diskBytes > 0 && load.diskFreeBytes / specs.diskBytes < DISK_DEGRADED_FREE;
  return {
    state: memFull || diskFull ? "degraded" : "healthy",
    detail: memFull ? "Memory is almost full." : diskFull ? "The data volume is almost full." : `CPU ${values["cpuPercent"]}%.`,
    values,
  };
}

/** The write the daemon makes for the `machine` row (the same row shape the host writes for its other probes). */
export function writeMachineProbe(db: { run(sql: string, ...args: unknown[]): unknown }, now: number, r: ProbeResult): void {
  db.run(
    "INSERT INTO health_probe (name, state, detail, latency_ms, values_json, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state, detail = excluded.detail, latency_ms = excluded.latency_ms, values_json = excluded.values_json, at = excluded.at",
    "machine", r.state, r.detail ?? null, null, r.values ? JSON.stringify(r.values) : null, now,
  );
}
