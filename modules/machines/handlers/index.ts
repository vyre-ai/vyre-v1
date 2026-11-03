// Machines handlers (lane l-machines): list, get, set, alerts. The rows come from reports (the host calls machines.ingest every 30 seconds per machine, see impl.ts); the privacy rule is applied
// here, once, for every reader: an admin looking at a member's own computer gets its name, whether it is online, its capacity and Vyre's own work, never the machine's load, disk or system.
import { NEXT } from "../../../host/src/daemon/doctor-next.ts";
import {
  allMachines, ensure, isOnline, machineById, maxTurnsOf, memAgo, mayList, pinsOf, raise, restrictedFor, roomOf, seriesOf, DAY, RANGES,
} from "../projections.ts";
import type { MachinesCtx, Range, Rec, Viewer } from "../projections.ts";
import type { Room } from "../../../agent/src/placement/room.ts";
import { latestVersion, hostSeams } from "../seams.ts";

type Row = Record<string, unknown>;
const GB = 1024 ** 3;

/** The person acting, and whether they manage the Space's servers. A call from the host (a system caller) is an admin with no person. */
export function viewerOf(ctx: MachinesCtx): Viewer {
  const person = ctx.principal.kind === "person" ? ctx.principal.id : (ctx.actingFor ?? "");
  const admin = ctx.principal.kind === "service" || (ctx.authorize?.({ perm: "server.network", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow");
  return { id: person, admin };
}

interface Dir { name?: string; removed?: boolean; owner?: string }
/** What the Space knows of each machine apart from its reports: the name a person gave a server, and whether it was removed. Best effort: a missing answer leaves the machine's own words. */
async function directory(ctx: MachinesCtx, v: Viewer): Promise<Map<string, Dir>> {
  const out = new Map<string, Dir>();
  if (typeof ctx.call !== "function") return out;
  try {
    const r = (await ctx.call(v.admin ? "network.servers" : "network.my_computers", {})) as { servers?: Row[]; computers?: Row[] };
    for (const s of [...(r.servers ?? []), ...(r.computers ?? [])]) {
      const id = String(s["serverId"] ?? "");
      if (id) out.set(id, { name: String(s["name"] ?? s["nickname"] ?? ""), ...(s["enrollment"] === "pending" ? { removed: true } : {}) });
    }
    if (r.servers || r.computers) {
      // a server that is not in the list any more was removed
      out.set("\u0000listed", {});
    }
  } catch { /* the reports stand */ }
  try {
    const d = (await ctx.call(v.admin ? "devices.list" : "devices.mine", {})) as { devices?: Row[] };
    for (const x of d.devices ?? []) out.set(`device:${String(x["id"])}`, { name: String(x["name"] ?? ""), ...(x["revokedAt"] !== undefined ? { removed: true } : {}), owner: String(x["person"] ?? "") });
    if (d.devices) out.set("\u0000devices", {});
  } catch { /* the reports stand */ }
  return out;
}

const gone = (r: Rec, dir: Map<string, Dir>): boolean => {
  if (r.kind === "space") return false;
  const d = dir.get(r.machineId);
  if (d?.removed) return true;
  // the directory listed servers (or devices) and this one is not among them: removed
  if (r.kind === "server" && dir.has("\u0000listed") && !d) return true;
  if (r.kind === "computer" && dir.has("\u0000devices") && !d) return true;
  return false;
};

interface Comp { computerId: string; agentId: string; state: string; tabs: number; tabLimit: number; caption?: string; nodeId?: string }
async function agentComputers(ctx: MachinesCtx): Promise<Comp[]> {
  if (typeof ctx.call !== "function") return [];
  try { return ((await ctx.call("computers.list", {})) as { computers?: Comp[] }).computers ?? []; } catch { return []; }
}

/** The turns running on a machine now. The host knows it exactly for the machines it holds a socket to; a report is up to 30 seconds old. */
const turnsOn = (r: Rec): number => hostSeams.turns(r.machineId) ?? r.runs?.turns ?? 0;

const shownName = (r: Rec, dir: Map<string, Dir>): string => r.nickname ?? (dir.get(r.machineId)?.name || r.name);

function out(ctx: MachinesCtx, r: Rec, v: Viewer, x: { dir: Map<string, Dir>; comps: Comp[]; pins: Array<{ machineId: string; agentId: string }>; alerts: number }) {
  const now = ctx.now(), online = isOnline(r, now), restricted = restrictedFor(r, v);
  const turns = turnsOn(r);
  const room: Room = roomOf(r, now, turns);
  const mine = x.comps.filter((c) => (c.nodeId ?? "space") === r.machineId);
  const runs = { turns, agentComputers: mine.length, sites: r.runs?.sites ?? 0, automations: r.runs?.automations ?? 0 };
  const own = !restricted;
  const tightest = restricted && (room.tightest === "cpu" || room.tightest === "memory" || room.tightest === "disk") ? "busy" : room.tightest;
  return {
    machineId: r.machineId, kind: r.kind, name: shownName(r, x.dir), ...(r.nickname ? { nickname: r.nickname } : {}), ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    personal: r.kind === "computer", online, draining: r.drain, restricted,
    ...(r.lastSeen !== null ? { lastSeenAt: r.lastSeen } : {}), ...(r.latencyMs !== null && online ? { latencyMs: r.latencyMs } : {}), ...(r.version ? { version: r.version } : {}),
    ...(own && r.specs ? { os: r.specs.os, arch: r.specs.arch, diskBytes: r.specs.diskBytes, ...(r.specs.gpu ? { gpu: r.specs.gpu } : {}) } : {}),
    ...(r.specs ? { cores: r.specs.cores, memBytes: r.specs.memBytes } : {}),
    ...(own && r.load && online ? { load: r.load } : {}),
    ...(!own && r.vyre && online ? { vyreLoad: r.vyre } : {}),
    runs, can: r.can, limits: { maxTurns: maxTurnsOf(r), maxAgentComputers: r.maxAgentComputers ?? (r.kind === "computer" ? 0 : Math.max(1, Math.floor((r.specs?.cores ?? 2) / 2))) },
    pinned: x.pins.filter((p) => p.machineId === r.machineId).map((p) => ({ agentId: p.agentId })),
    room: { score: room.score, tightest }, alerts: x.alerts,
    agentComputers: mine.map((c) => ({ computerId: c.computerId, agentId: c.agentId, state: c.state, tabs: c.tabs, tabLimit: c.tabLimit, ...(c.caption ? { caption: c.caption } : {}) })),
  };
}

// ---- alerts ----

export interface Alert { alertId: string; machineId: string; kind: "disk_low" | "memory_pressure" | "offline_pinned" | "update_waiting" | "backup_failed"; severity: "info" | "warn" | "bad"; title: string; detail: string; next: string }

async function alertsFor(ctx: MachinesCtx, v: Viewer, recs: Rec[], dir: Map<string, Dir>, pins: Array<{ machineId: string; agentId: string }>): Promise<Alert[]> {
  const now = ctx.now(), a: Alert[] = [];
  const target = await latestVersion(ctx);
  for (const r of recs) {
    const name = shownName(r, dir), online = isOnline(r, now), restricted = restrictedFor(r, v);
    const s = r.specs, l = r.load;
    if (online && !restricted && s && l && s.diskBytes > 0) {
      const free = (l.diskFreeBytes / s.diskBytes) * 100;
      if (free < 10) a.push({ alertId: `disk_low:${r.machineId}`, machineId: r.machineId, kind: "disk_low", severity: "warn", title: `${name} has ${Math.round(free)}% disk left`, detail: `${Math.round(l.diskFreeBytes / GB)} GB of ${Math.round(s.diskBytes / GB)} GB free`, next: NEXT.space });
    }
    if (online && !restricted && s && l && s.memBytes > 0) {
      const mem = (l.memUsedBytes / s.memBytes) * 100;
      if (mem > 85) {
        const was = memAgo(ctx, r.machineId, DAY);
        a.push({ alertId: `memory_pressure:${r.machineId}`, machineId: r.machineId, kind: "memory_pressure", severity: "warn", title: `${name} is short of memory`, detail: `${Math.round(mem)}% in use${was !== null ? `, up from ${Math.round(was)}% yesterday` : ""}`, next: "Close what is not needed on it, or lower the most turns it takes at once." });
      }
    }
    const pinned = pins.filter((p) => p.machineId === r.machineId);
    if (!online && pinned.length) a.push({ alertId: `offline_pinned:${r.machineId}`, machineId: r.machineId, kind: "offline_pinned", severity: "bad", title: `${name} is offline and ${pinned.length === 1 ? "an agent is" : `${pinned.length} agents are`} pinned to it`, detail: "The pinned work waits until it is back.", next: "Turn it on, or unpin the agent so its work can run elsewhere." });
    if (online && !restricted && r.kind !== "computer" && target && r.version && r.version !== target) a.push({ alertId: `update_waiting:${r.machineId}`, machineId: r.machineId, kind: "update_waiting", severity: "info", title: `Update ${target} is waiting on ${name}`, detail: `It runs ${r.version}.`, next: "Update it from Console, Server." });
  }
  if (v.admin && recs.some((r) => r.kind === "space") && typeof ctx.call === "function") {
    try {
      const b = (await ctx.call("backup.health", {})) as { state?: string; detail?: string };
      if (b.state === "down") a.push({ alertId: "backup_failed:space", machineId: "space", kind: "backup_failed", severity: "bad", title: "The last backup failed", detail: b.detail ?? "", next: "Back up again from Data." });
    } catch { /* not an admin who may read it, or no backup module */ }
  }
  return a;
}

async function context(ctx: MachinesCtx) {
  ensure(ctx.db);
  const v = viewerOf(ctx);
  const [dir, comps] = await Promise.all([directory(ctx, v), agentComputers(ctx)]);
  const pins = pinsOf(ctx);
  const recs = allMachines(ctx).filter((r) => mayList(r, v) && !gone(r, dir));
  return { v, dir, comps, pins, recs };
}

export async function list(ctx: MachinesCtx, _input: Record<string, never>) {
  const { v, dir, comps, pins, recs } = await context(ctx);
  const alerts = await alertsFor(ctx, v, recs, dir, pins);
  const machines = recs.map((r) => out(ctx, r, v, { dir, comps, pins, alerts: alerts.filter((a) => a.machineId === r.machineId).length }));
  const taking = machines.filter((m) => m.online && !m.draining);
  return {
    machines,
    summary: { online: machines.filter((m) => m.online).length, total: machines.length, agentComputers: comps.length, roomAvg: taking.length ? Math.round(taking.reduce((n, m) => n + m.room.score, 0) / taking.length) : 0 },
  };
}

export async function get(ctx: MachinesCtx, input: { machineId: string }) {
  const { v, dir, comps, pins, recs } = await context(ctx);
  const r = recs.find((x) => x.machineId === input.machineId);
  if (!r) raise(ctx, "validation.not_found", "That machine is not in this Space.");
  const alerts = (await alertsFor(ctx, v, [r], dir, pins)).filter((a) => a.machineId === r.machineId);
  const machine = out(ctx, r, v, { dir, comps, pins, alerts: alerts.length });
  const own = !machine.restricted;
  const series = Object.fromEntries((Object.keys(RANGES) as Range[]).map((k) => [k, seriesOf(ctx, r.machineId, k, own)]));
  const findings = r.kind === "space" && v.admin ? await hostSeams.findings() : [];
  return { machine, series, work: [] as Array<{ agentId: string; what: string; where: string; minutes: number }>, alerts, findings };
}

const NICK = /^[^\u0000-\u001f]{1,40}$/;
export async function set(ctx: MachinesCtx, input: { machineId: string; nickname?: string | null; maxTurns?: number; maxAgentComputers?: number; drain?: boolean; pinAgent?: { agentId: string; pinned: boolean } }) {
  ensure(ctx.db);
  const v = viewerOf(ctx);
  const r = machineById(ctx, input.machineId);
  if (!r || !mayList(r, v)) raise(ctx, "validation.not_found", "That machine is not in this Space.");
  const owner = r.ownerId !== null && r.ownerId === v.id;
  // a person's own computer is theirs to name, limit and pin; an admin may only drain it (stop new work). A server or the Space server is an admin's, and the owner's if they added it.
  const mayConfigure = r.kind === "computer" ? owner : v.admin || owner;
  const changes: string[] = [];
  const need = (ok: boolean, what: string): void => { if (!ok) raise(ctx, "permission.no_grant", `Only ${r.kind === "computer" ? "the person it belongs to" : "an admin"} can change ${what}.`); };
  if (input.nickname !== undefined) {
    need(mayConfigure, "its name");
    const n = input.nickname === null ? null : input.nickname.trim();
    if (n !== null && n !== "" && !NICK.test(n)) raise(ctx, "validation.bad_input", "A name is up to 40 characters.");
    ctx.db.run("UPDATE machines_machine SET nickname = ? WHERE machine_id = ?", n === "" ? null : n, r.machineId);
    changes.push("nickname");
  }
  if (input.maxTurns !== undefined) { need(mayConfigure, "the most turns at once"); ctx.db.run("UPDATE machines_machine SET max_turns = ? WHERE machine_id = ?", input.maxTurns, r.machineId); changes.push("limits"); }
  if (input.maxAgentComputers !== undefined) { need(mayConfigure, "the most agent computers at once"); ctx.db.run("UPDATE machines_machine SET max_agent_computers = ? WHERE machine_id = ?", input.maxAgentComputers, r.machineId); changes.push("limits"); }
  if (input.drain !== undefined) { need(v.admin || owner, "draining"); ctx.db.run("UPDATE machines_machine SET drain = ? WHERE machine_id = ?", input.drain ? 1 : 0, r.machineId); changes.push("drain"); }
  if (input.pinAgent) {
    need(mayConfigure, "which agents are pinned");
    if (input.pinAgent.pinned) ctx.db.run("INSERT OR REPLACE INTO machines_pin (machine_id, agent_id, at) VALUES (?, ?, ?)", r.machineId, input.pinAgent.agentId, ctx.now());
    else ctx.db.run("DELETE FROM machines_pin WHERE machine_id = ? AND agent_id = ?", r.machineId, input.pinAgent.agentId);
    changes.push("pins");
  }
  if (changes.length) ctx.emit("machine.changed", r.machineId, { machineId: r.machineId, what: [...new Set(changes)] });
  const after = machineById(ctx, r.machineId)!;
  const { dir, comps, pins } = await context(ctx);
  return { machine: out(ctx, after, v, { dir, comps, pins, alerts: 0 }) };
}

export async function alerts(ctx: MachinesCtx, _input: Record<string, never>) {
  const { v, dir, pins, recs } = await context(ctx);
  return { alerts: await alertsFor(ctx, v, recs, dir, pins) };
}
