// A Space's machines in one process: a real SQLite database behind the host's table guard for machines_* tables, a clock, and stand-ins for the modules the handlers call (network, devices, computers, updates,
// backup). Reports are fed through the same hostCall the daemon uses.
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { handlers, hostCalls } from "../impl.ts";
import { bindMachines } from "../seams.ts";
import type { Report } from "../../../host/src/machines/report.ts";
import type { Db, Kind, MachinesCtx } from "../projections.ts";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
export const ADMIN = "usr_admin", MAYA = "usr_maya", IRFAD = "usr_irfad";
/** Tue 3 Nov 2026, 10:00 in Karachi. */
export const T0 = Date.UTC(2026, 10, 3, 5, 0);
export const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
export const GB = 1024 ** 3;

export interface Caller { id: string; kind?: "person" | "service"; admin?: boolean }
export const admin: Caller = { id: ADMIN, kind: "person", admin: true };
export const maya: Caller = { id: MAYA, kind: "person" };
export const irfad: Caller = { id: IRFAD, kind: "person" };
export const host: Caller = { id: "svc_host", kind: "service" };

/** A report of a machine with 8 cores, 16 GB and a 500 GB disk, a given share busy. */
export function report(o: { cpu?: number; mem?: number; diskFree?: number; turns?: number; version?: string; cores?: number; can?: Report["can"]; vyreCpu?: number } = {}): Report {
  const mem = o.mem ?? 40, free = o.diskFree ?? 60;
  return {
    specs: { os: "macOS 15.1", arch: "arm64", cores: o.cores ?? 8, memBytes: 16 * GB, diskBytes: 500 * GB },
    load: { cpuPct: o.cpu ?? 20, memUsedBytes: Math.round((16 * GB * mem) / 100), diskFreeBytes: Math.round((500 * GB * free) / 100), netInBps: 2000, netOutBps: 1000 },
    runs: { turns: o.turns ?? 0, agentComputers: 0, sites: 0, automations: 0 },
    can: o.can ?? ["claude_code", "chrome"], version: o.version ?? "1.4.1", vyre: { cpuPct: o.vyreCpu ?? 3, memBytes: 600 * 1024 * 1024 },
  };
}

export interface Fakes {
  servers?: Array<{ serverId: string; name: string; enrollment?: "approved" | "pending" }>;
  devices?: Array<{ id: string; name: string; person: string; revokedAt?: number }>;
  computers?: Array<{ computerId: string; agentId: string; state: string; tabs: number; tabLimit: number; nodeId?: string }>;
  updates?: { current: string; available?: string };
  backup?: { state: "healthy" | "degraded" | "down" };
  turns?: Array<{ agentId: string; asker: string; startedAt: number; where: { kind: string; name: string; nodeId?: string } }>;
  sites?: Array<{ name: string; live?: boolean; computerId?: string }>;
  automations?: Array<{ name: string }>;
}

/** `fast`: statements are prepared once and the table guard is skipped, for the 30-day size test that makes tens of thousands of calls (the guard is tested everywhere else). */
export function world(f: Fakes = {}, file = ":memory:", fast = false) {
  const sqlite = new DatabaseSync(file);
  if (fast) sqlite.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF");
  const norm = (a: unknown): unknown => (a === undefined ? null : a);
  const cache = new Map<string, ReturnType<typeof sqlite.prepare>>();
  const prep = (sql: string) => { if (!fast) return sqlite.prepare(sql); let p = cache.get(sql); if (!p) { p = sqlite.prepare(sql); cache.set(sql, p); } return p; };
  const raw: Db = {
    all: (sql, ...args) => prep(sql).all(...(args.map(norm) as never[])),
    run: (sql, ...args) => ({ changes: Number(prep(sql).run(...(args.map(norm) as never[])).changes) }),
  };
  const db = (fast ? raw : scopedDb("machines", raw, "0123456789abcdef0123456789abcdef")) as Db;
  const state = { now: T0, fakes: f, events: [] as Array<{ name: string; subject: string; payload: Record<string, unknown> }> };
  const calls: Record<string, () => unknown> = {
    "network.servers": () => ({ servers: (state.fakes.servers ?? []).map((s) => ({ role: "compute", state: "up", enrollment: "approved", ...s })) }),
    "network.my_computers": () => ({ computers: (state.fakes.servers ?? []).map((s) => ({ state: "up", enrollment: "approved", ...s })) }),
    "devices.list": () => ({ devices: state.fakes.devices ?? [] }),
    "devices.mine": () => ({ devices: state.fakes.devices ?? [] }),
    "computers.list": () => ({ computers: state.fakes.computers ?? [] }),
    "updates.status": () => { if (!state.fakes.updates) throw new Error("no"); return state.fakes.updates; },
    "engine.turns.running": () => ({ turns: (state.fakes.turns ?? []).map((t, i) => ({ turnId: `trn_${i}`, ...t })) }),
    "sites.list": () => ({ sites: state.fakes.sites ?? [] }),
    "automations.list": () => ({ automations: state.fakes.automations ?? [] }),
    "backup.health": () => ({ state: state.fakes.backup?.state ?? "healthy", detail: "The last run failed." }),
  };
  const ctxFor = (who: Caller): MachinesCtx => ({
    space: "spc_test", principal: { kind: who.kind ?? "person", id: who.id }, trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => state.now, db,
    emit: (name, subject, payload) => { state.events.push({ name, subject, payload: payload as Record<string, unknown> }); return { id: "evt" }; },
    call: async (cap) => { const c = calls[cap]; if (!c) throw new Error(`no ${cap}`); return c(); },
    authorize: () => ({ effect: who.admin || who.kind === "service" ? "allow" : "deny" }),
  });
  const call = async (cap: string, input: Record<string, unknown>, who: Caller = admin): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = (handlers as Record<string, (c: MachinesCtx, i: never) => unknown>)[cap];
    if (!h) throw new Error(`no handler ${cap}`);
    return await h(ctxFor(who), input as never);
  };
  /** One machine's report as the host hands it over. */
  const feed = (machineId: string, kind: Kind, name: string, r: Report, o: { ownerId?: string; latencyMs?: number } = {}): boolean =>
    (hostCalls["machines.ingest"](ctxFor(host), { machineId, kind, name, report: r, ...o }) as { ok: boolean }).ok;
  const rooms = async (who: Caller = host, ids?: string[]) => { const r = (await call("machines.rooms", { ids: ids ?? ["space", "srv_berlin1", "device:dev_irfadmac", "device:dev_mayaair"] }, who)).rooms as Array<{ machineId: string; score: number; why: string; name: string }>; return Object.fromEntries(r.map((x) => [x.machineId, x])); };
  return { state, call, feed, rooms, ctxFor, db, sqlite, advance(ms: number) { state.now += ms; }, bind: bindMachines };
}
