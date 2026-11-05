// Machines handlers (lane l-machines): list, get, set, alerts. The rows come from reports (the host calls machines.ingest every 30 seconds per machine, see impl.ts); the privacy rule is applied
// here, once, for every reader: an admin looking at a member's own computer gets its name, whether it is online, its capacity and Vyre's own work, never the machine's load, disk or system.
import { NEXT } from "../../../host/src/daemon/doctor-next.ts";
import {
  allMachines, ensure, isOnline, machineById, maxTurnsOf, memAgo, mayList, pinsOf, raise, restrictedFor, roomOf, seriesOf, DAY, RANGES,
} from "../projections.ts";
import type { MachinesCtx, Range, Rec, Viewer } from "../projections.ts";
import type { Room } from "../../../lib/room-left.ts";
import { latestVersion, hostSeams } from "../seams.ts";
import { roomsFor, turnCounter } from "../rooms.ts";
import { busyNow, findingsOf, readMoves, recordMove, syncBusy } from "../more.ts";
import { isHostService, isSystemCall } from "../../../lib/trust.ts";
import { BUSY_BELOW } from "../../../lib/room-left.ts";

type Row = Record<string, unknown>;
const GB = 1024 ** 3;

/** The person acting, and whether they manage the Space's servers. A call from the host (a system caller) is an admin with no person. */
export function viewerOf(ctx: MachinesCtx): Viewer {
  const person = ctx.principal.kind === "person" ? ctx.principal.id : (ctx.actingFor ?? "");
  const admin = isHostService(ctx.principal) || (ctx.authorize?.({ perm: "server.network", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow");
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
  } catch { /* the reports stand */ }
  return out;
}

const gone = (r: Rec, dir: Map<string, Dir>): boolean => {
  if (r.kind === "space") return false;
  const d = dir.get(r.machineId);
  if (d?.removed) return true;
  // the directory listed servers (or devices) and this one is not among them: removed
  if (r.kind === "server" && dir.has("\u0000listed") && !d) return true;
  return false;
};

interface Comp { computerId: string; agentId: string; state: string; tabs: number; tabLimit: number; caption?: string; nodeId?: string }
async function agentComputers(ctx: MachinesCtx): Promise<Comp[]> {
  if (typeof ctx.call !== "function") return [];
  try { return ((await ctx.call("computers.list", {})) as { computers?: Comp[] }).computers ?? []; } catch { return []; }
}

/** The turns running on a machine now. The host knows it exactly for the machines it holds a socket to; a report is up to 30 seconds old. */

const shownName = (r: Rec, dir: Map<string, Dir>): string => r.nickname ?? (dir.get(r.machineId)?.name || r.name);

function out(ctx: MachinesCtx, r: Rec, v: Viewer, x: { dir: Map<string, Dir>; comps: Comp[]; pins: Array<{ machineId: string; agentId: string }>; turns: (r: Rec) => number; alerts: number }) {
  const now = ctx.now(), online = isOnline(r, now), restricted = restrictedFor(r, v);
  const turns = x.turns(r);
  const room: Room = roomOf(r, now, turns);
  const mine = x.comps.filter((c) => (c.nodeId ?? "space") === r.machineId);
  const runs = { turns, agentComputers: mine.length, sites: r.runs?.sites ?? 0, automations: r.runs?.automations ?? 0 };
  const own = !restricted;
  const tightest = restricted && (room.tightest === "cpu" || room.tightest === "memory" || room.tightest === "disk") ? "busy" : room.tightest;
  return {
    machineId: r.machineId, kind: r.kind, name: shownName(r, x.dir), ...(r.nickname ? { nickname: r.nickname } : {}), ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    personal: r.kind === "computer", mine: r.ownerId !== null && r.ownerId === v.id, online, draining: r.drain, restricted,
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
    if (!online && pinned.length) a.push({ alertId: `offline_pinned:${r.machineId}`, machineId: r.machineId, kind: "offline_pinned", severity: "bad", title: `${name} is offline and ${pinned.length === 1 ? "an agent is" : `${pinned.length} agents are`} pinned to it`, detail: "Their turns run on the next machine with room until it is back.", next: "Turn it on, or unpin the agent." });
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
  const reported = allMachines(ctx).filter((r) => mayList(r, v) && !gone(r, dir));
  // a server the Space approved that has not reported yet (or has never connected) is still the Space's: it is listed, offline, so an admin can open it and remove it
  const known = new Set(reported.map((r) => r.machineId));
  const waiting: Rec[] = v.admin ? [...dir.entries()].filter(([id, d]) => /^srv_/.test(id) && !d.removed && !known.has(id)).map(([id, d]) => ({
    machineId: id, kind: "server", name: d.name || id, ownerId: null, nickname: null, maxTurns: null, maxAgentComputers: null, drain: false, specs: null, load: null, runs: null, can: [], vyre: null, version: null, latencyMs: null, lastSeen: null, firstSeen: ctx.now(),
  })) : [];
  const recs = [...reported, ...waiting];
  return { v, dir, comps, pins, recs, turns: await turnCounter(ctx) };
}

export async function list(ctx: MachinesCtx, _input: Record<string, never>) {
  const { v, dir, comps, pins, recs, turns } = await context(ctx);
  const alerts = await alertsFor(ctx, v, recs, dir, pins);
  const machines = recs.map((r) => out(ctx, r, v, { dir, comps, pins, turns, alerts: alerts.filter((a) => a.machineId === r.machineId).length }));
  const taking = machines.filter((m) => m.online && !m.draining);
  return {
    machines,
    summary: { online: machines.filter((m) => m.online).length, total: machines.length, agentComputers: comps.length, roomAvg: taking.length ? Math.round(taking.reduce((n, m) => n + m.room.score, 0) / taking.length) : 0 },
  };
}

interface Work { kind: "turn" | "site" | "automation"; agentId?: string; what: string; where: string; minutes: number }

/** What Vyre runs on a machine right now: the turns, and on the Space server its sites and automations. Never a message, title or file. */
async function workOf(ctx: MachinesCtx, r: Rec): Promise<Work[]> {
  if (typeof ctx.call !== "function") return [];
  const out: Work[] = [], now = ctx.now();
  try {
    const t = (await ctx.call("engine.turns.running", {})) as { turns?: Array<{ agentId: string; startedAt: number; where: { kind: string; nodeId?: string } }> };
    for (const x of t.turns ?? []) {
      const here = r.kind === "space" ? x.where.kind === "space" : x.where.nodeId === r.machineId;
      if (here) out.push({ kind: "turn", agentId: x.agentId, what: "Working on a turn", where: "In a chat", minutes: Math.max(0, Math.round((now - x.startedAt) / 60_000)) });
    }
  } catch { /* an engine that is not here has nothing running */ }
  if (r.kind === "space") {
    try {
      const sites = (await ctx.call("sites.list", { section: "space" })) as { sites?: Array<{ name: string; live?: boolean; computerId?: string; updatedAt?: number }> };
      for (const x of sites.sites ?? []) if (x.live === true && !x.computerId) out.push({ kind: "site", what: `Serving ${x.name}`, where: "Site", minutes: x.updatedAt ? Math.max(0, Math.round((now - x.updatedAt) / 60_000)) : 0 });
    } catch { /* no sites module */ }
    try {
      const autos = (await ctx.call("automations.list", { section: "space", status: "on" })) as { automations?: Array<{ name: string; updatedAt?: number }> };
      for (const x of autos.automations ?? []) out.push({ kind: "automation", what: `Automation ${x.name} is on`, where: "Automation", minutes: x.updatedAt ? Math.max(0, Math.round((now - x.updatedAt) / 60_000)) : 0 });
    } catch { /* no automations module */ }
  }
  return out.slice(0, 60);
}

/** The last Fix pressed on a machine and how it went. */
function lastFixOf(ctx: MachinesCtx, id: string): { fix: string; at: number; state: "done" | "failed"; detail: string } | undefined {
  const r = ctx.db.all("SELECT value FROM machines_meta WHERE key = ?", `fix:${id}`)[0] as { value?: string } | undefined;
  try { return r?.value ? (JSON.parse(r.value) as { fix: string; at: number; state: "done" | "failed"; detail: string }) : undefined; } catch { return undefined; }
}

export async function get(ctx: MachinesCtx, input: { machineId: string }) {
  const { v, dir, comps, pins, recs, turns } = await context(ctx);
  const r = recs.find((x) => x.machineId === input.machineId);
  if (!r) raise(ctx, "validation.not_found", "That machine is not in this Space.");
  const alerts = (await alertsFor(ctx, v, [r], dir, pins)).filter((a) => a.machineId === r.machineId);
  const machine = out(ctx, r, v, { dir, comps, pins, turns, alerts: alerts.length });
  const own = !machine.restricted;
  const series = Object.fromEntries((Object.keys(RANGES) as Range[]).map((k) => [k, seriesOf(ctx, r.machineId, k, own)]));
  const latest = v.admin ? await latestVersion(ctx) : null;
  const doctor = r.kind === "space" && v.admin ? await hostSeams.findings() : [];
  const findings = own ? [...doctor.map((f) => ({ key: `doctor.${f.key}`, state: f.state, detail: f.detail || f.key, next: f.next, fix: null })), ...findingsOf(r, latest)] : [];
  const lastFix = own ? lastFixOf(ctx, r.machineId) : undefined;
  return { machine, series, work: await workOf(ctx, r), alerts, findings, idleSessions: own ? hostSeams.idle(r.machineId, r.kind !== "space" ? r.ownerId ?? undefined : undefined) : 0, privacy: own ? "full" : "vyre_only", ...(lastFix ? { lastFix } : {}) };
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
  // every refusal comes before any write: a call refused for one field changes nothing
  if (input.nickname !== undefined) need(mayConfigure, "its name");
  if (input.maxTurns !== undefined) need(mayConfigure, "the most turns at once");
  if (input.maxAgentComputers !== undefined) need(mayConfigure, "the most agent computers at once");
  if (input.drain !== undefined) need(v.admin || owner, "draining");
  if (input.pinAgent) need(mayConfigure, "which agents are pinned");
  const n = input.nickname === undefined || input.nickname === null ? null : input.nickname.trim();
  if (n !== null && n !== "" && !NICK.test(n)) raise(ctx, "validation.bad_input", "A name is up to 40 characters.");
  if (input.nickname !== undefined) {
    ctx.db.run("UPDATE machines_machine SET nickname = ? WHERE machine_id = ?", n === "" ? null : n, r.machineId);
    changes.push("nickname");
  }
  if (input.maxTurns !== undefined) { ctx.db.run("UPDATE machines_machine SET max_turns = ? WHERE machine_id = ?", input.maxTurns, r.machineId); if (input.maxTurns !== r.maxTurns) changes.push("limits"); }
  if (input.maxAgentComputers !== undefined) { ctx.db.run("UPDATE machines_machine SET max_agent_computers = ? WHERE machine_id = ?", input.maxAgentComputers, r.machineId); if (input.maxAgentComputers !== r.maxAgentComputers) changes.push("limits"); }
  if (input.drain !== undefined) { ctx.db.run("UPDATE machines_machine SET drain = ? WHERE machine_id = ?", input.drain ? 1 : 0, r.machineId); if (input.drain !== r.drain) changes.push("drain"); }
  if (input.pinAgent) {
    // an agent is pinned to one machine at a time: pinning it here lets go of the others
    if (input.pinAgent.pinned) { ctx.db.run("DELETE FROM machines_pin WHERE agent_id = ?", input.pinAgent.agentId); ctx.db.run("INSERT OR REPLACE INTO machines_pin (machine_id, agent_id, at) VALUES (?, ?, ?)", r.machineId, input.pinAgent.agentId, ctx.now()); }
    else ctx.db.run("DELETE FROM machines_pin WHERE machine_id = ? AND agent_id = ?", r.machineId, input.pinAgent.agentId);
    changes.push("pins");
  }
  if (changes.length) ctx.emit("machine.changed", r.machineId, { machineId: r.machineId, what: [...new Set(changes)] });
  const after = machineById(ctx, r.machineId)!;
  const { dir, comps, pins, turns } = await context(ctx);
  return { machine: out(ctx, after, v, { dir, comps, pins, turns, alerts: 0 }) };
}

export async function alerts(ctx: MachinesCtx, _input: Record<string, never>) {
  const { v, dir, pins, recs } = await context(ctx);
  return { alerts: await alertsFor(ctx, v, recs, dir, pins) };
}

/** Room left on the named machines the caller may see (own machines, or any for an admin). Placement asks for a person's own computers, their servers and the Space server. */
export async function rooms(ctx: MachinesCtx, input: { ids: string[]; agentId?: string }) {
  ensure(ctx.db);
  const v = viewerOf(ctx), want = new Set(input.ids);
  // the machine an agent is pinned to, if it is one of the machines asked about (placement never sends a person's turn to a machine that is not theirs)
  const pin = input.agentId ? pinsOf(ctx).find((p) => p.agentId === input.agentId && want.has(p.machineId)) : undefined;
  const room = await roomsFor(ctx);
  return {
    ...(pin ? { pinnedTo: pin.machineId } : {}),
    rooms: allMachines(ctx).filter((r) => want.has(r.machineId) && (mayList(r, v) || r.kind === "space")).map((r) => {
      const x = room[r.machineId]!;
      // another person's machine reveals nothing but a number and the turns: the words for CPU, memory and disk stay with its owner
      const why = restrictedFor(r, v) ? (/^\d+ of \d+ turns$|^draining$|^offline$/.test(x.why) ? x.why : "busy") : x.why;
      return { machineId: r.machineId, name: x.name, score: x.score, why, turns: x.turns, maxTurns: x.maxTurns, draining: x.draining };
    }),
  };
}

// ---- Fix, Recent moves, alerts told once

const FIXES = ["clear_caches", "stop_idle", "restart_service"] as const;
const SERVICE = /^[a-z][a-z0-9_.-]{0,40}$/;

/**
 * A Doctor finding's Fix on the machine: clear old caches, stop idle engine sessions, restart a service. The host runs it (on the Space server here, on any other machine over its link). An admin fixes the
 * Space server and servers; only the owner fixes a member's own computer. Every press is audited and its outcome kept as the machine's last fix.
 */
export async function fix(ctx: MachinesCtx, input: { machineId: string; fix: (typeof FIXES)[number]; service?: string }) {
  ensure(ctx.db);
  const v = viewerOf(ctx), r = machineById(ctx, input.machineId);
  if (!r || !mayList(r, v)) raise(ctx, "validation.not_found", "That machine is not in this Space.");
  const owner = r.ownerId !== null && r.ownerId === v.id;
  if (!(r.kind === "computer" ? owner : v.admin || owner)) raise(ctx, "permission.no_grant", `Only ${r.kind === "computer" ? "the person it belongs to" : "an admin"} can fix it.`);
  if (!(FIXES as readonly string[]).includes(input.fix)) raise(ctx, "validation.bad_input", "That fix is not one Vyre knows.");
  if (input.fix === "restart_service" && !(typeof input.service === "string" && SERVICE.test(input.service))) raise(ctx, "validation.bad_input", "Name the service to restart.");
  if (!isOnline(r, ctx.now())) raise(ctx, "validation.precondition_failed", "That machine is offline. Fix it when it is back.");
  let state: "done" | "failed" = "done", detail: string;
  try { detail = await hostSeams.fix(r.machineId, input.fix, input.service, r.kind !== "space" ? r.ownerId ?? undefined : undefined); } catch (e) { state = "failed"; detail = e instanceof Error ? e.message.slice(0, 200) : "It could not be done."; }
  const last = { fix: input.fix, at: ctx.now(), state, detail };
  ctx.db.run("INSERT OR REPLACE INTO machines_meta (key, value) VALUES (?, ?)", `fix:${r.machineId}`, JSON.stringify(last));
  return { state, detail };
}

/** Where Automatic moved turns off a machine with no room, newest first: every move for an admin, a member's own for a member. */
export async function moves(ctx: MachinesCtx, input: { limit?: number }) {
  const limit = typeof input.limit === "number" && input.limit >= 1 && input.limit <= 200 ? Math.floor(input.limit) : 50;
  const v = viewerOf(ctx);
  return { moves: readMoves(ctx, limit, v.admin ? undefined : v.id) };
}

/** The engine tells the Space a turn was moved. Never a person's call: a nested call or the host. */
export async function moveRecord(ctx: MachinesCtx, input: { turnId?: string; asker?: string; agentId?: string; threadId?: string; from: string; to: string; why: string }) {
  if (!isSystemCall(ctx)) raise(ctx, "permission.no_grant", "Only the engine records a move.");
  recordMove(ctx, input);
  return { ok: true };
}

/**
 * Host only, about once a minute: tell every admin about each new alert once while it lasts (the Inbox line), and tell the placement caches when a machine ran out of room or has room again
 * (machine.changed), so a cached answer never goes on ignoring room.
 */
export async function alertsNotify(ctx: MachinesCtx, _input: Record<string, never>) {
  if (!isHostService(ctx.principal)) raise(ctx, "permission.no_grant", "Only the host sends machine alerts to the Inbox.");
  ensure(ctx.db);
  const recs = allMachines(ctx), host: Viewer = { id: "", admin: true };
  const now = await alertsFor(ctx, host, recs, new Map(), pinsOf(ctx));
  const seen = new Set((ctx.db.all("SELECT alert_id FROM machines_alert_seen") as { alert_id: string }[]).map((x) => x.alert_id));
  const fresh = now.filter((a) => !seen.has(a.alertId) && a.kind !== "update_waiting");
  for (const a of fresh) { ctx.db.run("INSERT OR REPLACE INTO machines_alert_seen (alert_id, at) VALUES (?, ?)", a.alertId, ctx.now()); ctx.emit("machine.alert", a.machineId, { alertId: a.alertId, machineId: a.machineId, kind: a.kind, title: a.title, detail: a.detail }); }
  const live = new Set(now.map((a) => a.alertId));
  for (const id of seen) if (!live.has(id)) ctx.db.run("DELETE FROM machines_alert_seen WHERE alert_id = ?", id);
  await tellRoom(ctx);
  return { sent: fresh.length };
}

/**
 * Tell the placement caches when a machine ran out of room or has room again (machine.changed): the host calls this the moment a turn starts or ends on a machine, so a cached answer never goes on
 * ignoring room; the minute job calls it too, for what the host cannot see (a report that brought a machine's CPU or disk past the line).
 */
export async function tellRoom(ctx: MachinesCtx): Promise<{ filled: string[]; freed: string[] }> {
  ensure(ctx.db);
  const sw = syncBusy(ctx, busyNow(ctx, await turnCounter(ctx), BUSY_BELOW));
  for (const id of sw.filled) ctx.emit("machine.changed", id, { machineId: id, what: ["full"] });
  for (const id of sw.freed) ctx.emit("machine.changed", id, { machineId: id, what: ["room"] });
  return sw;
}
