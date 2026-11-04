// Where a chat runs, chosen by the person (the "runs on" chip in a chat header). The choice is kept on the thread: this computer, the Space, or one of the person's own servers. It is read by
// engine.placement.decide, so the next turn goes there. A person's turns never run on a teammate's machine: a server must be one the asker added, and the Space is offered only in a Team Space.
// engine.placement.options lists what the chip can offer, with the reason an offline target is grey.
// Lane l-runson: "This computer" names a computer (the one the person is choosing from, else their most recent desktop); its device id is kept in the pin's server_id column. Every option's
// on/off is the live link (relay.ts), so the menu never says a computer is on when the Space cannot reach it, and `effective` is what engine.placement.decide answers for the next turn.
// engine.placement.set { once: true } is "Run it on the server instead": the next turn runs on the Space once, and a turn already waiting for the computer goes on there.
import { isPrivate } from "../../../agent/src/placement/index.ts";
import { ensure, raise } from "../projections.ts";
import { relayOf } from "../relay.ts";
import type { Db, EngineCtx } from "../projections.ts";
import { askerOf, devicesFrom, placementDecide, serversOf, spaceOf } from "./place.ts";
import { setOnce } from "../node-turns.ts";
import { engineIfBound } from "../projections.ts";
import { forgetPlacement } from "../placement-cache.ts";

interface CallCtx extends EngineCtx { call(cap: string, input: unknown): Promise<unknown> }
type Row = Record<string, unknown>;
export type Target = "device" | "space" | "server";
export interface Chosen { target: Target; serverId?: string; deviceId?: string; online?: boolean; name?: string }

const KINDS = new Set<string>(["chat", "channel", "thread", "ask", "run", "helper", "console"]);

const PLACE_SCHEMA = "CREATE TABLE IF NOT EXISTS engine_thread_place (thread_id TEXT PRIMARY KEY, target TEXT NOT NULL, server_id TEXT, by_principal TEXT NOT NULL, updated_at INTEGER NOT NULL)";
const ready = new WeakSet<object>();
function ensurePlace(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  db.run(PLACE_SCHEMA);
  ready.add(db);
}

interface MyServer { serverId: string; name: string; state: string; enrollment: string }

async function myServers(ctx: CallCtx): Promise<MyServer[]> {
  try { return ((await ctx.call("network.my_computers", {})) as { computers?: MyServer[] }).computers ?? []; } catch { return []; }
}

async function isTeam(ctx: CallCtx): Promise<boolean> {
  try { return ((await ctx.call("spaces.matrix", {})) as { kind?: string }).kind !== "personal"; } catch { return true; }
}

/** The person's pin for this thread, with what the Space knows of a server it names; undefined when nothing is pinned or the server is gone (the rules then apply as if nothing was pinned). */
export async function chosenFor(ctx: CallCtx, threadId: string): Promise<Chosen | undefined> {
  ensurePlace(ctx.db);
  const r = (ctx.db.all("SELECT target, server_id FROM engine_thread_place WHERE thread_id = ?", threadId) as Row[])[0];
  if (!r) return undefined;
  const target = String(r["target"]) as Target;
  if (target === "device") return typeof r["server_id"] === "string" && r["server_id"] !== "" ? { target, deviceId: r["server_id"] } : { target };
  if (target !== "server") return { target };
  const id = r["server_id"] === null || r["server_id"] === undefined ? undefined : String(r["server_id"]);
  const s = id === undefined ? undefined : (await myServers(ctx)).find((x) => x.serverId === id && x.enrollment === "approved");
  if (!s) return undefined;
  const relay = relayOf();
  return { target, serverId: s.serverId, online: s.state !== "down" && (relay ? relay.connected(s.serverId) : true), name: s.name };
}

interface ThreadOut { thread: { kind: string; members?: Array<{ kind: string; id: string }>; scopeType?: string } }
interface DevicesOut { devices: Array<{ id: string; class: string; lastSeenAt?: number; revokedAt?: number }> }

