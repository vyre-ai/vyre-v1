// Machines projections (lane l-machines): the machine rows, the load points and how they thin out, the privacy rule, room left and the alerts. Every statement names only machines_* tables
// (ctx.db refuses anything else, ARCH B2).
//
// Points: one per machine per minute, kept raw for 24 hours (res 1), then folded into ten-minute points (res 10) and kept for 30 days. That is at most 1440 + 29 x 144 = 5616 rows a machine, a few
// hundred kilobytes (the size budget test holds it). A series for a window is built at read time from both.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { OFFLINE_AFTER_MS } from "../../host/src/machines/report.ts";
import type { Can, Load, Report, Runs, Specs, VyreShare } from "../../host/src/machines/report.ts";
import { roomLeft } from "../../lib/room-left.ts";
import type { Room } from "../../lib/room-left.ts";

export type Kind = "space" | "server" | "computer";
export interface Db { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
export interface MachinesCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  origin?: string;
  depth?: number;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: { idempotencyKey?: string }): unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Raw minutes are kept this long, ten-minute points this long. */
export const RAW_MS = DAY;
export const KEEP_MS = 30 * DAY;
/** The default most turns at once on a machine that was not given a limit: one per two cores, at least 1 (a person's computer is gentler: at most 4). */
export const defaultMaxTurns = (kind: Kind, cores: number): number => (kind === "computer" ? Math.max(1, Math.min(4, Math.floor(cores / 2))) : Math.max(1, Math.floor(cores / 2)));

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}

// ---- schema ----

const SCHEMA = readFileSync(new URL("./migrations/0001_machines.sql", import.meta.url), "utf8")
  .split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { db.all("SELECT machine_id FROM machines_machine WHERE machine_id = ?", "probe"); db.all("SELECT machine_id FROM machines_point WHERE machine_id = ?", "probe"); db.all("SELECT key FROM machines_meta WHERE key = ?", "probe"); }
  catch { for (const s of SCHEMA) db.run(s); }
  ready.add(db);
}

// ---- rows ----

export interface Rec {
  machineId: string; kind: Kind; name: string; ownerId: string | null; nickname: string | null; maxTurns: number | null; maxAgentComputers: number | null; drain: boolean;
  specs: Specs | null; load: Load | null; runs: Runs | null; can: Can[]; vyre: VyreShare | null; version: string | null; latencyMs: number | null; lastSeen: number | null; firstSeen: number;
}
const json = <T>(s: unknown): T | null => { if (typeof s !== "string") return null; try { return JSON.parse(s) as T; } catch { return null; } };
export function recOf(r: Record<string, unknown>): Rec {
  return {
    machineId: r["machine_id"] as string, kind: r["kind"] as Kind, name: r["name"] as string, ownerId: (r["owner_id"] as string | null) ?? null, nickname: (r["nickname"] as string | null) ?? null,
    maxTurns: (r["max_turns"] as number | null) ?? null, maxAgentComputers: (r["max_agent_computers"] as number | null) ?? null, drain: r["drain"] === 1,
    specs: json<Specs>(r["specs"]), load: json<Load>(r["load"]), runs: json<Runs>(r["runs"]), can: json<Can[]>(r["can"]) ?? [], vyre: json<VyreShare>(r["vyre"]), version: (r["version"] as string | null) ?? null,
    latencyMs: (r["latency_ms"] as number | null) ?? null, lastSeen: (r["last_seen"] as number | null) ?? null, firstSeen: r["first_seen"] as number,
  };
}
export function machineById(ctx: MachinesCtx, id: string): Rec | null {
  ensure(ctx.db);
  const r = ctx.db.all("SELECT * FROM machines_machine WHERE machine_id = ?", id)[0] as Record<string, unknown> | undefined;
  return r ? recOf(r) : null;
}
export function allMachines(ctx: MachinesCtx): Rec[] {
  ensure(ctx.db);
  const rank: Record<Kind, number> = { space: 0, server: 1, computer: 2 };
  return (ctx.db.all("SELECT * FROM machines_machine ORDER BY first_seen, machine_id") as Record<string, unknown>[]).map(recOf).sort((a, b) => rank[a.kind] - rank[b.kind] || a.firstSeen - b.firstSeen || (a.machineId < b.machineId ? -1 : 1));
}
export function pinsOf(ctx: MachinesCtx, id?: string): Array<{ machineId: string; agentId: string }> {
  ensure(ctx.db);
  const rows = (id ? ctx.db.all("SELECT machine_id, agent_id FROM machines_pin WHERE machine_id = ? ORDER BY at, agent_id", id) : ctx.db.all("SELECT machine_id, agent_id FROM machines_pin ORDER BY at, agent_id")) as Array<Record<string, string>>;
  return rows.map((r) => ({ machineId: r["machine_id"]!, agentId: r["agent_id"]! }));
}

