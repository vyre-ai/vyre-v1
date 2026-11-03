// Machines: what each computer that runs Vyre work reports every 30 seconds, how long it is remembered, how much room it has left and when that is worth an alert. Pure functions over a small
// SQL handle, so the Space server's own sampler, the device link's report frame, the network module's capabilities and their tests all run the same code (layer 0: no imports but node).
//
// History: one point a minute for 24 hours, then ten-minute points (their average) until 30 days, then nothing. A report between two minutes replaces that minute's point.

export interface Db { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** How long a point is kept. */
export const KEEP_MS = 30 * DAY;
/** Minute points are kept this long, then folded into ten-minute points. */
export const FINE_MS = DAY;
export const COARSE_STEP = 10 * MINUTE;
/** A machine whose room left is under this is busy: the next turn goes to the next machine with room. */
export const BUSY_BELOW = 20;
/** Disk used over this share is an alert (under 10% free). */
export const DISK_ALERT = 90;
/** Memory in use over this share is pressure. */
export const MEM_ALERT = 85;

export type Range = "1h" | "24h" | "7d" | "30d";
/** How many points a chart of each range draws, and how far apart. */
export const RANGES: Readonly<Record<Range, { n: number; step: number }>> = { "1h": { n: 60, step: MINUTE }, "24h": { n: 144, step: 10 * MINUTE }, "7d": { n: 168, step: HOUR }, "30d": { n: 180, step: 4 * HOUR } };
export const isRange = (v: unknown): v is Range => typeof v === "string" && Object.prototype.hasOwnProperty.call(RANGES, v);

export interface Specs { os: string; arch: string; cores: number; memBytes: number; diskBytes: number; version: string }
export interface Load {
  /** Percent of all cores busy, 0 to 100. */
  cpu: number; memUsedBytes: number; diskFreeBytes: number;
  /** Bytes a second, both ways. */
  netInBps: number; netOutBps: number;
  /** The share Vyre's own work takes: the only load an admin sees on a member's computer. */
  vyreCpu?: number; vyreMemBytes?: number;
}
export interface Work { agent: string; what: string; where: string; cpu: number }
export interface Runs { turns: number; agentComputers: number; sites: number; automations: number; work: Work[] }
/** What the daemon sends: its specs, its load, what Vyre runs on it and what it can run. */
export interface Report { specs: Specs; load: Load; runs: Runs; can: string[]; latencyMs?: number }

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const text = (v: unknown, max: number, d = ""): string => (typeof v === "string" ? v.slice(0, max) : d);

/** A report from the wire, made safe: numbers in range, strings cut, anything else dropped. */
export function cleanReport(raw: unknown): Report | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>, s = (r["specs"] ?? {}) as Record<string, unknown>, l = (r["load"] ?? {}) as Record<string, unknown>, u = (r["runs"] ?? {}) as Record<string, unknown>;
  if (typeof s["cores"] !== "number" || typeof s["memBytes"] !== "number") return null;
  const work: Work[] = Array.isArray(u["work"]) ? (u["work"] as unknown[]).slice(0, 40).flatMap((w) => {
    if (!w || typeof w !== "object") return [];
    const x = w as Record<string, unknown>;
    return [{ agent: text(x["agent"], 60), what: text(x["what"], 120), where: text(x["where"], 120), cpu: clamp(num(x["cpu"]), 0, 100) }];
  }) : [];
  const out: Report = {
    specs: { os: text(s["os"], 60, "unknown"), arch: text(s["arch"], 20, "unknown"), cores: clamp(Math.round(num(s["cores"], 1)), 1, 4096), memBytes: Math.max(0, num(s["memBytes"])), diskBytes: Math.max(0, num(s["diskBytes"])), version: text(s["version"], 40, "unknown") },
    load: { cpu: clamp(num(l["cpu"]), 0, 100), memUsedBytes: Math.max(0, num(l["memUsedBytes"])), diskFreeBytes: Math.max(0, num(l["diskFreeBytes"])), netInBps: Math.max(0, num(l["netInBps"])), netOutBps: Math.max(0, num(l["netOutBps"])) },
    runs: { turns: Math.max(0, Math.round(num(u["turns"]))), agentComputers: Math.max(0, Math.round(num(u["agentComputers"]))), sites: Math.max(0, Math.round(num(u["sites"]))), automations: Math.max(0, Math.round(num(u["automations"]))), work },
    can: (Array.isArray(r["can"]) ? (r["can"] as unknown[]) : []).filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 40)).slice(0, 12),
  };
  if (typeof l["vyreCpu"] === "number") out.load.vyreCpu = clamp(l["vyreCpu"], 0, 100);
  if (typeof l["vyreMemBytes"] === "number") out.load.vyreMemBytes = Math.max(0, l["vyreMemBytes"]);
  if (typeof r["latencyMs"] === "number") out.latencyMs = Math.max(0, Math.round(r["latencyMs"]));
  return out;
}