async function privateThread(ctx: CallCtx, threadId: string): Promise<boolean> {
  const t = (await ctx.call("threads.get", { threadId })) as ThreadOut;
  const kind = (KINDS.has(t.thread.kind) ? t.thread.kind : "chat") as "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
  const persons = new Set((t.thread.members ?? []).filter((m) => m.kind === "person").map((m) => m.id)).size;
  return isPrivate({ kind: kind as never, persons, onSharedRecord: kind === "ask" && t.thread.scopeType === "record" && persons > 1 });
}


export async function placementSet(ctx: CallCtx, input: { threadId: string; target: Target | "auto"; serverId?: string; deviceId?: string; once?: boolean }): Promise<{ target: Target | "auto"; serverId?: string; deviceId?: string }> {
  ensurePlace(ctx.db);
  forgetPlacement(input.threadId);   // the kept placement words of this chat are stale from here
  const asker = askerOf(ctx);
  // "Run it on the server instead": this once, on the Space; the chat's own choice stays. A turn waiting for the computer is started again so it goes now.
  if (input.once === true) {
    if (input.target !== "space") raise(ctx, "validation.bad_input", "Only the Space's server can run a chat once.", { target: input.target });
    if (!(await isTeam(ctx))) raise(ctx, "validation.bad_input", "This Space is your computer.", { target: input.target });
    await ctx.call("threads.get", { threadId: input.threadId });   // the person can read the chat
    setOnce(ctx.db, input.threadId, asker, ctx.now());
    try { engineIfBound()?.kick(input.threadId); } catch { /* not open on this host: the next message opens it */ }
    return { target: "space" };
  }
  if (!(await privateThread(ctx, input.threadId))) raise(ctx, "validation.precondition_failed", "Only a private chat chooses where it runs.", { threadId: input.threadId });
  // Automatic is no place: the pin goes, and the rules decide the next turn
  if (input.target === "auto") { ctx.db.run("DELETE FROM engine_thread_place WHERE thread_id = ?", input.threadId); return { target: "auto" }; }
  if (input.target === "server") {
    const s = input.serverId === undefined ? undefined : (await myServers(ctx)).find((x) => x.serverId === input.serverId && x.enrollment === "approved");
    if (!s) raise(ctx, "permission.no_grant", "That is not one of your servers. A chat runs only on your own computers.", { serverId: input.serverId ?? null });
  } else if (input.target === "space") {
    if (!(await isTeam(ctx))) raise(ctx, "validation.bad_input", "This Space is your computer.", { target: input.target });
  }
  let deviceId: string | null = null;
  if (input.target === "device") {
    // a computer of the asker's: the one named, else the one they are choosing from, else their most recent desktop; never anyone else's
    const mine = ((await ctx.call("devices.mine", {})) as DevicesOut).devices.filter((x) => x.revokedAt === undefined && (x.class === "desktop" || x.class === "daemon"));
    const linked = relayOf()?.devices?.(asker) ?? [];
    const own = (id: string | undefined): boolean => id !== undefined && (mine.some((x) => x.id === id) || linked.some((l) => l.deviceId === id));
    if (input.deviceId !== undefined && !own(input.deviceId)) raise(ctx, "permission.no_grant", "That is not one of your computers. A chat runs only on your own computers.", { deviceId: input.deviceId });
    const here = (ctx as { device?: string }).device;
    deviceId = input.deviceId ?? (own(here) ? here! : [...mine].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0]?.id ?? linked[0]?.deviceId ?? null);
    if (deviceId === null) raise(ctx, "validation.precondition_failed", "No Vyre app on a computer of yours is signed in.", { target: input.target });
  }
  const machine = input.target === "server" ? input.serverId! : deviceId;
  ctx.db.run("DELETE FROM engine_thread_place WHERE thread_id = ?", input.threadId);
  ctx.db.run("INSERT INTO engine_thread_place (thread_id, target, server_id, by_principal, updated_at) VALUES (?, ?, ?, ?, ?)", input.threadId, input.target, machine, asker, ctx.now());
  // a turn that was waiting for a computer may run now (a different computer, the Space, a server)
  try { engineIfBound()?.kick(input.threadId); } catch { /* not open here */ }
  return { target: input.target, ...(input.target === "server" ? { serverId: machine! } : {}), ...(deviceId ? { deviceId } : {}) };
}

