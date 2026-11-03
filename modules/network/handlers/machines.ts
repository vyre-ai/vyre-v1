// Machines (owner ruling 4 Nov, "Machines monitor"): every computer that runs Vyre work as one list with one page each, its history, limits, drain, pinned agents and alerts. The reports come from the
// daemons (host/src/daemon/machines.ts for the Space server, the device link's report frame for a member's own computer) and are stored by lib/machines.ts; these are the reads and the few writes.
//
// Who sees what: an admin sees every machine. On a member's own computer an admin sees its name, whether it is online, its capacity and Vyre's own work, and never its other files or processes (the report
// carries only Vyre's share of the load besides). A member sees their own machines in full and no one else's.

import { alertsOf, diskPct, findingsOf, isRange, memPct, place, readMeta, readSeries, readStored, roomOf, writeMeta } from "../../../lib/machines.ts";
import type { AlertIn, Candidate, Finding, Load, MachineAlert, MachineMeta, Placement, Range, Runs, Series, Specs } from "../../../lib/machines.ts";
import { failWith, servers } from "./status.ts";
import type { NetworkCtx, ServerRow } from "./status.ts";

type In = Record<string, unknown>;

export interface MachineRow {
  serverId: string; name: string; nickname?: string; kind: "space" | "server" | "linked"; owner?: string; mine: boolean;
  state: "healthy" | "degraded" | "down"; online: boolean; lastSeenAt?: number; version?: string; os?: string; arch?: string;
  cores?: number; memBytes?: number; diskBytes?: number; latencyMs?: number;
  /** The whole machine's load: absent when it is a member's own computer and the asker is an admin. */
  load?: { cpu: number; memPct: number; diskPct: number; diskFreeBytes: number };
  /** Vyre's own share, always present when the machine has reported. */
  vyre?: { cpu: number; memPct: number };
  private: boolean;
  runs: { turns: number; agentComputers: number; sites: number; automations: number };
  can: string[];
  room: { n: number; why: string };
  limits: { maxTurns: number | null; maxAgentComputers: number | null };
  drain: boolean; pins: string[];
}

export const isAdmin = (ctx: NetworkCtx): boolean => ctx.authorize({ perm: "server.network", level: "manage" }, { type: "space", id: null }).effect === "allow";
const me = (ctx: NetworkCtx): string => ctx.actingFor ?? ctx.principal.id;
const kindOf = (s: ServerRow): MachineRow["kind"] => (s.role === "space" ? "space" : s.owner && s.serverId.startsWith("srv_dev_") ? "linked" : "server");

/** The latest version this Space could be on, if the asker may know it. */
async function latestVersion(ctx: NetworkCtx): Promise<string | null> {
  try { const u = (await ctx.call("updates.status", {})) as { available?: string }; return typeof u.available === "string" ? u.available : null; } catch { return null; }
}

interface Built { row: MachineRow; meta: MachineMeta; specs: Specs | null; load: Load | null; runs: Runs | null; personalOfOther: boolean }

function build(ctx: NetworkCtx, s: ServerRow, admin: boolean): Built | null {
  const mine = s.owner === me(ctx);
  if (s.role === "compute" && s.enrollment === "pending") return null;
  if (!admin && !mine) return null;
  const meta = readMeta(ctx.db, s.serverId), st = readStored(ctx.db, s.serverId);
  const online = s.state !== "down";
  const personal = s.role === "compute" && !!s.owner;
  // a member's own computer, seen by someone else: no whole-machine load
  const hidden = personal && !mine;
  const runs = st.runs ?? { turns: 0, agentComputers: 0, sites: 0, automations: 0, work: [] };
  const mp = st.specs && st.load ? memPct(st.specs, st.load) : 0, dp = st.specs && st.load ? diskPct(st.specs, st.load) : 0;
  const room = roomOf({ online, drain: meta.drain, cpu: st.load?.cpu ?? 0, memPct: mp, diskPct: dp, turns: online ? runs.turns : 0, maxTurns: meta.maxTurns });
  const row: MachineRow = {
    serverId: s.serverId, name: s.name, kind: kindOf(s), mine, state: s.state, online, private: hidden,
    runs: { turns: runs.turns, agentComputers: runs.agentComputers, sites: runs.sites, automations: runs.automations },
    can: st.can, room, limits: { maxTurns: meta.maxTurns, maxAgentComputers: meta.maxAgentComputers }, drain: meta.drain, pins: meta.pins,
  };
  if (meta.nickname) row.nickname = meta.nickname;
  if (s.owner) row.owner = s.owner;
  if (s.lastSeenAt !== undefined) row.lastSeenAt = s.lastSeenAt;
  if (st.specs) { row.version = st.specs.version; row.os = st.specs.os; row.arch = st.specs.arch; row.cores = st.specs.cores; row.memBytes = st.specs.memBytes; row.diskBytes = st.specs.diskBytes; }
  else if (s.facts) { row.version = s.facts.version; row.os = s.facts.os; row.arch = s.facts.arch; }
  if (st.latencyMs !== null) row.latencyMs = st.latencyMs;
  if (st.specs && st.load) {
    if (!hidden) row.load = { cpu: st.load.cpu, memPct: Math.round(mp * 10) / 10, diskPct: Math.round(dp * 10) / 10, diskFreeBytes: st.load.diskFreeBytes };
    if (st.load.vyreCpu !== undefined) row.vyre = { cpu: st.load.vyreCpu, memPct: st.specs.memBytes > 0 && st.load.vyreMemBytes !== undefined ? Math.round((st.load.vyreMemBytes / st.specs.memBytes) * 1000) / 10 : 0 };
  }
  return { row, meta, specs: st.specs, load: st.load, runs: st.runs, personalOfOther: hidden };
}

