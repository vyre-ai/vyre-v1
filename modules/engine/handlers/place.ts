// Placement, the warm pool and the warm hint as capabilities (P-L2_04's logic, wrapped; no new pool or placement logic here):
//   engine.placement.decide  agent/src/placement placeTurn: host, the asker's computer, or wait.
//   engine.pool.status       the pool the session opener keeps (agent/src/pool): sessions per driver, hits and misses.
//   engine.warm              agent/src/pool warmHint through the opener: start the engine ahead of the first message; answers at once.
import { placeTurn } from "../../../agent/src/placement/index.ts";
import type { PlaceDevice, PlaceInput, PlaceServer } from "../../../agent/src/placement/index.ts";
import { BUSY_BELOW } from "../../../lib/room-left.ts";
import { relayOf } from "../relay.ts";
import { usingIn, CLI_DRIVERS } from "../node-turns.ts";
import type { ResolvedAccount, SessionSpec, ThreadKind } from "../../../agent/src/turn-engine/types.ts";
import { flagOn } from "./extra/config.ts";
import { ensure, mintEngineId, openerOf, raise } from "../projections.ts";
import { chosenFor } from "./place-pref.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
interface CallCtx extends EngineCtx { call(cap: string, input: unknown): Promise<unknown> }

// Lane l-runson (owner order of 3 Nov): a computer is online when its link to the Space is up (relayOf: the person's Vyre app linked as `device:<id>`), not when it was last seen; the one it is "using"
// is the device the person's last message in the chat came from; their servers count when connected; the Space's server runs a turn when the Space allows it (engine.space_runs, default on).
// Without a relay (an older host, a unit test) the stored last-seen time stands in, as before.
// DECISION: a device's role comes from its class. Desktop apps and daemons are daemons (they run CLI engines); phones, browsers and extensions are clients (they run none), so their private chats run on the Space.
// DECISION: a device is online when the server heard from it in the last two minutes (ONLINE_MS below).
// DECISION: until a device reports which engines it runs, every daemon device counts as running the three CLI drivers (claude_code, codex, grok).
// DECISION: engine.local_runs (Space menu: Chats run on This computer or The Space) is read for the asker; off sends new private chats to the Space when they opted in, else they wait with the line.
const KINDS = new Set<string>(["chat", "channel", "thread", "ask", "run", "helper", "console"]);
const CLI_ENGINES = ["claude_code", "codex", "grok"] as const;
/** A device counts as online when the server heard from it this recently. */
const ONLINE_MS = 120_000;

interface ThreadOut { thread: { kind: string; members?: Array<{ kind: string; id: string }>; scopeType?: string } }
interface AgentOut { agent: { hasComputer?: boolean } }
interface DevicesOut { devices: Array<{ id: string; class: string; name?: string; lastSeenAt?: number; revokedAt?: number }> }

/** The devices of the person the call acts for, as the placement rules see them: desktop apps and daemons run engines, phones, browsers and extensions do not. Online is the live link when there is a relay. */
export function devicesFrom(out: DevicesOut, now: number, person?: string): PlaceDevice[] {
  const relay = relayOf();
  const links = relay?.devices && person !== undefined ? relay.devices(person) : null;
  const rows = out.devices.filter((d) => d.revokedAt === undefined).map((d): PlaceDevice => {
    const daemon = d.class === "desktop" || d.class === "daemon";
    const link = links?.find((l) => l.deviceId === d.id);
    return {
      id: d.id, role: daemon ? "daemon" as const : "client" as const,
      online: links ? link !== undefined : d.lastSeenAt !== undefined && now - d.lastSeenAt <= ONLINE_MS,
      engines: links ? (daemon && link ? link.engines : []) : daemon ? CLI_ENGINES : [],
      ...(d.lastSeenAt !== undefined ? { lastSeen: d.lastSeenAt } : {}), ...(link?.name ?? d.name ? { name: link?.name ?? d.name } : {}),
    };
  });
  // a computer linked under a session whose device row this list does not show (a test's injected session) is still one of theirs
  for (const l of links ?? []) if (!rows.some((r) => r.id === l.deviceId)) rows.push({ id: l.deviceId, role: "daemon", online: true, engines: l.engines, ...(l.name ? { name: l.name } : {}) });
  return rows;
}