export interface Option { target: Target; serverId?: string; deviceId?: string; current?: boolean; name: string; online: boolean; reason?: string }

/**
 * The chip's options, each with its real state: the person's computers ("This computer" for the one they are choosing from, the others by name), on when their link to the Space is up; the Space
 * in a Team Space; each of their servers, on when connected. `effective` is where the next turn goes, from the same decide the engine asks.
 */
type Where = { target: Target; serverId?: string; deviceId?: string };
const whereOf = (dec: { placement?: string; nodeId?: string; deviceId?: string } | null, team: boolean): Where =>
  dec?.placement === "device" ? { target: "device", ...(dec.deviceId ? { deviceId: dec.deviceId } : {}) } : dec?.nodeId ? { target: "server", serverId: dec.nodeId } : dec?.placement === "host" || !team ? { target: team ? "space" : "device" } : { target: "device" };

export async function placementOptions(ctx: CallCtx, input: { threadId: string; agentId?: string }): Promise<{ private: boolean; pinned: boolean; effective: Where; automatic?: Where; options: Option[] }> {
  ensurePlace(ctx.db);
  const asker = askerOf(ctx);
  const priv = await privateThread(ctx, input.threadId);
  const here = (ctx as { device?: string }).device;
  const computers = devicesFrom((await ctx.call("devices.mine", {})) as DevicesOut, ctx.now(), asker).filter((x) => x.role === "daemon");
  const options: Option[] = [];
  const thisOne = computers.find((x) => x.id === here);
  // the computer the person is on comes first and is "This computer"; on a phone or in a browser there is none, and their computers follow by name
  if (thisOne) options.push({ target: "device", deviceId: thisOne.id, current: true, name: "This computer", online: thisOne.online && thisOne.engines.length > 0, ...(thisOne.online && thisOne.engines.length > 0 ? {} : { reason: thisOne.online ? "Cannot run AI tools" : "Off" }) });
  for (const c of computers.filter((x) => x.id !== here).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))) {
    const on = c.online && c.engines.length > 0;
    options.push({ target: "device", deviceId: c.id, name: c.name ?? "Your computer", online: on, ...(on ? {} : { reason: c.online ? "Cannot run AI tools" : "Off" }) });
  }
  if (computers.length === 0) options.push({ target: "device", name: "This computer", online: false, reason: "No Vyre app" });
  const space = await spaceOf(ctx);
  if (space.team) options.push({ target: "space", name: "The Space", online: space.shared, ...(space.shared ? {} : { reason: "Not allowed" }) });
  for (const s of await serversOf(ctx)) options.push({ target: "server", serverId: s.serverId, name: s.name, online: s.online, ...(s.online ? {} : { reason: "Off" }) });
  const pin = await chosenFor(ctx, input.threadId);
  // where Automatic would put the next turn now, from the same order the engine uses, the pin set aside: the menu's Automatic row says it ("Now: Office iMac")
  const auto = priv && input.agentId !== undefined ? whereOf((await placementDecide(ctx, { threadId: input.threadId, agentId: input.agentId, kind: "message" }, { automatic: true }).catch(() => null)) as { placement?: string; nodeId?: string; deviceId?: string } | null, space.team) : undefined;
  let effective: Where;
  if (!priv) effective = { target: "space" };
  else if (pin) effective = { target: pin.target, ...(pin.serverId ? { serverId: pin.serverId } : {}), ...(pin.deviceId ? { deviceId: pin.deviceId } : {}) };
  else effective = auto ?? { target: "device" };
  return { private: priv, pinned: priv && pin !== undefined, effective, ...(auto ? { automatic: auto } : {}), options };
}
