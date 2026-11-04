// Machines, the page shared by the Console (every machine of the Space) and Settings, This device (my own): what a row says, how a chart is drawn and what its hover reads. Pure functions over what
// machines.list and machines.get answer (api.ts turns them into these shapes), so the page, the Console and the tests agree. The words and the numbers behind them are the prototype's (Machines, 4 Nov).
export type Range = "1h" | "24h" | "7d" | "30d";
export interface MachineRow {
  serverId: string; name: string; nickname?: string; kind: "space" | "server" | "linked"; owner?: string; mine: boolean;
  state: "healthy" | "degraded" | "down"; online: boolean; lastSeenAt?: number; version?: string; os?: string; arch?: string;
  cores?: number; memBytes?: number; diskBytes?: number; latencyMs?: number;
  /** The whole machine's load: absent on a member's own computer seen by someone else. */
  load?: { cpu: number; memPct: number; diskPct: number; diskFreeBytes: number };
  /** Vyre's own share, present when the machine has reported. */
  vyre?: { cpu: number; memPct: number };
  private: boolean;
  runs: { turns: number; agentComputers: number; sites: number; automations: number };
  can: string[];
  room: { n: number; why: string };
  limits: { maxTurns: number | null; maxAgentComputers: number | null };
  drain: boolean; pins: string[];
}
export interface MachineAlert { alertId: string; serverId: string; kind: "disk" | "memory" | "offline" | "backup" | "update"; title: string; detail: string }
export interface Waiting { serverId: string; name: string; owner?: string; fingerprint?: string; requestedAt?: number; facts?: { os: string; arch: string; docker: boolean; version: string } }
export interface MachinesOut { machines: MachineRow[]; waiting: Waiting[]; alerts: MachineAlert[]; admin: boolean; now: number }
export interface Point { t: number; cpu: number | null; mem: number | null; disk: number | null; netIn: number | null; netOut: number | null }
export interface Series { range: Range; step: number; points: Point[] }
export interface Finding { key: string; state: "healthy" | "degraded" | "down"; detail: string; next: string; fix: "clear_caches" | "stop_idle" | "update" | null }
export interface MachineOut {
  machine: MachineRow; series: Series; findings: Finding[]; work: Array<{ agent: string; what: string; where: string; cpu: number }>; alerts: MachineAlert[]; privacy: "full" | "vyre_only";
  lastFix?: { fix: string; at: number; state: "done" | "failed"; detail: string };
}

export const RANGES: readonly { key: Range; label: string }[] = [{ key: "1h", label: "1\u00a0h" }, { key: "24h", label: "24\u00a0h" }, { key: "7d", label: "7\u00a0d" }, { key: "30d", label: "30\u00a0d" }];
export const RANGE_NOTE: Readonly<Record<Range, string>> = { "1h": "1-minute points", "24h": "10-minute points", "7d": "Downsampled after 24 hours", "30d": "Downsampled after 24 hours" };

const CAN: Readonly<Record<string, string>> = { claude_code: "Claude Code", codex: "Codex", grok: "Grok", docker: "Docker", chrome: "Chrome" };
/** Engines and tools by name, never more: Vyre does not list what else is installed. */
export const canNames = (can: readonly string[]): string[] => can.map((c) => CAN[c] ?? c);
export const ENGINE_NAMES: readonly string[] = ["Claude Code", "Codex", "Docker", "Chrome"];

export const fmtBytes = (n: number): string => (n >= 1e12 ? `${(n / 1e12).toFixed(1).replace(/\.0$/, "")} TB` : n >= 1e9 ? `${Math.round(n / 1e9)} GB` : `${Math.round(n / 1e6)} MB`);
export const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What a machine is, in the words of its row: kind, whose, version. */
export function kindLine(m: Pick<MachineRow, "kind" | "owner" | "version" | "mine">, who: (id: string) => string): string {
  const kind = m.kind === "space" ? "Space server" : m.kind === "linked" ? "Linked computer" : "Added server";
  const owner = m.kind === "space" || !m.owner ? null : m.mine ? null : who(m.owner);
  return [kind, owner, m.version ? `v${m.version}` : null].filter(Boolean).join(" \u00b7 ");
}

export const displayName = (m: Pick<MachineRow, "name" | "nickname">): string => m.nickname ?? m.name;

export function statusOf(m: Pick<MachineRow, "online" | "drain" | "state" | "lastSeenAt" | "latencyMs" | "kind">, now: number): { word: string; tone: "ok" | "warn" | "off"; sub: string } {
  if (!m.online) return { word: "Offline", tone: "off", sub: m.lastSeenAt ? `Seen ${ago(now - m.lastSeenAt)} ago` : "Never seen" };
  const sub = m.kind === "space" ? "This server" : m.latencyMs !== undefined ? `${m.latencyMs} ms` : "";
  if (m.drain) return { word: "Draining", tone: "warn", sub };
  return { word: m.state === "degraded" ? "Slow" : "Online", tone: m.state === "degraded" ? "warn" : "ok", sub };
}

