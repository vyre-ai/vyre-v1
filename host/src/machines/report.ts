// The 30-second report of a machine (lane l-machines): specs, load, what Vyre runs on it, what it can run, its version. Every Vyre daemon sends one over the link it already holds to the Space
// (a person's computer over the device link, an added server over the node socket); the Space server reads its own. The Space never trusts a number: parseReport clamps everything it keeps.
//   device or node -> Space   {t:"report", specs, load, runs, can, version, vyre?}      Space -> device or node   {t:"ping", at}  answered by  {t:"pong", at}   (the Space measures the round trip)
export const CAN = ["claude_code", "codex", "docker", "chrome"] as const;
export type Can = (typeof CAN)[number];

export interface Specs { os: string; arch: string; cores: number; memBytes: number; diskBytes: number; gpu?: string }
export interface Load { cpuPct: number; memUsedBytes: number; diskFreeBytes: number; netInBps: number; netOutBps: number }
export interface Runs { turns: number; agentComputers: number; sites: number; automations: number }
/** Vyre's own share of this machine: its processes' CPU and memory. */
export interface VyreShare { cpuPct: number; memBytes: number }
export interface Report { specs: Specs; load: Load; runs: Runs; can: Can[]; version: string; vyre?: VyreShare }

/** One report is far smaller than this; a longer frame is not one. */
export const MAX_REPORT_BYTES = 4096;
/** How often a machine reports. */
export const REPORT_EVERY_MS = 30_000;
/** A machine that has said nothing for this long is offline (three reports missed). */
export const OFFLINE_AFTER_MS = 90_000;

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : null);
const TB = 2 ** 50;

/** A report as the machine sent it, or null when it is not one. Numbers are clamped, text is cut, `can` keeps only known names. */
export function parseReport(x: unknown): Report | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  const s = (m["specs"] ?? {}) as Record<string, unknown>, l = (m["load"] ?? {}) as Record<string, unknown>, r = (m["runs"] ?? {}) as Record<string, unknown>;
  const os = text(s["os"], 80), arch = text(s["arch"], 24), cores = num(s["cores"], 1, 4096), memBytes = num(s["memBytes"], 0, TB), diskBytes = num(s["diskBytes"], 0, TB);
  const cpu = num(l["cpuPct"], 0, 100), memUsed = num(l["memUsedBytes"], 0, TB), diskFree = num(l["diskFreeBytes"], 0, TB), nin = num(l["netInBps"], 0, TB), nout = num(l["netOutBps"], 0, TB);
  const version = text(m["version"], 40);
  if (os === null || arch === null || cores === null || memBytes === null || diskBytes === null || cpu === null || memUsed === null || diskFree === null || version === null) return null;
  const gpu = text(s["gpu"], 80);
  const can = Array.isArray(m["can"]) ? [...new Set(m["can"].filter((c): c is Can => (CAN as readonly unknown[]).includes(c)))] : [];
  const v = (m["vyre"] ?? null) as Record<string, unknown> | null;
  const vc = v ? num(v["cpuPct"], 0, 100) : null, vm = v ? num(v["memBytes"], 0, TB) : null;
  return {
    specs: { os, arch, cores: Math.round(cores), memBytes: Math.round(memBytes), diskBytes: Math.round(diskBytes), ...(gpu ? { gpu } : {}) },
    load: { cpuPct: Math.round(cpu * 10) / 10, memUsedBytes: Math.round(Math.min(memUsed, memBytes || memUsed)), diskFreeBytes: Math.round(Math.min(diskFree, diskBytes || diskFree)), netInBps: Math.round(nin ?? 0), netOutBps: Math.round(nout ?? 0) },
    runs: { turns: Math.round(num(r["turns"], 0, 10_000) ?? 0), agentComputers: Math.round(num(r["agentComputers"], 0, 10_000) ?? 0), sites: Math.round(num(r["sites"], 0, 10_000) ?? 0), automations: Math.round(num(r["automations"], 0, 100_000) ?? 0) },
    can, version,
    ...(vc !== null && vm !== null ? { vyre: { cpuPct: Math.round(vc * 10) / 10, memBytes: Math.round(vm) } } : {}),
  };
}
