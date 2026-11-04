// What the Machines module answers (machines.list, machines.get, machines.alerts) made into the shapes the page draws (model.ts), and the calls the page makes (set, pin, Fix). The page and its tests know only model.ts.
import type { MachineAlert, MachineOut, MachineRow, MachinesOut, Point, Range, Waiting } from "./model.ts";

type Call = (cap: string, input: Record<string, unknown>) => Promise<unknown>;
interface ListRow {
  machineId: string; kind: "space" | "server" | "computer"; name: string; nickname?: string; ownerId?: string; mine: boolean; online: boolean; draining: boolean; restricted: boolean;
  lastSeenAt?: number; latencyMs?: number; version?: string; os?: string; arch?: string; diskBytes?: number; cores?: number; memBytes?: number;
  load?: { cpuPct: number; memUsedBytes: number; diskFreeBytes: number };
  vyreLoad?: { cpuPct: number; memBytes: number };
  runs: MachineRow["runs"]; can: string[]; limits: { maxTurns: number; maxAgentComputers: number }; pinned: Array<{ agentId: string }>; room: { score: number; tightest: string };
}
interface ListAlert { alertId: string; machineId: string; kind: "disk_low" | "memory_pressure" | "offline_pinned" | "update_waiting" | "backup_failed"; title: string; detail: string }
interface ApiPoint { t: number; cpuPct?: number; memPct?: number; diskFreePct?: number; netInBps?: number; netOutBps?: number; vyreCpuPct?: number; vyreMemBytes?: number }

const ALERT_KIND: Record<ListAlert["kind"], MachineAlert["kind"]> = { disk_low: "disk", memory_pressure: "memory", offline_pinned: "offline", update_waiting: "update", backup_failed: "backup" };
const WHY: Record<string, string> = { cpu: "cpu", memory: "memory", turns: "turn limit", disk: "disk", offline: "offline", draining: "draining", busy: "cpu" };
const r1 = (n: number): number => Math.round(n * 10) / 10;

export function toRow(m: ListRow): MachineRow {
  const mem = m.memBytes ?? 0;
  const row: MachineRow = {
    serverId: m.machineId, name: m.name, kind: m.kind === "computer" ? "linked" : m.kind, mine: m.mine, state: m.online ? "healthy" : "down", online: m.online, private: m.restricted,
    runs: m.runs, can: m.can, room: { n: m.room.score, why: WHY[m.room.tightest] ?? "cpu" }, limits: { maxTurns: m.limits.maxTurns, maxAgentComputers: m.limits.maxAgentComputers }, drain: m.draining, pins: m.pinned.map((p) => p.agentId),
  };
  if (m.nickname) row.nickname = m.nickname;
  if (m.ownerId) row.owner = m.ownerId;
  for (const k of ["lastSeenAt", "latencyMs", "version", "os", "arch", "cores", "memBytes", "diskBytes"] as const) if (m[k] !== undefined) (row as unknown as Record<string, unknown>)[k] = m[k];
  if (m.load && m.diskBytes && mem) row.load = { cpu: m.load.cpuPct, memPct: r1((m.load.memUsedBytes / mem) * 100), diskPct: r1(100 - (m.load.diskFreeBytes / m.diskBytes) * 100), diskFreeBytes: m.load.diskFreeBytes };
  if (m.vyreLoad) row.vyre = { cpu: m.vyreLoad.cpuPct, memPct: mem > 0 ? r1((m.vyreLoad.memBytes / mem) * 100) : 0 };
  return row;
}
export const toAlert = (a: ListAlert): MachineAlert => ({ alertId: a.alertId, serverId: a.machineId, kind: ALERT_KIND[a.kind], title: a.title, detail: a.detail });

/** The computers that asked to join and wait for a person: the network module knows them (an admin all, a member their own). */
async function waitingOf(call: Call, admin: boolean): Promise<Waiting[]> {
  try {
    const out = (await call(admin ? "network.servers" : "network.my_computers", {})) as { servers?: Array<Record<string, unknown>>; computers?: Array<Record<string, unknown>> };
    return [...(out.servers ?? []), ...(out.computers ?? [])].filter((s) => s["enrollment"] === "pending").map((s) => ({
      serverId: String(s["serverId"]), name: String(s["name"]), ...(s["owner"] ? { owner: String(s["owner"]) } : {}), ...(s["fingerprint"] ? { fingerprint: String(s["fingerprint"]) } : {}),
      ...(typeof s["requestedAt"] === "number" ? { requestedAt: s["requestedAt"] } : {}), ...(s["facts"] ? { facts: s["facts"] as NonNullable<Waiting["facts"]> } : {}),
    }));
  } catch { return []; }
}

export async function loadMachines(call: Call): Promise<MachinesOut> {
  const [list, alerts] = await Promise.all([call("machines.list", {}) as Promise<{ machines: ListRow[] }>, (call("machines.alerts", {}) as Promise<{ alerts: ListAlert[] }>).catch(() => ({ alerts: [] as ListAlert[] }))]);
  const admin = list.machines.some((m) => !m.mine);
  return { machines: list.machines.map(toRow), waiting: await waitingOf(call, admin), alerts: alerts.alerts.map(toAlert), admin, now: Date.now() };
}

const STEP: Record<Range, number> = { "1h": 60_000, "24h": 600_000, "7d": 3_600_000, "30d": 14_400_000 };
export async function loadMachine(call: Call, row: MachineRow, range: Range): Promise<MachineOut> {
  const g = (await call("machines.get", { machineId: row.serverId })) as {
    machine: ListRow; series: Record<Range, ApiPoint[]>; findings: MachineOut["findings"]; alerts: ListAlert[]; privacy: MachineOut["privacy"];
    work: Array<{ kind: string; agentId?: string; what: string; where: string }>; lastFix?: MachineOut["lastFix"]; idleSessions?: number;
  };
  const m = toRow(g.machine), mem = m.memBytes ?? 0;
  const points: Point[] = g.series[range].map((p) => ({
    t: p.t,
    cpu: p.cpuPct ?? p.vyreCpuPct ?? null,
    mem: p.memPct ?? (p.vyreMemBytes !== undefined && mem > 0 ? r1((p.vyreMemBytes / mem) * 100) : null),
    disk: p.diskFreePct !== undefined ? r1(100 - p.diskFreePct) : null,
    netIn: p.netInBps !== undefined ? r1(p.netInBps / 1_000_000) : null,
    netOut: p.netOutBps !== undefined ? r1(p.netOutBps / 1_000_000) : null,
  }));
  return {
    machine: m, series: { range, step: STEP[range], points }, findings: g.findings, alerts: g.alerts.map(toAlert), privacy: g.privacy,
    work: g.work.map((w) => ({ agent: w.agentId ?? (w.kind === "site" ? "Site" : "Automation"), what: w.what, where: w.where, cpu: 0 })), ...(g.lastFix ? { lastFix: g.lastFix } : {}), ...(g.idleSessions !== undefined ? { idleSessions: g.idleSessions } : {}),
  };
}

export const setMachine = (call: Call, id: string, patch: Record<string, unknown>): Promise<unknown> => call("machines.set", { machineId: id, ...patch });
export const pinMachine = (call: Call, id: string, agentId: string, pinned: boolean): Promise<unknown> => call("machines.set", { machineId: id, pinAgent: { agentId, pinned } });
export const fixMachine = (call: Call, id: string, fix: "clear_caches" | "stop_idle"): Promise<{ state: "done" | "failed"; detail: string }> => call("machines.fix", { machineId: id, fix }) as Promise<{ state: "done" | "failed"; detail: string }>;