/** Online: the Space server always is; any other machine when it reported within three report periods. */
export const isOnline = (r: Rec, now: number): boolean => r.kind === "space" || (r.lastSeen !== null && now - r.lastSeen <= OFFLINE_AFTER_MS);

// ---- ingest ----

export interface Ingest { machineId: string; kind: Kind; name: string; ownerId?: string; report: Report; latencyMs?: number }

/** Record one report: the machine's latest facts, and its load into the current minute's point (averaged with the other report of the minute). */
export function ingest(ctx: MachinesCtx, i: Ingest): void {
  ensure(ctx.db);
  const now = ctx.now(), r = i.report;
  const have = ctx.db.all("SELECT 1 AS x FROM machines_machine WHERE machine_id = ?", i.machineId).length > 0;
  const facts = [JSON.stringify(r.specs), JSON.stringify(r.load), JSON.stringify(r.runs), JSON.stringify(r.can), r.vyre ? JSON.stringify(r.vyre) : null, r.version, i.latencyMs ?? null, now] as const;
  if (have) {
    ctx.db.run("UPDATE machines_machine SET kind = ?, name = ?, owner_id = COALESCE(?, owner_id), specs = ?, load = ?, runs = ?, can = ?, vyre = ?, version = ?, latency_ms = COALESCE(?, latency_ms), last_seen = ? WHERE machine_id = ?", i.kind, i.name, i.ownerId ?? null, ...facts, i.machineId);
  } else {
    ctx.db.run("INSERT INTO machines_machine (machine_id, kind, name, owner_id, specs, load, runs, can, vyre, version, latency_ms, last_seen, first_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", i.machineId, i.kind, i.name, i.ownerId ?? null, ...facts, now);
  }
  const t = Math.floor(now / MINUTE) * MINUTE;
  const mem = r.specs.memBytes > 0 ? (r.load.memUsedBytes / r.specs.memBytes) * 100 : null;
  const disk = r.specs.diskBytes > 0 ? (r.load.diskFreeBytes / r.specs.diskBytes) * 100 : null;
  addPoint(ctx.db, i.machineId, 1, t, 1, { cpu: r.load.cpuPct, mem, disk, nin: r.load.netInBps, nout: r.load.netOutBps, vcpu: r.vyre?.cpuPct ?? null, vmem: r.vyre?.memBytes ?? null });
}

type Vals = { cpu: number | null; mem: number | null; disk: number | null; nin: number | null; nout: number | null; vcpu: number | null; vmem: number | null };
const KEYS = ["cpu", "mem", "disk", "nin", "nout", "vcpu", "vmem"] as const;
const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

/** Add values to a bucket, as the weighted average of what is there and what is new (n counts the reports behind each). */
function addPoint(db: Db, id: string, res: number, t: number, n: number, v: Vals): void {
  const old = db.all("SELECT n, cpu, mem, disk, nin, nout, vcpu, vmem FROM machines_point WHERE machine_id = ? AND res = ? AND t = ?", id, res, t)[0] as (Vals & { n: number }) | undefined;
  if (!old) {
    db.run("INSERT INTO machines_point (machine_id, res, t, n, cpu, mem, disk, nin, nout, vcpu, vmem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, res, t, n, round(v.cpu), round(v.mem), round(v.disk), round(v.nin), round(v.nout), round(v.vcpu), round(v.vmem));
    return;
  }
  const mix = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : (a * old.n + b * n) / (old.n + n));
  db.run("UPDATE machines_point SET n = ?, cpu = ?, mem = ?, disk = ?, nin = ?, nout = ?, vcpu = ?, vmem = ? WHERE machine_id = ? AND res = ? AND t = ?",
    old.n + n, ...KEYS.map((k) => round(mix(old[k], v[k]))), id, res, t);
}

/** Fold raw minutes older than 24 hours into ten-minute points and drop points older than 30 days. Returns how many raw rows were folded. */
export function compact(ctx: MachinesCtx): number {
  ensure(ctx.db);
  const now = ctx.now();
  const cut = Math.floor((now - RAW_MS) / (10 * MINUTE)) * (10 * MINUTE);
  let folded = 0;
  for (;;) {
    const rows = ctx.db.all("SELECT machine_id, t, n, cpu, mem, disk, nin, nout, vcpu, vmem FROM machines_point WHERE res = 1 AND t < ? ORDER BY machine_id, t LIMIT 1000", cut) as Array<Vals & { machine_id: string; t: number; n: number }>;
    if (!rows.length) break;
    for (const r of rows) {
      addPoint(ctx.db, r.machine_id, 10, Math.floor(r.t / (10 * MINUTE)) * (10 * MINUTE), r.n, r);
      ctx.db.run("DELETE FROM machines_point WHERE machine_id = ? AND res = 1 AND t = ?", r.machine_id, r.t);
      folded++;
    }
  }
  ctx.db.run("DELETE FROM machines_point WHERE res = 10 AND t < ?", now - KEEP_MS);
  return folded;
}