/** Percent of memory in use and of disk used, from a report. */
export const memPct = (s: Specs, l: Load): number => (s.memBytes > 0 ? clamp((l.memUsedBytes / s.memBytes) * 100, 0, 100) : 0);
export const diskPct = (s: Specs, l: Load): number => (s.diskBytes > 0 ? clamp(100 - (l.diskFreeBytes / s.diskBytes) * 100, 0, 100) : 0);
const mbps = (bps: number): number => Math.round((bps / 1_000_000) * 100) / 100;

// ---------------------------------------------------------------- storing a report

export interface MachineMeta { nickname: string | null; maxTurns: number | null; maxAgentComputers: number | null; drain: boolean; pins: string[] }
export const emptyMeta = (): MachineMeta => ({ nickname: null, maxTurns: null, maxAgentComputers: null, drain: false, pins: [] });

export function readMeta(db: Db, serverId: string): MachineMeta {
  const r = db.all("SELECT nickname, max_turns, max_pcs, drain, pins_json FROM network_machine WHERE server_id = ?", serverId)[0] as Record<string, unknown> | undefined;
  if (!r) return emptyMeta();
  let pins: string[] = [];
  try { const p = JSON.parse(String(r["pins_json"] ?? "[]")) as unknown; if (Array.isArray(p)) pins = p.filter((x): x is string => typeof x === "string"); } catch { pins = []; }
  return { nickname: typeof r["nickname"] === "string" && r["nickname"] !== "" ? r["nickname"] : null, maxTurns: typeof r["max_turns"] === "number" ? r["max_turns"] : null, maxAgentComputers: typeof r["max_pcs"] === "number" ? r["max_pcs"] : null, drain: r["drain"] === 1, pins };
}

const SAVE = "INSERT OR REPLACE INTO network_machine (server_id, nickname, max_turns, max_pcs, drain, pins_json, specs_json, load_json, run_json, can_json, latency_ms, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
export interface Stored { specs: Specs | null; load: Load | null; runs: Runs | null; can: string[]; latencyMs: number | null; reportedAt: number | null }
export function readStored(db: Db, serverId: string): Stored {
  const r = db.all("SELECT specs_json, load_json, run_json, can_json, latency_ms, reported_at FROM network_machine WHERE server_id = ?", serverId)[0] as Record<string, unknown> | undefined;
  const j = <T>(v: unknown): T | null => { try { return typeof v === "string" ? (JSON.parse(v) as T) : null; } catch { return null; } };
  return { specs: j<Specs>(r?.["specs_json"]), load: j<Load>(r?.["load_json"]), runs: j<Runs>(r?.["run_json"]), can: j<string[]>(r?.["can_json"]) ?? [], latencyMs: typeof r?.["latency_ms"] === "number" ? r["latency_ms"] : null, reportedAt: typeof r?.["reported_at"] === "number" ? r["reported_at"] : null };
}

/** Write a machine's meta back with its stored report untouched. */
export function writeMeta(db: Db, serverId: string, m: MachineMeta): void {
  const s = readStored(db, serverId);
  db.run(SAVE, serverId, m.nickname, m.maxTurns, m.maxAgentComputers, m.drain ? 1 : 0, JSON.stringify(m.pins), s.specs ? JSON.stringify(s.specs) : null, s.load ? JSON.stringify(s.load) : null, s.runs ? JSON.stringify(s.runs) : null, JSON.stringify(s.can), s.latencyMs, s.reportedAt);
}