export function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
}

/** The numbers an admin may see on a row. A member's own computer, seen by someone else, shows Vyre's share and its capacity only. */
export function loadCells(m: MachineRow): { cpu: string; mem: string; disk: string; cpuPct: number | null; memPct: number | null; diskPct: number | null; private: boolean } {
  if (!m.online) return { cpu: "No data", mem: "No data", disk: "No data", cpuPct: null, memPct: null, diskPct: null, private: false };
  if (m.private || !m.load) return { cpu: m.vyre ? `Vyre ${Math.round(m.vyre.cpu)}%` : "Private", mem: m.vyre ? `Vyre ${Math.round(m.vyre.memPct)}%` : "Private", disk: "Private", cpuPct: null, memPct: null, diskPct: null, private: true };
  return { cpu: `${Math.round(m.load.cpu)}%`, mem: `${Math.round(m.load.memPct)}%`, disk: m.diskBytes ? `${fmtBytes(m.load.diskFreeBytes)} free` : `${Math.round(100 - m.load.diskPct)}% free`, cpuPct: m.load.cpu, memPct: m.load.memPct, diskPct: m.load.diskPct, private: false };
}

/** What runs here, as short lines: "3 turns", then the rest. */
export function runsLines(m: Pick<MachineRow, "runs" | "online">): string[] {
  const r = m.runs, out = [plural(m.online ? r.turns : 0, "turn")];
  if (r.agentComputers) out.push(plural(r.agentComputers, "agent computer"));
  if (r.sites) out.push(plural(r.sites, "site"));
  if (r.automations) out.push(plural(r.automations, "automation"));
  return out;
}

/** The health strip: how many machines are up, what needs a look, what runs and how much room is left on average. */
export function strip(ms: readonly MachineRow[], alerts: readonly MachineAlert[]): { online: string; offline: string; attention: number; attentionWords: string; turns: string; room: number; takingWork: number } {
  const on = ms.filter((m) => m.online), taking = ms.filter((m) => m.online && !m.drain);
  const words = alerts.map((a) => a.kind === "memory" ? "memory" : a.kind === "offline" ? "offline" : a.kind).filter((w, i, all) => all.indexOf(w) === i).join(", ");
  const turns = ms.reduce((a, m) => a + (m.online ? m.runs.turns : 0), 0), pcs = ms.reduce((a, m) => a + m.runs.agentComputers, 0), autos = ms.reduce((a, m) => a + m.runs.automations, 0);
  return { online: `${on.length} of ${ms.length} online`, offline: `${ms.length - on.length} offline`, attention: alerts.length, attentionWords: words || "All clear", turns: `${plural(turns, "turn")}, ${plural(pcs, "agent computer")}, ${plural(autos, "automation")}`, room: taking.length ? Math.round(taking.reduce((a, m) => a + m.room.n, 0) / taking.length) : 0, takingWork: taking.length };
}

/** A person's own machines are listed with the one they are using first, then by name; the Space server leads in the Console. */
export function ordered(ms: readonly MachineRow[]): MachineRow[] {
  const rank = (m: MachineRow): number => (m.kind === "space" ? 0 : m.kind === "server" ? 1 : 2);
  return [...ms].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)));
}

// ---------------------------------------------------------------- charts

export type ChartKey = "cpu" | "mem" | "disk" | "net";
export interface ChartDef { key: ChartKey; title: string; unit: "%" | "MB/s"; /** Fixed top of the scale, or null to fit the data. */ max: number | null }
export const CHARTS: readonly ChartDef[] = [{ key: "cpu", title: "CPU", unit: "%", max: 100 }, { key: "mem", title: "Memory", unit: "%", max: 100 }, { key: "disk", title: "Disk used", unit: "%", max: 100 }, { key: "net", title: "Network", unit: "MB/s", max: null }];
/** Disk used over this share rings an alert (10% free). */
export const DISK_LINE = 90;

export const niceMax = (v: number): number => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

export interface Geometry {
  width: number; height: number; left: number; right: number; top: number; bottom: number; max: number;
  /** SVG path data of each run of points with data, line and area. A gap (the machine said nothing) breaks the line. */
  line: string; area: string; out: string;
  /** Horizontal rules with their labels, and the time ticks under the plot. */
  rules: { y: number; label: string }[]; ticks: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
  /** The y of the alert line on the disk chart. */
  alertY: number | null;
  /** The x of point i. */
  xOf(i: number): number;
  /** The index of the point nearest to a pixel x inside the plot. */
  indexAt(px: number): number;
}

const valueOf = (p: Point, k: ChartKey): number | null => (k === "cpu" ? p.cpu : k === "mem" ? p.mem : k === "disk" ? p.disk : p.netIn);