// ---- series ----

export const RANGES = {
  "1h": { count: 60, step: MINUTE },
  "24h": { count: 144, step: 10 * MINUTE },
  "7d": { count: 168, step: HOUR },
  "30d": { count: 180, step: 4 * HOUR },
} as const;
export type Range = keyof typeof RANGES;

export interface Point { t: number; cpuPct?: number; memPct?: number; diskFreePct?: number; netInBps?: number; netOutBps?: number; vyreCpuPct?: number; vyreMemBytes?: number }

/** The points of one window: `count` buckets of `step`, the last ending now. `t` is where the bucket starts. A bucket with no report has only its time (a gap). `own` false keeps only Vyre's share. */
export function seriesOf(ctx: MachinesCtx, id: string, range: Range, own: boolean): Point[] {
  ensure(ctx.db);
  const { count, step } = RANGES[range], now = ctx.now();
  const end = Math.floor(now / step) * step + step, start = end - count * step;
  const rows = ctx.db.all("SELECT t, n, cpu, mem, disk, nin, nout, vcpu, vmem FROM machines_point WHERE machine_id = ? AND t >= ? AND t < ? ORDER BY t", id, start, end) as Array<Vals & { t: number; n: number }>;
  const acc = Array.from({ length: count }, () => ({ n: 0, s: Object.fromEntries(KEYS.map((k) => [k, [0, 0]])) as Record<(typeof KEYS)[number], [number, number]> }));
  for (const r of rows) {
    const b = Math.floor((r.t - start) / step);
    if (b < 0 || b >= count) continue;
    const a = acc[b]!;
    a.n += r.n;
    for (const k of KEYS) if (r[k] !== null) { a.s[k][0] += r[k]! * r.n; a.s[k][1] += r.n; }
  }
  return acc.map((a, i): Point => {
    const t = start + i * step;
    const v = (k: (typeof KEYS)[number]): number | undefined => (a.s[k][1] ? round(a.s[k][0] / a.s[k][1])! : undefined);
    const o: Point = { t };
    const put = <K extends keyof Point>(key: K, x: number | undefined): void => { if (x !== undefined) o[key] = x as Point[K]; };
    if (own) { put("cpuPct", v("cpu")); put("memPct", v("mem")); put("diskFreePct", v("disk")); put("netInBps", v("nin")); put("netOutBps", v("nout")); }
    put("vyreCpuPct", v("vcpu")); put("vyreMemBytes", v("vmem"));
    return o;
  });
}

/** The memory use a day ago (nearest point), for the "up from 72% yesterday" line. */
export function memAgo(ctx: MachinesCtx, id: string, agoMs: number): number | null {
  const t = Math.floor((ctx.now() - agoMs) / MINUTE) * MINUTE;
  const r = ctx.db.all("SELECT mem FROM machines_point WHERE machine_id = ? AND t BETWEEN ? AND ? AND mem IS NOT NULL ORDER BY ABS(t - ?) LIMIT 1", id, t - 20 * MINUTE, t + 20 * MINUTE, t)[0] as { mem: number } | undefined;
  return r?.mem ?? null;
}

// ---- room, privacy ----

export const maxTurnsOf = (r: Rec): number => r.maxTurns ?? defaultMaxTurns(r.kind, r.specs?.cores ?? 2);
export function roomOf(r: Rec, now: number, turnsNow?: number): Room {
  const spec = r.specs, load = r.load;
  return roomLeft({
    online: isOnline(r, now), draining: r.drain,
    ...(load ? { cpuPct: load.cpuPct } : {}),
    ...(load && spec && spec.memBytes > 0 ? { memPct: (load.memUsedBytes / spec.memBytes) * 100 } : {}),
    ...(load && spec && spec.diskBytes > 0 ? { diskFreePct: (load.diskFreeBytes / spec.diskBytes) * 100 } : {}),
    turns: turnsNow ?? r.runs?.turns ?? 0, maxTurns: maxTurnsOf(r),
  });
}

/** Who is looking: the person, whether they manage servers, so an admin sees every machine and a member only their own. */
export interface Viewer { id: string; admin: boolean }
/** An admin looking at a member's own computer sees only its name, whether it is online, its capacity and Vyre's own work. The owner sees everything. */
export const restrictedFor = (r: Rec, v: Viewer): boolean => r.kind === "computer" && r.ownerId !== v.id;
export const mayList = (r: Rec, v: Viewer): boolean => v.admin || r.ownerId === v.id;