/** Keep a report: the latest state replaces the last, and this minute's point is written (a second report in the same minute replaces it). Folds old points about once in ten minutes. */
export function recordReport(db: Db, serverId: string, rep: Report, now: number): void {
  const m = readMeta(db, serverId);
  db.run(SAVE, serverId, m.nickname, m.maxTurns, m.maxAgentComputers, m.drain ? 1 : 0, JSON.stringify(m.pins), JSON.stringify(rep.specs), JSON.stringify(rep.load), JSON.stringify(rep.runs), JSON.stringify(rep.can), rep.latencyMs ?? null, now);
  // a report is a heartbeat: the servers list believes a machine that has just spoken
  db.run("UPDATE network_server SET state = ?, heartbeat_at = ? WHERE server_id = ?", "healthy", now, serverId);
  const t = Math.floor(now / MINUTE) * MINUTE;
  const vcpu = rep.load.vyreCpu ?? null, vmem = rep.load.vyreMemBytes !== undefined && rep.specs.memBytes > 0 ? clamp((rep.load.vyreMemBytes / rep.specs.memBytes) * 100, 0, 100) : null;
  db.run("INSERT OR REPLACE INTO network_machine_point (server_id, t, step, cpu, mem, disk, net_in, net_out, vy_cpu, vy_mem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", serverId, t, MINUTE, rep.load.cpu, memPct(rep.specs, rep.load), diskPct(rep.specs, rep.load), mbps(rep.load.netInBps), mbps(rep.load.netOutBps), vcpu, vmem);
  if (Math.floor(now / MINUTE) % 10 === 0) compact(db, serverId, now);
}