export function geometry(def: ChartDef, points: readonly Point[], range: Range, width: number, height = 156): Geometry {
  const left = 34, right = 6, top = 8, bottom = 22, n = Math.max(2, points.length);
  const vals = points.map((p) => valueOf(p, def.key)), outs = points.map((p) => p.netOut);
  const max = def.max ?? niceMax(Math.max(0, ...vals.map((v) => v ?? 0), ...outs.map((v) => v ?? 0)) * 1.1);
  const xOf = (i: number): number => left + ((width - left - right) * i) / (n - 1);
  const yOf = (v: number): number => top + (height - top - bottom) * (1 - Math.min(v, max) / max);
  const build = (ser: readonly (number | null)[], area: boolean): string => {
    let d = "", run: [number, number][] = [];
    const flush = (): void => { if (!run.length) return; d += "M" + run.map(([i, v], j) => `${j ? "L" : ""}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(""); if (area) d += `L${xOf(run[run.length - 1]![0]).toFixed(1)} ${yOf(0).toFixed(1)}L${xOf(run[0]![0]).toFixed(1)} ${yOf(0).toFixed(1)}Z`; run = []; };
    ser.forEach((v, i) => { if (v === null) flush(); else run.push([i, v]); });
    flush();
    return d;
  };
  const rules = [0, 0.5, 1].map((f) => ({ y: yOf(max * f), label: def.unit === "%" ? `${Math.round(max * f)}%` : (max * f).toFixed(max < 5 ? 1 : 0) }));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f, j) => { const i = Math.round((points.length - 1) * f); return { x: xOf(i), label: points[i] ? timeLabel(points[i]!.t, range, true) : "", anchor: (j === 0 ? "start" : j === 4 ? "end" : "middle") as "start" | "middle" | "end" }; });
  return {
    width, height, left, right, top, bottom, max, line: build(vals, false), area: build(vals, true), out: def.key === "net" ? build(outs, false) : "",
    rules, ticks, alertY: def.key === "disk" ? yOf(DISK_LINE) : null, xOf,
    indexAt: (px) => Math.max(0, Math.min(points.length - 1, Math.round(((px - left) / (width - left - right)) * (points.length - 1)))),
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");
/** The time of a point: a clock for the day ranges, a day for the long ones. `tick` is the short form under the plot. */
export function timeLabel(ms: number, range: Range, tick = false): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (range === "30d") return day;
  if (range === "7d") return tick ? d.toLocaleDateString("en-US", { weekday: "short" }) : `${day}, ${pad(d.getHours())}:00`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function valueText(def: ChartDef, v: number | null): string { return v === null ? "No data" : def.unit === "%" ? `${Math.round(v)}%` : `${v.toFixed(1)} MB/s`; }
/** What the hover reads at point i: the value, the time, and the outgoing figure on the network chart. */
export function hoverAt(def: ChartDef, points: readonly Point[], i: number, range: Range): { value: string; time: string; out: string | null } {
  const p = points[Math.max(0, Math.min(points.length - 1, i))];
  if (!p) return { value: "No data", time: "", out: null };
  return { value: valueText(def, valueOf(p, def.key)), time: timeLabel(p.t, range), out: def.key === "net" && p.netOut !== null ? `out ${p.netOut.toFixed(1)} MB/s` : null };
}
/** The figure at the top right of a chart: the latest point with data. */
export const latestText = (def: ChartDef, points: readonly Point[]): string => valueText(def, [...points].reverse().map((p) => valueOf(p, def.key)).find((v) => v !== null) ?? null);

/** Charts a person may see for a machine: all four, or Vyre's share only (CPU and memory) when it is another member's computer. */
export const chartsFor = (privacy: MachineOut["privacy"]): readonly ChartDef[] => (privacy === "vyre_only" ? CHARTS.filter((c) => c.key === "cpu" || c.key === "mem") : CHARTS);

export const PRIVATE_NOTE = (owner: string): string => `This is ${owner}'s own computer. You see its name, whether it is online, its capacity and the work Vyre runs on it. Files and processes stay private to ${owner.split(" ")[0]}.`;

/** The one line under "Where work runs": what the next turn does, from the order and the rooms. */
export function orderLines(order: readonly { name: string; label: string; roomN: number; why: string; online: boolean; drain: boolean }[]): { title: string; note: string; use: boolean; room: number }[] {
  let used = false;
  return order.map((o) => {
    const skip = !o.online ? "It is offline" : o.drain ? "It is draining" : o.roomN < 20 ? `Busy. ${o.why === "turn limit" ? "Its turn limit is reached" : `${o.why[0]!.toUpperCase()}${o.why.slice(1)} is nearly full`}` : null;
    const use = !used && skip === null;
    if (use) used = true;
    return { title: `${o.label}: ${o.name}`, note: skip ? `Skipped. ${skip}` : use ? "Next turn runs here" : "Has room, not needed", use, room: o.roomN };
  });
}