/** The alerts of the machines the asker may see. A member's own computer alerts only its owner; the admin gets the Space's. */
function alertsFor(ctx: NetworkCtx, built: readonly Built[], latest: string | null, now: number): MachineAlert[] {
  const ms: AlertIn[] = built.filter((b) => !b.personalOfOther || b.meta.pins.length > 0).map((b) => {
    const hide = b.personalOfOther;   // an admin hears of an offline machine with pinned work, never of another person's disk or memory
    return { serverId: b.row.serverId, name: b.row.nickname ?? b.row.name, online: b.row.online, personal: !!b.row.owner && b.row.kind === "linked", version: b.row.version ?? null, memPct: hide ? null : b.row.load?.memPct ?? null, diskPct: hide ? null : b.row.load?.diskPct ?? null, diskBytes: b.row.diskBytes ?? 0, pins: b.meta.pins, seenAt: b.row.lastSeenAt ?? null };
  });
  return alertsOf(ms, latest, null, now);
}

export async function machines(ctx: NetworkCtx, _input: In) {
  const admin = isAdmin(ctx), all = servers(ctx);
  const built = all.map((s) => build(ctx, s, admin)).filter((b): b is Built => b !== null);
  const latest = admin ? await latestVersion(ctx) : null;
  const alerts = alertsFor(ctx, built, latest, ctx.now());
  return { machines: built.map((b) => b.row), alerts, admin, now: ctx.now() };
}

export async function machine(ctx: NetworkCtx, input: { serverId: string; range?: unknown }) {
  const admin = isAdmin(ctx), s = servers(ctx).find((x) => x.serverId === input.serverId);
  const b = s ? build(ctx, s, admin) : null;
  if (!s || !b) return failWith(ctx.trace.traceId, "validation.not_found", "That machine is not here.", { serverId: input.serverId });
  const range: Range = isRange(input.range) ? input.range : "24h";
  const series: Series = readSeries(ctx.db, s.serverId, range, ctx.now(), b.personalOfOther);
  const latest = admin ? await latestVersion(ctx) : null;
  let findings: Finding[] = b.personalOfOther ? [] : findingsOf(b.specs, b.load, latest, b.row.can, b.row.kind === "linked");
  // the Space server also answers the host's own Doctor, so the page shows what `vyre-server doctor` shows
  if (b.row.kind === "space") {
    try {
      const d = (await ctx.call("health.doctor", {})) as { findings?: { key: string; state: Finding["state"]; next: string; detail?: string }[] };
      findings = [...(d.findings ?? []).map((f) => ({ key: `doctor.${f.key}`, state: f.state, detail: f.detail ?? f.key, next: f.next, fix: null })), ...findings];
    } catch { /* an asker without the Doctor's permission sees the machine's own findings only */ }
  }
  const work = b.personalOfOther ? [] : (b.runs?.work ?? []);
  return { machine: b.row, series, findings, work, alerts: alertsFor(ctx, [b], latest, ctx.now()), privacy: b.personalOfOther ? "vyre_only" : "full" };
}

const mayChange = (ctx: NetworkCtx, s: ServerRow, admin: boolean): boolean => (s.owner ? s.owner === me(ctx) : admin);
const cap = (v: unknown, hi: number): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= hi ? v : undefined);

/** Nickname, limits and Drain. Only the owner changes a member's own computer; an admin changes the Space server and servers the Space holds. */
export async function machineSet(ctx: NetworkCtx, input: { serverId: string; nickname?: string | null; maxTurns?: number | null; maxAgentComputers?: number | null; drain?: boolean }) {
  const s = servers(ctx).find((x) => x.serverId === input.serverId);
  if (!s) return failWith(ctx.trace.traceId, "validation.not_found", "That machine is not here.", { serverId: input.serverId });
  if (!mayChange(ctx, s, isAdmin(ctx))) return failWith(ctx.trace.traceId, "permission.denied", s.owner ? "Only the person whose computer this is can change it." : "Changing a machine of the Space needs the network permission.");
  const m = readMeta(ctx.db, s.serverId);
  if (input.nickname !== undefined) { const n = typeof input.nickname === "string" ? input.nickname.trim().slice(0, 40) : ""; m.nickname = n === "" ? null : n; }
  if (input.maxTurns !== undefined) { const v = cap(input.maxTurns, 64); if (v === undefined) return failWith(ctx.trace.traceId, "validation.bad_input", "Most turns at once is a whole number from 0 to 64, or empty for no limit.", { field: "maxTurns" }); m.maxTurns = v; }
  if (input.maxAgentComputers !== undefined) { const v = cap(input.maxAgentComputers, 64); if (v === undefined) return failWith(ctx.trace.traceId, "validation.bad_input", "Most agent computers at once is a whole number from 0 to 64, or empty for no limit.", { field: "maxAgentComputers" }); m.maxAgentComputers = v; }
  if (typeof input.drain === "boolean") m.drain = input.drain;
  writeMeta(ctx.db, s.serverId, m);
  const b = build(ctx, s, true)!;
  return { machine: b.row };
}