/** Minute points older than a day become ten-minute averages; anything older than 30 days goes. */
export function compact(db: Db, serverId: string, now: number): void {
  const old = db.all("SELECT t, cpu, mem, disk, net_in, net_out, vy_cpu, vy_mem FROM network_machine_point WHERE server_id = ? AND step = ? AND t < ? ORDER BY t", serverId, MINUTE, now - FINE_MS) as Record<string, number | null>[];
  const buckets = new Map<number, Record<string, number | null>[]>();
  for (const p of old) { const b = Math.floor(Number(p["t"]) / COARSE_STEP) * COARSE_STEP; const l = buckets.get(b); if (l) l.push(p); else buckets.set(b, [p]); }
  const avg = (l: Record<string, number | null>[], k: string): number | null => { const v = l.map((x) => x[k]).filter((x): x is number => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  for (const [t, l] of buckets) db.run("INSERT OR REPLACE INTO network_machine_point (server_id, t, step, cpu, mem, disk, net_in, net_out, vy_cpu, vy_mem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", serverId, t, COARSE_STEP, avg(l, "cpu"), avg(l, "mem"), avg(l, "disk"), avg(l, "net_in"), avg(l, "net_out"), avg(l, "vy_cpu"), avg(l, "vy_mem"));
  if (old.length) db.run("DELETE FROM network_machine_point WHERE server_id = ? AND step = ? AND t < ?", serverId, MINUTE, now - FINE_MS);
  db.run("DELETE FROM network_machine_point WHERE server_id = ? AND t < ?", serverId, now - KEEP_MS);
}

// ---------------------------------------------------------------- reading history

export interface Point { t: number; cpu: number | null; mem: number | null; disk: number | null; netIn: number | null; netOut: number | null }
export interface Series { range: Range; step: number; points: Point[] }

/** The chart of one machine: the range cut into equal steps, each the average of the points inside it, or null where the machine said nothing. `vyre` reads Vyre's own share instead of the whole machine. */
export function readSeries(db: Db, serverId: string, range: Range, now: number, vyre = false): Series {
  const { n, step } = RANGES[range], end = Math.floor(now / step) * step, start = end - (n - 1) * step;
  const rows = db.all("SELECT t, cpu, mem, disk, net_in, net_out, vy_cpu, vy_mem FROM network_machine_point WHERE server_id = ? AND t >= ? ORDER BY t", serverId, start) as Record<string, number | null>[];
  const sums: { c: number; v: [number, number, number, number, number] }[] = Array.from({ length: n }, () => ({ c: 0, v: [0, 0, 0, 0, 0] }));
  for (const r of rows) {
    const i = Math.floor((Number(r["t"]) - start) / step);
    if (i < 0 || i >= n) continue;
    const cpu = vyre ? r["vy_cpu"] : r["cpu"], mem = vyre ? r["vy_mem"] : r["mem"];
    if (cpu === null || cpu === undefined) continue;
    const s = sums[i]!; s.c++; s.v[0] += cpu; s.v[1] += mem ?? 0; s.v[2] += vyre ? 0 : r["disk"] ?? 0; s.v[3] += vyre ? 0 : r["net_in"] ?? 0; s.v[4] += vyre ? 0 : r["net_out"] ?? 0;
  }
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return { range, step, points: sums.map((s, i) => (s.c === 0 ? { t: start + i * step, cpu: null, mem: null, disk: null, netIn: null, netOut: null } : { t: start + i * step, cpu: r1(s.v[0] / s.c), mem: r1(s.v[1] / s.c), disk: vyre ? null : r1(s.v[2] / s.c), netIn: vyre ? null : r1(s.v[3] / s.c), netOut: vyre ? null : r1(s.v[4] / s.c) })) };
}

// ---------------------------------------------------------------- room left, placement, alerts

export interface RoomIn { online: boolean; drain: boolean; cpu: number; memPct: number; diskPct: number; turns: number; maxTurns: number | null }
export interface Room { n: number; why: "cpu" | "memory" | "turn limit" | "disk" | "offline" | "draining" }

/** 0 to 100: what is free of the tightest of CPU, memory (weighted a little lighter, caches count as used), the turn limit and disk. Offline or draining is 0. */
export function roomOf(m: RoomIn): Room {
  if (!m.online) return { n: 0, why: "offline" };
  if (m.drain) return { n: 0, why: "draining" };
  const parts: [Room["why"], number][] = [["cpu", 100 - m.cpu], ["memory", 100 - m.memPct * 0.92], ["disk", m.diskPct > DISK_ALERT ? 100 - m.diskPct : 100]];
  if (m.maxTurns !== null && m.maxTurns > 0) parts.push(["turn limit", 100 - (m.turns / m.maxTurns) * 100]);
  let tight = parts[0]!;
  for (const p of parts) if (p[1] < tight[1]) tight = p;
  return { n: Math.max(0, Math.min(100, Math.round(tight[1]))), why: tight[0] };
}

export interface Candidate { serverId: string; name: string; room: Room; turns: number; maxTurns: number | null }
export interface Placement { chosen: Candidate | null; skipped: { serverId: string; name: string; why: string }[] }
const busyWhy = (c: Candidate): string => (c.room.why === "offline" ? "it is offline" : c.room.why === "draining" ? "it is draining" : c.room.why === "turn limit" ? `it was busy, ${c.turns} of ${c.maxTurns} turns running` : `it was busy, ${c.room.why} nearly full`);

/** The first machine in the person's order with room. A busy one is skipped for the next. If none has room the first that is online and not draining takes it anyway, queued. */
export function place(order: readonly Candidate[]): Placement {
  const skipped: Placement["skipped"] = [];
  for (const c of order) {
    if (c.room.n >= BUSY_BELOW) return { chosen: c, skipped };
    skipped.push({ serverId: c.serverId, name: c.name, why: busyWhy(c) });
  }
  const any = order.find((c) => c.room.why !== "offline" && c.room.why !== "draining") ?? null;
  return { chosen: any, skipped: any ? [] : skipped };
}
/** "Ran on" says why when a turn moved: the machine it landed on and the first one it was moved from. */
export const movedLine = (p: Placement): string | null => (p.chosen && p.skipped.length ? `Moved from ${p.skipped[0]!.name} because ${p.skipped[0]!.why}` : null);

export type AlertKind = "disk" | "memory" | "offline" | "backup" | "update";
export interface MachineAlert { alertId: string; serverId: string; kind: AlertKind; title: string; detail: string }
export interface AlertIn { serverId: string; name: string; online: boolean; personal: boolean; version: string | null; memPct: number | null; diskPct: number | null; diskBytes: number; pins: string[]; seenAt: number | null }

/** The alerts of the machines: disk under 10% free, memory pressure, a machine offline with pinned work, an update waiting; and a failed backup when one is named. A member's own computer alerts only its owner. */
export function alertsOf(ms: readonly AlertIn[], latest: string | null, backupFailed: string | null, now: number): MachineAlert[] {
  const out: MachineAlert[] = [];
  for (const m of ms) {
    if (m.online && m.diskPct !== null && m.diskPct > DISK_ALERT) out.push({ alertId: `disk:${m.serverId}`, serverId: m.serverId, kind: "disk", title: `${m.name} has ${Math.round(100 - m.diskPct)}% disk left`, detail: `${Math.round(((100 - m.diskPct) / 100) * m.diskBytes / 1e9)} GB of ${Math.round(m.diskBytes / 1e9)} GB free` });
    if (m.online && m.memPct !== null && m.memPct > MEM_ALERT) out.push({ alertId: `memory:${m.serverId}`, serverId: m.serverId, kind: "memory", title: `${m.name} is short of memory`, detail: `${Math.round(m.memPct)}% in use` });
    if (!m.online && m.pins.length) out.push({ alertId: `offline:${m.serverId}`, serverId: m.serverId, kind: "offline", title: `${m.name} is offline and ${m.pins.join(", ")} ${m.pins.length === 1 ? "is" : "are"} pinned to it`, detail: m.seenAt ? `Last seen ${Math.max(1, Math.round((now - m.seenAt) / MINUTE))} minutes ago. The pinned work waits until it is back` : "It has not been seen. The pinned work waits until it is back" });
  }
  const behind = latest ? ms.filter((m) => m.online && !m.personal && m.version && m.version !== latest) : [];
  if (behind.length) out.push({ alertId: "update:space", serverId: behind[0]!.serverId, kind: "update", title: behind.length === 1 ? `Update ${latest} is waiting on ${behind[0]!.name}` : `Update ${latest} is waiting on ${behind.length} machines`, detail: behind.map((m) => m.name).join(", ") });
  if (backupFailed) out.push({ alertId: "backup:space", serverId: "srv_local", kind: "backup", title: "The last backup failed", detail: backupFailed });
  return out;
}

export interface Finding { key: string; state: "healthy" | "degraded" | "down"; detail: string; next: string; fix: string | null }
/** What a machine's own report says is wrong, with the fix a person can press. The Space server also gets the host's Doctor, added by the caller. */
export function findingsOf(specs: Specs | null, load: Load | null, latest: string | null, can: readonly string[], personal: boolean): Finding[] {
  const out: Finding[] = [];
  if (!specs || !load) return [{ key: "report", state: "degraded", detail: "This machine has not reported yet.", next: "Check that Vyre is running on it.", fix: null }];
  const d = diskPct(specs, load), m = memPct(specs, load);
  out.push(d > 85 ? { key: "disk", state: d > DISK_ALERT ? "down" : "degraded", detail: `Disk is ${Math.round(d)}% full`, next: "Clear old turn caches and logs.", fix: "clear_caches" } : { key: "disk", state: "healthy", detail: `Disk is ${Math.round(d)}% full`, next: "No action needed.", fix: null });
  out.push(m > MEM_ALERT ? { key: "memory", state: "degraded", detail: `Memory is at ${Math.round(m)}%`, next: "Stop idle engine sessions.", fix: "stop_idle" } : { key: "memory", state: "healthy", detail: `Memory is at ${Math.round(m)}%`, next: "No action needed.", fix: null });
  if (latest && specs.version !== latest) out.push({ key: "version", state: "degraded", detail: `Vyre ${specs.version} is behind ${latest}`, next: personal ? "The person updates it in Settings." : "Update it from this page.", fix: personal ? null : "update" });
  out.push(can.includes("docker") ? { key: "docker", state: "healthy", detail: "Docker answers", next: "No action needed.", fix: null } : { key: "docker", state: "healthy", detail: "No Docker here: agent computers cannot start on this machine", next: "Install Docker to run agent computers here.", fix: null });
  return out;
}