interface MyServer { serverId: string; name: string; state: string; enrollment: string }

/** The person's own approved servers, online when connected (with a relay) and not down. */
export async function serversOf(ctx: CallCtx): Promise<Array<PlaceServer & { state: string }>> {
  let list: MyServer[] = [];
  try { list = ((await ctx.call("network.my_computers", {})) as { computers?: MyServer[] }).computers ?? []; } catch { return []; }
  const relay = relayOf();
  return list.filter((x) => x.enrollment === "approved").map((x) => ({ serverId: x.serverId, name: x.name, state: x.state, online: x.state !== "down" && (relay ? relay.connected(x.serverId) : true), engines: CLI_ENGINES }));
}

/** The words under "Ran on" for a machine with no room: "it was busy, 4 of 4 turns running", "it is draining", "it is offline". */
export const busyText = (why: string): string => (why === "offline" ? "it is offline" : why === "draining" ? "it is draining" : /turns$/.test(why) ? `it was busy, ${why} running` : `it was busy, ${why}`);

/**
 * Which of the asker's machines have no room now (the Machines module's room left, under the busy line), by machine id (a computer is device:<id>, a server its id, the Space server "space"), and the machine
 * the agent is pinned to, if it is one of these. Best effort: no Machines module or no answer, and every machine has room.
 */
export async function busyOf(ctx: CallCtx, ids: readonly string[], agentId?: string): Promise<{ byId: Map<string, string>; pinnedTo?: string }> {
  const byId = new Map<string, string>();
  let out: { pinnedTo?: string; rooms?: Array<{ machineId: string; score: number; why: string }> } = {};
  try { out = (await ctx.call("machines.rooms", { ids: [...ids], ...(agentId ? { agentId } : {}) })) as typeof out; } catch { return { byId }; }
  for (const m of out.rooms ?? []) if (m.score < BUSY_BELOW) byId.set(m.machineId, busyText(m.why));
  return { byId, ...(out.pinnedTo ? { pinnedTo: out.pinnedTo } : {}) };
}

/** Whether this is a Team Space (default) and whether its own server may run members' turns (engine.space_runs, default on). */
export async function spaceOf(ctx: CallCtx): Promise<{ team: boolean; shared: boolean }> {
  let team = true;
  try { team = ((await ctx.call("spaces.matrix", {})) as { kind?: string }).kind !== "personal"; } catch { /* a Team Space */ }
  if (!team) return { team, shared: false };
  let allowed = true;
  try { allowed = ((await ctx.call("settings.get", { key: "engine.space_runs" })) as { row?: { value?: unknown } }).row?.value !== false; } catch { /* the default stands */ }
  return { team, shared: allowed };
}

/**
 * Whether this person's turns run on the machine that is asking, so that a one-shot request made for them (memory upkeep, the room digest) may run here too (owner rules: a person's work runs on their own
 * compute; every request runs on their own account). A Personal Space runs on the person's own computer, so it does. In a Team Space it does not when they have a computer linked and online that
 * runs their chats (the Space menu's "Chats run on This computer"): their turns run there, and a request made here would start an engine process on the server and spend a key it has no part in.
 */
export async function turnsRunHere(call: (cap: string, input: unknown) => Promise<unknown>, asker: string, now: number, driver?: string): Promise<boolean> {
  // an API engine's request is a few HTTP calls on the person's own key: it has no engine process to place, so it stays on the Space (node-turns.ts CLI_DRIVERS); only a CLI engine's one-shot needs their computer
  if (driver !== undefined && !CLI_DRIVERS.has(driver)) return true;
  const space = await spaceOf({ call } as unknown as CallCtx);
  if (!space.team) return true;
  let localRuns = true;
  try { localRuns = ((await call("settings.get", { key: "engine.local_runs" })) as { row?: { value?: unknown } }).row?.value !== false; } catch { /* the default stands */ }
  if (!localRuns) return true;
  let devices: DevicesOut = { devices: [] };
  try { devices = (await call("devices.mine", {})) as DevicesOut; } catch { /* none known */ }
  return !devicesFrom(devices, now, asker).some((x) => x.role === "daemon" && x.online);
}