/** Pin an agent to a machine, or let it go: its turns then always run there and wait when it is away. */
export async function machinePin(ctx: NetworkCtx, input: { serverId: string; agentId: string; pinned: boolean }) {
  const s = servers(ctx).find((x) => x.serverId === input.serverId);
  if (!s) return failWith(ctx.trace.traceId, "validation.not_found", "That machine is not here.", { serverId: input.serverId });
  if (!mayChange(ctx, s, isAdmin(ctx))) return failWith(ctx.trace.traceId, "permission.denied", s.owner ? "Only the person whose computer this is can pin agents to it." : "Pinning an agent to a machine of the Space needs the network permission.");
  const m = readMeta(ctx.db, s.serverId);
  // an agent is pinned to one machine at a time: pinning it here lets go of the others
  if (input.pinned) for (const other of servers(ctx)) { if (other.serverId === s.serverId) continue; const om = readMeta(ctx.db, other.serverId); if (om.pins.includes(input.agentId)) { om.pins = om.pins.filter((p) => p !== input.agentId); writeMeta(ctx.db, other.serverId, om); } }
  m.pins = input.pinned ? [...new Set([...m.pins, input.agentId])].slice(0, 40) : m.pins.filter((p) => p !== input.agentId);
  writeMeta(ctx.db, s.serverId, m);
  return { machine: build(ctx, s, true)!.row };
}

async function allAlerts(ctx: NetworkCtx): Promise<MachineAlert[]> {
  const built = servers(ctx).map((s) => build(ctx, s, true)).filter((b): b is Built => b !== null);
  return alertsFor(ctx, built, null, ctx.now());
}
export async function machineAlerts(ctx: NetworkCtx, _input: In) { return { alerts: (await machines(ctx, {})).alerts }; }

/**
 * Tell the Inbox about each alert once while it lasts: the host calls this after a batch of reports. An alert that cleared is forgotten, so it can ring again.
 * The line goes to every admin through the machine.alert notification kind (modules/notifications).
 */
export async function machineAlertsNotify(ctx: NetworkCtx, _input: In) {
  if (ctx.principal.kind !== "service") return failWith(ctx.trace.traceId, "permission.denied", "Only the host sends machine alerts to the Inbox.");
  const now = await allAlerts(ctx), seen = new Set((ctx.db.all("SELECT alert_id FROM network_machine_alert") as { alert_id: string }[]).map((r) => r.alert_id));
  const fresh = now.filter((a) => !seen.has(a.alertId) && a.kind !== "update");
  for (const a of fresh) { ctx.db.run("INSERT OR REPLACE INTO network_machine_alert (alert_id, raised_at) VALUES (?, ?)", a.alertId, ctx.now()); ctx.emit("network.machine_alert", `server/${a.serverId}`, { alertId: a.alertId, serverId: a.serverId, kind: a.kind, title: a.title, detail: a.detail }); }
  const live = new Set(now.map((a) => a.alertId));
  for (const id of seen) if (!live.has(id)) ctx.db.run("DELETE FROM network_machine_alert WHERE alert_id = ?", id);
  return { sent: fresh.length };
}

/** Where a turn should run, given the places the person wants it tried in order (server ids). Reads the same room score the list shows. */
export function placeFor(ctx: NetworkCtx, order: readonly string[]): Placement {
  const all = servers(ctx);
  const cands: Candidate[] = [];
  for (const id of order) {
    const s = all.find((x) => x.serverId === id); if (!s) continue;
    const b = build(ctx, s, true); if (!b) continue;
    cands.push({ serverId: id, name: b.row.nickname ?? b.row.name, room: b.row.room as Candidate["room"], turns: b.row.runs.turns, maxTurns: b.row.limits.maxTurns });
  }
  return place(cands);
}
export async function machinePlace(ctx: NetworkCtx, input: { order: string[] }) {
  const p = placeFor(ctx, input.order);
  return { serverId: p.chosen?.serverId ?? null, name: p.chosen?.name ?? null, skipped: p.skipped, moved: p.skipped.length > 0 && p.chosen !== null, line: p.chosen && p.skipped.length ? `Moved from ${p.skipped[0]!.name} because ${p.skipped[0]!.why}` : null };
}
