// Where a chat runs, chosen by the person (the "runs on" chip in a chat header). The choice is kept on the thread: this computer, the Space, or one of the person's own servers. It is read by
// engine.placement.decide, so the next turn goes there. A person's turns never run on a teammate's machine: a server must be one the asker added, and the Space is offered only in a Team Space.
// engine.placement.options lists what the chip can offer, with the reason an offline target is grey.
import { isPrivate } from "../../../agent/src/placement/index.ts";
import { ensure, raise } from "../projections.ts";
import type { Db, EngineCtx } from "../projections.ts";
import { askerOf } from "./place.ts";

interface CallCtx extends EngineCtx { call(cap: string, input: unknown): Promise<unknown> }
type Row = Record<string, unknown>;
export type Target = "device" | "space" | "server";
export interface Chosen { target: Target; serverId?: string; online?: boolean; name?: string }

const ONLINE_MS = 120_000;
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
  if (target !== "server") return { target };
  const id = r["server_id"] === null || r["server_id"] === undefined ? undefined : String(r["server_id"]);
  const s = id === undefined ? undefined : (await myServers(ctx)).find((x) => x.serverId === id && x.enrollment === "approved");
  if (!s) return undefined;
  return { target, serverId: s.serverId, online: s.state !== "down", name: s.name };
}

interface ThreadOut { thread: { kind: string; members?: Array<{ kind: string; id: string }>; scopeType?: string } }
interface DevicesOut { devices: Array<{ id: string; class: string; lastSeenAt?: number; revokedAt?: number }> }

async function privateThread(ctx: CallCtx, threadId: string): Promise<boolean> {
  const t = (await ctx.call("threads.get", { threadId })) as ThreadOut;
  const kind = (KINDS.has(t.thread.kind) ? t.thread.kind : "chat") as "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
  const persons = new Set((t.thread.members ?? []).filter((m) => m.kind === "person").map((m) => m.id)).size;
  return isPrivate({ kind: kind as never, persons, onSharedRecord: kind === "ask" && t.thread.scopeType === "record" && persons > 1 });
}

async function daemons(ctx: CallCtx): Promise<{ any: boolean; online: boolean }> {
  const d = (await ctx.call("devices.mine", {})) as DevicesOut;
  const mine = d.devices.filter((x) => x.revokedAt === undefined && (x.class === "desktop" || x.class === "daemon"));
  return { any: mine.length > 0, online: mine.some((x) => x.lastSeenAt !== undefined && ctx.now() - x.lastSeenAt <= ONLINE_MS) };
}

export async function placementSet(ctx: CallCtx, input: { threadId: string; target: Target; serverId?: string }): Promise<{ target: Target; serverId?: string }> {
  ensurePlace(ctx.db);
  const asker = askerOf(ctx);
  if (!(await privateThread(ctx, input.threadId))) raise(ctx, "validation.precondition_failed", "Only a private chat chooses where it runs.", { threadId: input.threadId });
  if (input.target === "server") {
    const s = input.serverId === undefined ? undefined : (await myServers(ctx)).find((x) => x.serverId === input.serverId && x.enrollment === "approved");
    if (!s) raise(ctx, "permission.no_grant", "That is not one of your servers. A chat runs only on your own computers.", { serverId: input.serverId ?? null });
  } else if (input.target === "space") {
    if (!(await isTeam(ctx))) raise(ctx, "validation.bad_input", "This Space is your computer.", { target: input.target });
  } else if (!(await daemons(ctx)).any) {
    raise(ctx, "validation.precondition_failed", "No Vyre app on a computer of yours is signed in.", { target: input.target });
  }
  const server = input.target === "server" ? input.serverId! : null;
  ctx.db.run("DELETE FROM engine_thread_place WHERE thread_id = ?", input.threadId);
  ctx.db.run("INSERT INTO engine_thread_place (thread_id, target, server_id, by_principal, updated_at) VALUES (?, ?, ?, ?, ?)", input.threadId, input.target, server, asker, ctx.now());
  return { target: input.target, ...(server ? { serverId: server } : {}) };
}

export interface Option { target: Target; serverId?: string; name: string; online: boolean; reason?: string }

export async function placementOptions(ctx: CallCtx, input: { threadId: string; agentId?: string }): Promise<{ private: boolean; effective: { target: Target; serverId?: string }; options: Option[] }> {
  ensurePlace(ctx.db);
  askerOf(ctx);
  const priv = await privateThread(ctx, input.threadId);
  const d = await daemons(ctx);
  const options: Option[] = [{ target: "device", name: "This computer", online: d.online, ...(d.online ? {} : { reason: d.any ? "Off" : "No Vyre app" }) }];
  if (await isTeam(ctx)) options.push({ target: "space", name: "The Space", online: true });
  for (const s of await myServers(ctx)) {
    if (s.enrollment !== "approved") continue;
    options.push({ target: "server", serverId: s.serverId, name: s.name, online: s.state !== "down", ...(s.state !== "down" ? {} : { reason: "Off" }) });
  }
  const pin = await chosenFor(ctx, input.threadId);
  let effective: { target: Target; serverId?: string };
  if (!priv) effective = { target: "space" };
  else if (pin) effective = { target: pin.target, ...(pin.serverId ? { serverId: pin.serverId } : {}) };
  else {
    const dec = input.agentId === undefined ? null : (await ctx.call("engine.placement.decide", { threadId: input.threadId, agentId: input.agentId, kind: "message" }).catch(() => null)) as { placement?: string } | null;
    effective = { target: dec?.placement === "host" ? "space" : "device" };
  }
  return { private: priv, effective, options };
}