/** The engine driver this agent runs in this thread: the one saved for it, else Claude Code. */
function engineOf(ctx: EngineCtx, threadId: string, agentId: string): string {
  ensure(ctx.db);
  const r = (ctx.db.all("SELECT engine FROM engine_agent_state WHERE thread_id = ? AND agent_id = ?", threadId, agentId) as Row[])[0];
  const e = r?.["engine"];
  return typeof e === "string" && e !== "" ? e : "claude_code";
}

export function askerOf(ctx: EngineCtx): string {
  const p = ctx.principal;
  if (p.kind === "person") return p.id;
  const f = (ctx as { actingFor?: string }).actingFor;
  if (f) return f;
  return raise(ctx, "permission.no_grant", "Only a person's turn has a place.");
}

/** A crew teammate's thread: its job row says so. */
function isCrewJob(ctx: EngineCtx, threadId: string): boolean {
  try { return ctx.db.all("SELECT 1 AS x FROM engine_crew_job WHERE thread_id = ?", threadId).length > 0; } catch { return false; }
}

/**
 * A Personal Space on several computers (lane l-multidevice): each computer holds the whole Space and is the person's own, so a chat runs on the computer it reached (own_host): the desktop app's
 * own computer, or for a phone the awake computer the relay sent it to (the relay tries the person's computers before their server). The device rows of the person's other computers are copies
 * from those computers, and their stored last-seen time says nothing about this one: only a computer with a live link here counts as one this computer could hand a turn to.
 */
export function personalDevices(team: boolean, devices: PlaceDevice[]): PlaceDevice[] {
  if (team || relayOf()?.devices) return devices;
  return devices.map((x) => ({ ...x, online: false }));
}

/** `o.automatic`: where Automatic would put the turn now, the chat's own pin set aside (the Runs-on menu's "Now: ..."). */
export async function placementDecide(ctx: CallCtx, input: { threadId: string; agentId: string; kind: "message" | "interrupt" | "wake" | "handoff" }, o: { automatic?: boolean } = {}) {
  const asker = askerOf(ctx);
  const [t, a, d] = await Promise.all([
    ctx.call("threads.get", { threadId: input.threadId }) as Promise<ThreadOut>,
    ctx.call("agents.get", { agentId: input.agentId }) as Promise<AgentOut>,
    ctx.call("devices.mine", {}) as Promise<DevicesOut>,
  ]);
  const kind = (KINDS.has(t.thread.kind) ? t.thread.kind : "chat") as ThreadKind;
  const persons = new Set((t.thread.members ?? []).filter((m) => m.kind === "person").map((m) => m.id)).size;
  const chosen = o.automatic === true ? undefined : await chosenFor(ctx, input.threadId);
  const [servers, space] = await Promise.all([serversOf(ctx), spaceOf(ctx)]);
  const current = usingIn(ctx.db, input.threadId, asker);
  // the Space menu's "Chats run on": off means new chats run on the Space instead of this computer (engine.local_runs)
  let localRuns = true;
  try { localRuns = ((await ctx.call("settings.get", { key: "engine.local_runs" })) as { row?: { value?: unknown } }).row?.value !== false; } catch { /* the default stands */ }
  const myDevices = personalDevices(space.team, devicesFrom(d, ctx.now(), asker));
  const busy = await busyOf(ctx, [...myDevices.map((x) => `device:${x.id}`), ...servers.map((x) => x.serverId), "space"], input.agentId);
  const withBusy = <T extends { busy?: boolean; busyWhy?: string }>(x: T, why: string | undefined): T => (why === undefined ? x : { ...x, busy: true, busyWhy: why });
  // the machine this agent is pinned to, if it is one of this person's own or the Space's server
  const pinId = busy.pinnedTo;
  const agentPin: PlaceInput["asker"]["agentPin"] | undefined = pinId === undefined ? undefined
    : pinId === "space" ? (space.team && space.shared ? { kind: "space", id: "space", name: "the Space server" } : undefined)
    : pinId.startsWith("device:") ? ((x) => (x ? { kind: "device" as const, id: x.id, name: x.name ?? "your computer" } : undefined))(myDevices.find((y) => `device:${y.id}` === pinId))
    : ((x) => (x ? { kind: "server" as const, id: x.serverId, name: x.name } : undefined))(servers.find((y) => y.serverId === pinId));
  const place: PlaceInput = {
    thread: { kind, persons, onSharedRecord: kind === "ask" && t.thread.scopeType === "record" && persons > 1, ...(isCrewJob(ctx, input.threadId) ? { crew: true } : {}) },
    item: { kind: input.kind === "message" ? "message" : input.kind },
    agent: { hasComputer: a.agent.hasComputer === true },
    engine: engineOf(ctx, input.threadId, input.agentId),
    asker: { devices: myDevices.map((x) => withBusy(x, busy.byId.get(`device:${x.id}`))), ...(current ? { current } : {}), servers: servers.map((x) => withBusy(x, busy.byId.get(x.serverId))), localRuns, runtimeOptIn: flagOn(ctx, asker, "runtime_opt_in"), ...(agentPin ? { agentPin } : {}), ...(chosen ? { chosen } : {}) },
    space: space.team ? { shared: space.shared, ...(busy.byId.has("space") ? { busy: true, busyWhy: busy.byId.get("space")! } : {}) } : { shared: false, hostIsAsker: true },
  };
  const p = placeTurn(place);
  return { placement: p.placement, reason: p.reason, ...(p.wakeLine ? { wakeLine: p.wakeLine } : {}), ...(p.nodeId ? { nodeId: p.nodeId } : {}), ...(p.deviceId ? { deviceId: p.deviceId } : {}), ...(p.moved ? { moved: p.moved } : {}) };
}

