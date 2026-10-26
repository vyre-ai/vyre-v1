// The bridge between chat and the turn engine (ARCH 6.1, 6.2; P-L2_23a). Chat owns the conversation; the engine runs turns. This file is the only code that moves a message from one to the other.
//
//   in   a message.received consumer opens the thread in the engine (threads.get, history back-filled from chat) and calls engine.receive for any message the engine has not seen.
//   out  the engine's reply becomes one chat post by the agent: the text the engine stored, the blocks the driver streamed, in order, labelled via.routineOwner when the turn was a routine.
//        A block-only turn, and a turn that failed, was cancelled or parked on an approval, post blocks only (the engine stores no message for them).
//
// One source of truth: chat_message holds the conversation. engine_messages is a mirror keyed by the SAME id (a person's message is stored under the id chat gave it, an agent reply is posted
// to chat with the id the engine gave it as clientId), written only by the engine's own store, so the two cannot drift (a later edit is copied by the same consumer).
// No echo: a message.received for a message the engine already holds, or one the bridge posted itself (id prefix BRIDGE_PREFIX), is never fed back to engine.receive.
import { sqlMessages, withMessageId, mintId } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { DriverEvent, EngineAgent, EngineEvent, EngineSession, OpenSession, ThreadKind, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import type { RouteMention } from "../../../lib/route.ts";

/** Messages the bridge posts on its own (blocks only) carry this id prefix, so a consumer sees them as ours without a lookup. */
export const BRIDGE_PREFIX = "msg_brg";
const HISTORY = 50;
const brgId = (): string => BRIDGE_PREFIX + mintId("b").slice(2);

export interface PostBlock { type: string; v: number; data: unknown }
export interface AgentPost {
  threadId: string; body: string; blocks: PostBlock[]; mentions: RouteMention[]; clientId: string;
  via?: { routineOwner: string };
}
/** Run chat.post as the agent (the host seam builds the call with the agent as principal; a person's ctx cannot speak for an agent). */
export type PostAs = (agentId: string, post: AgentPost) => Promise<unknown>;

export interface BridgeOptions {
  postAs: PostAs;
  log?: { warn(msg: string, attrs?: Record<string, unknown>): void };
  now?: () => number;
}

export interface BridgeEvent { name: string; subject?: string; payload: Record<string, unknown> }

export interface Bridge {
  /** Connect the engine built after the bridge (the engine needs `tap` for its openSession, the bridge needs the engine). */
  attach(engine: TurnEngine): () => void;
  /** Wrap the engine's openSession so the blocks a driver streams reach the chat post. */
  tap(open: OpenSession): OpenSession;
  /** message.received / message.edited from the event log. */
  onEvent(ctx: EngineCtx, event: BridgeEvent): Promise<{ skipped?: string; receivedAs?: string[] }>;
  /** Resolves when every chat post queued so far is done (tests, shutdown). */
  flush(): Promise<void>;
}

interface Segment { blocks: PostBlock[]; text: string; mentions: number }
interface Ready { blocks: PostBlock[]; text: string; mentions: number; routineOwner: string | null }

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function createBridge(o: BridgeOptions): Bridge {
  let engine: TurnEngine | null = null;
  const opened = new Set<string>();
  const live = new Map<string, Segment>();              // turnId -> what the driver streamed so far
  const ready = new Map<string, Ready>();                // `${thread}:${agent}` -> a completed turn waiting for the engine to store its reply
  const queuedRoutine = new Map<string, boolean>();      // `${thread}:${qseq}` -> routine
  const turns = new Map<string, { routineOwner: string | null }>();
  const chains = new Map<string, Promise<void>>();       // per thread: posts go out one after another, in the order the events arrived
  const warn = (msg: string, attrs?: Record<string, unknown>): void => o.log?.warn(msg, attrs);

  const enqueuePost = (threadId: string, agentId: string, post: AgentPost): void => {
    const prev = chains.get(threadId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try { await o.postAs(agentId, post); } catch (e) { warn("the bridge could not post an agent reply", { threadId, agentId, error: e instanceof Error ? e.message : String(e) }); }
    });
    chains.set(threadId, next);
  };

  type Ended = Extract<EngineEvent, { type: "turn.failed" | "turn.cancelled" }> | Extract<EngineEvent, { type: "turn.waiting"; reason: "approval" }>;
  const status = (e: Ended): PostBlock => {
    if (e.type === "turn.waiting") return { type: "turn_status", v: 1, data: { state: "waiting", turnId: e.turnId, taskId: e.taskId } };
    if (e.type === "turn.failed") return { type: "turn_status", v: 1, data: { state: "failed", turnId: e.turnId, code: e.code } };
    return { type: "turn_status", v: 1, data: { state: "cancelled", turnId: e.turnId } };
  };

  const onEngine = (e: EngineEvent): void => {
    switch (e.type) {
      case "turn.queued": queuedRoutine.set(`${e.threadId}:${e.qseq}`, e.routine); return;
      case "turn.started": {
        const routine = queuedRoutine.get(`${e.threadId}:${e.qseq}`) === true;
        queuedRoutine.delete(`${e.threadId}:${e.qseq}`);
        turns.set(e.turnId, { routineOwner: routine ? e.asker : null });
        return;
      }
      case "turn.completed": {
        const seg = live.get(e.turnId) ?? { blocks: [], text: "", mentions: 0 };
        const routineOwner = turns.get(e.turnId)?.routineOwner ?? null;
        live.delete(e.turnId); turns.delete(e.turnId);
        if (seg.text !== "" || seg.mentions > 0) {
          ready.set(`${e.threadId}:${e.agentId}`, { ...seg, routineOwner });   // the engine stores the reply right after this event; message.received below posts it
        } else if (seg.blocks.length > 0) {
          enqueuePost(e.threadId, e.agentId, { threadId: e.threadId, body: "", blocks: seg.blocks, mentions: [], clientId: brgId(), ...(routineOwner ? { via: { routineOwner } } : {}) });
        }
        return;
      }
      case "turn.failed": case "turn.cancelled": case "turn.waiting": {
        if (e.type === "turn.waiting" && e.reason !== "approval") return;
        const parked = e.type === "turn.waiting";
        const seg = live.get(e.turnId);
        const routineOwner = turns.get(e.turnId)?.routineOwner ?? null;
        if (!parked) { live.delete(e.turnId); turns.delete(e.turnId); }
        const blocks = [...(seg?.blocks ?? []), status(e)];
        enqueuePost(e.threadId, e.agentId, { threadId: e.threadId, body: seg?.text ?? "", blocks, mentions: [], clientId: brgId(), ...(routineOwner ? { via: { routineOwner } } : {}) });
        return;
      }
      case "message.received": {
        if (e.authorId.startsWith("usr_") || !engine) return;
        const r = ready.get(`${e.threadId}:${e.authorId}`);
        const msg = engine.messages(e.threadId).find((m) => m.id === e.messageId);
        if (!msg || msg.author.kind !== "agent") return;
        ready.delete(`${e.threadId}:${e.authorId}`);
        enqueuePost(e.threadId, e.authorId, {
          threadId: e.threadId, body: msg.body, blocks: r?.blocks ?? [], mentions: [...msg.mentions], clientId: msg.id, ...(r?.routineOwner ? { via: { routineOwner: r.routineOwner } } : {}),
        });
        return;
      }
      default: return;
    }
  };

  function wrap(s: EngineSession): EngineSession {
    const send = (input: TurnInput): AsyncIterable<DriverEvent> => (async function* () {
      const seg: Segment = { blocks: [], text: "", mentions: 0 };
      live.set(input.turnId, seg);
      for await (const ev of s.send(input)) {
        if (ev.type === "text") seg.text += ev.text;
        else if (ev.type === "block") seg.blocks.push({ type: ev.kind, v: 1, data: ev.payload ?? {} });
        else if (ev.type === "done") seg.mentions = ev.mentions?.length ?? 0;
        yield ev;
      }
    })();
    return new Proxy(s, {
      get(target, prop) {
        if (prop === "send") return send;
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  type ThreadGet = { thread: { kind?: string; starter?: string; agents: Array<{ agentId: string; mode: "lead" | "listen"; model?: string; accountRef?: string; watches?: unknown }> } };
  type Row = { messageId: string; threadSeq?: number; author: { kind: string; id: string }; body: string; depth?: number };

  async function open(ctx: EngineCtx, threadId: string, skipId: string): Promise<boolean> {
    if (!engine) return false;
    if (opened.has(threadId)) return true;
    let got: ThreadGet;
    try { got = (await ctx.call("threads.get", { threadId })) as ThreadGet; } catch (e) {
      // not "no agents": the thread could not be read at all (a private chat the calling principal is not in, a thread that is gone). Say so, with the trace, instead of skipping in silence.
      warn("the bridge could not read the thread, so no turn runs for its message", { traceId: ctx.trace.traceId, threadId, code: (e as { error?: { code?: string } })?.error?.code ?? "unknown", error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    if (got.thread.agents.length === 0) return false;   // nobody to run; the thread opens on the first message after an agent joins
    const agents: EngineAgent[] = got.thread.agents.map((a) => ({
      id: a.agentId, mode: a.mode, ...(a.model ? { model: a.model } : {}), ...(a.accountRef ? { accountRef: a.accountRef } : {}), ...(a.watches !== undefined ? { watching: true } : {}),
    }));
    const store = sqlMessages(ctx.db, ctx.now);
    if (store.recent(threadId, 1).length === 0) {
      // First time this host sees the thread: copy the window the agent will read as history, oldest first, under chat's own ids.
      const list = (await ctx.call("chat.messages.list", { threadId, limit: HISTORY })) as { messages: Row[] };
      for (const r of [...list.messages].sort((a, b) => (a.threadSeq ?? 0) - (b.threadSeq ?? 0))) {
        if (r.messageId === skipId || store.get(r.messageId)) continue;
        withMessageId(r.messageId, () => store.append({ id: r.messageId, threadId, author: { kind: r.author.id.startsWith("agt_") ? "agent" : "person", id: r.author.id }, mentions: [], depth: r.depth ?? 0, body: r.body }));
      }
    }
    try {
      engine.openThread({ id: threadId, kind: (got.thread.kind ?? "chat") as ThreadKind, starter: got.thread.starter ?? "", agents });
    } catch (e) {
      if (!(e instanceof RangeError) || !/already open/.test(e.message)) throw e;
    }
    opened.add(threadId);
    return true;
  }

  async function onReceived(ctx: EngineCtx, p: Record<string, unknown>): Promise<{ skipped?: string; receivedAs?: string[] }> {
    const messageId = str(p["messageId"]), threadId = str(p["threadId"]);
    if (!engine) return { skipped: "engine_not_running" };
    if (messageId === "" || threadId === "") return { skipped: "no_ids" };
    if (messageId.startsWith(BRIDGE_PREFIX)) return { skipped: "own_post" };
    const store = sqlMessages(ctx.db, ctx.now);
    if (store.get(messageId)) return { skipped: "known" };            // the engine stored it: its own reply echoing back, or a replay
    if (!(await open(ctx, threadId, messageId))) return { skipped: "no_agents" };
    if (store.get(messageId)) return { skipped: "known" };
    const got = (await ctx.call("chat.message.get", { threadId, messageId })) as { message: Row };
    const a = (p["author"] ?? {}) as { kind?: string; id?: string };
    const authorId = str(a.id) || got.message.author.id;
    const mentions = ((p["mentions"] ?? []) as RouteMention[]).map((m) => ({ kind: m.kind, id: m.id }));
    const eng = engine;
    const res = withMessageId(messageId, () => eng.receive({
      threadId, author: { kind: a.kind === "agent" ? "agent" : "person", id: authorId }, mentions, depth: Number(p["depth"] ?? 0), body: got.message.body,
    }));
    return { receivedAs: res.responders };
  }

  async function onEdited(ctx: EngineCtx, p: Record<string, unknown>): Promise<{ skipped?: string; receivedAs?: string[] }> {
    const messageId = str(p["messageId"]), threadId = str(p["threadId"]);
    if (!sqlMessages(ctx.db, ctx.now).get(messageId)) return { skipped: "unknown" };
    const got = (await ctx.call("chat.message.get", { threadId, messageId })) as { message: Row };
    ctx.db.run("UPDATE engine_messages SET body = ? WHERE id = ?", got.message.body, messageId);
    return {};
  }

  return {
    attach(e) {
      engine = e;
      return e.subscribe(onEngine);
    },
    tap: (openSession) => async (spec) => wrap(await openSession(spec)),
    onEvent: (ctx, event) => (event.name === "message.edited" ? onEdited(ctx, event.payload) : onReceived(ctx, event.payload)),
    async flush() {
      let snap: Array<Promise<void>>;
      do { snap = [...chains.values()]; await Promise.all(snap); } while (snap.length !== chains.size || [...chains.values()].some((p, i) => p !== snap[i]));
    },
  };
}

// The bridge that runs on this host, bound at boot like the engine (projections.bindEngine).
let bound: Bridge | null = null;
export function bindBridge(b: Bridge | null): void { bound = b; }

/** The consumer the engine module exports from impl.ts. A host without a running engine skips the event (nothing reads it later; the chat itself is untouched). */
export const bridgeConsumers = {
  "engine.bridge": {
    on: ["message.received", "message.edited"],
    run: async (ctx: EngineCtx, event: BridgeEvent): Promise<{ skipped?: string; receivedAs?: string[] }> => (bound ? bound.onEvent(ctx, event) : { skipped: "engine_not_running" }),
  },
};