export function poolStatus(ctx: EngineCtx, _input: Record<string, never>) {
  const opener = openerOf();
  if (!opener) return { sessions: [], totalWarm: 0 };
  const s = opener.pool.status();
  return { sessions: s.sessions.map((d) => ({ driver: d.driver, warm: d.warm, max: d.max, hits: d.hits, misses: d.misses })), totalWarm: s.totalWarm };
}

/** The hint never waits for a key lookup or a process: it answers {warm:false} when there is nothing to warm, else {warm:true} and warms in the background. */
export async function warm(ctx: CallCtx, input: { threadId: string; agentId?: string }) {
  const opener = openerOf();
  if (!opener) return { warm: false };
  const asker = askerOf(ctx);
  void (async () => {
    try {
      const t = (await ctx.call("threads.get", { threadId: input.threadId })) as { thread: { agents: Array<{ agentId: string }> } };
      const agentId = input.agentId ?? t.thread.agents[0]?.agentId;
      if (!agentId) return;
      const acct = (await ctx.call("engine.account.resolve", { threadId: input.threadId, agentId, askerId: asker })) as { accountRef: string | null; payer: string | null; reason: string; itemId?: string };
      if (!acct.accountRef) return;
      const list = (await ctx.call("engine.accounts.list", { agentId })) as { accounts?: Array<{ ref: string; driver: string; kind: "api_key" | "subscription"; base?: string; keyless?: boolean }> };
      const row = list.accounts?.find((x) => x.ref === acct.accountRef);
      if (!row) return;
      const account = { ref: row.ref, driver: row.driver, provider: row.driver, kind: row.kind, payer: acct.payer ?? asker, reason: acct.reason, ...(acct.itemId ? { itemId: acct.itemId } : {}), ...(row.base ? { base: row.base } : {}), ...(row.keyless ? { keyless: true } : {}) } as unknown as ResolvedAccount;
      const spec: SessionSpec = { threadId: input.threadId, agent: { id: agentId, mode: "lead" }, asker, turnId: mintEngineId("t", ctx.now()), traceId: ctx.trace.traceId, account };
      opener.warm(spec);
    } catch { /* a hint that cannot be resolved is no hint */ }
  })();
  return { warm: true };
}
