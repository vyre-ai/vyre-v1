// The bridge between chat and the turn engine (ARCH 6.1, 6.2; P-L2_23a). Chat owns the conversation; the engine runs turns. This file is the only code that moves a message from one to the other.
//
//   in   a message.received consumer opens the thread in the engine (threads.get, history back-filled from chat) and calls engine.receive for any message the engine has not seen.
//   out  the engine's reply becomes one chat post by the agent: the text the engine stored, the blocks the driver streamed, in order, labelled via.routineOwner when the turn was a routine.
//        A block-only turn, and a turn that failed, was cancelled or parked on an approval, post blocks only (the engine stores no message for them).
//
// One source of truth: chat_message holds the conversation. engine_messages is a mirror keyed by the SAME id (a person's message is stored under the id chat gave it, an agent reply is posted
// to chat with the id the engine gave it as clientId), written only by the engine's own store, so the two cannot drift (a later edit is copied by the same consumer).
// No echo: a message.received for a message the engine already holds, or one the bridge posted itself (id prefix BRIDGE_PREFIX), is never fed back to engine.receive.
import { redact } from "../../../agent/src/transcript/sanitize.ts";
import { workBlocks } from "../../../agent/src/tools/work-cards.ts";
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
  /** the person whose turn this is; the agent posts for them */
  actingFor?: string;
  threadId: string; body: string; blocks: PostBlock[]; mentions: RouteMention[]; clientId: string;
  via?: { routineOwner: string };
}
/** Run chat.post as the agent (the host seam builds the call with the agent as principal; a person's ctx cannot speak for an agent). */
export type PostAs = (agentId: string, post: AgentPost) => Promise<unknown>;

/** Run a capability for a person through the real pipeline, so what a turn reads is what that person may read (the host builds the call; spec 6.3). */
export type CallAs = (cap: string, input: unknown, personId: string) => Promise<unknown>;

/** What a reader of a live turn is told (the host turns each into one `turn` frame to the people who may read the thread): the turn opened, a piece of its text, the turn ended, and which chat message the finished turn became. */
export type StreamEvent =
  | { kind: "start"; threadId: string; turnId: string; agentId: string; asker: string; /** the message that started the turn, so a screen puts the reply after it and before what is sent meanwhile */ triggerId?: string }
  | { kind: "delta"; threadId: string; turnId: string; agentId: string; text: string; /** characters of the turn before this piece, so a reader who also fetched the text so far never doubles or drops a piece */ at: number }
  /** A step of the turn (a tool call or its result): what the agent is doing, for the line under its reply. Names only; no input. */
  | { kind: "step"; threadId: string; turnId: string; agentId: string; phase: "call" | "result" | "input"; id: string; name?: string; ok?: boolean; /** what the call touches, in safe words (a file name, a query): for the live line only */ detail?: string }
  /** A piece of the thinking the provider sent. It goes only to the people who may read the thread, over the live link; it is never logged and never saved. */
  | { kind: "thinking"; threadId: string; turnId: string; agentId: string; text: string }
  | { kind: "end"; threadId: string; turnId: string; agentId: string; state: "done" | "failed" | "cancelled" | "waiting"; /** why a failed turn failed; host_lost means the server stopped under it */ code?: string }
  | { kind: "final"; threadId: string; turnId: string; agentId: string; messageId: string | null };

export interface BridgeOptions {
  postAs: PostAs;
  /** Live turn events for the host to fan out over the live socket. A throw here never touches the turn. */
  stream?: (e: StreamEvent) => void;
  /** Reads of the chat run as the person whose message started the turn. A private chat answers only to its members, so the host's system principal cannot read it. Without it the consumer's own ctx reads. */
  callAs?: CallAs;
  log?: { warn(msg: string, attrs?: Record<string, unknown>): void };
  now?: () => number;
  /** An agent whose reply is addressed to the person whose turn it was (an @mention), so it reaches them and no agent answers it: a reviewer's verdict. */
  addressAsker?: (threadId: string, agentId: string) => boolean;
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
  /** The turns being written in a thread right now, with the text so far (a chat opened or reconnected mid-turn). */
  liveTurns(threadId: string): Array<{ turnId: string; agentId: string; text: string }>;
}

interface Segment { blocks: PostBlock[]; text: string; mentions: number; t0?: number; calls?: Map<string, { name: string; at: number }> }
interface Ready { blocks: PostBlock[]; text: string; mentions: number; routineOwner: string | null; turnId: string }

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** An engine error can echo a key or a token. It goes to the log only: it passes the shared credential redactor (agent/src/transcript/sanitize.ts, the same rules as every transcript) and is cut to 300 characters. The key is `why`: the sink drops a key named message. */
export const scrub = (text: string): string => redact(text.slice(0, 600)).text.slice(0, 300);

/** A message carries at most this many blocks (modules/chat/projections.ts MAX_BLOCKS); the bridge keeps to it so a long turn's reply is never refused. */
const MAX_POST_BLOCKS = 20;
const STEP_BLOCKS: ReadonlySet<string> = new Set(["tool_call", "tool_result"]);

/**
 * The blocks of one reply, fitted under the limit without losing anything a person reads. Tool steps (a call and its result) are bookkeeping: past the limit they fold into one "tool_steps" block that
 * counts them, leading the message. Every other block (a card, a file, a question) is kept; if those alone are over the limit the rest go in follow-up messages, in order. Text is never touched.
 */
export function fitBlocks(blocks: readonly PostBlock[]): PostBlock[][] {
  if (blocks.length <= MAX_POST_BLOCKS) return [[...blocks]];
  const steps = blocks.filter((b) => STEP_BLOCKS.has(b.type));
  const keep = blocks.filter((b) => !STEP_BLOCKS.has(b.type));
  const failed = steps.filter((b) => b.type === "tool_result" && (b.data as { ok?: unknown } | null)?.ok === false).length;
  const summary: PostBlock = { type: "tool_steps", v: 1, data: { calls: steps.filter((b) => b.type === "tool_call").length, results: steps.filter((b) => b.type === "tool_result").length, failed } };
  const all = steps.length > 0 ? [summary, ...keep] : keep;
  const out: PostBlock[][] = [];
  for (let i = 0; i < all.length; i += MAX_POST_BLOCKS) out.push(all.slice(i, i + MAX_POST_BLOCKS));
  return out;
}

export function createBridge(o: BridgeOptions): Bridge {
  let engine: TurnEngine | null = null;
  const opened = new Set<string>();
  const writing = new Map<string, { threadId: string; agentId: string }>();   // turnId -> a turn that has started and not ended
  const live = new Map<string, Segment>();              // turnId -> what the driver streamed so far
  const ready = new Map<string, Ready>();                // `${thread}:${agent}` -> a completed turn waiting for the engine to store its reply
  const queuedRoutine = new Map<string, boolean>();      // `${thread}:${qseq}` -> routine
  const turns = new Map<string, { routineOwner: string | null }>();
  const emit = (e: StreamEvent): void => { try { o.stream?.(e); } catch { /* a live view must never fail a turn */ } };
  const askerOf = new Map<string, string>();               // threadId -> the person whose turn ran last: the agent speaks for them
  const chains = new Map<string, Promise<void>>();       // per thread: posts go out one after another, in the order the events arrived
  const warn = (msg: string, attrs?: Record<string, unknown>): void => o.log?.warn(msg, attrs);

  const askerMention = (threadId: string, agentId: string): AgentPost["mentions"] => {
    const who = askerOf.get(threadId);
    return who && o.addressAsker?.(threadId, agentId) ? [{ kind: "person", id: who }] : [];
  };

  const enqueuePost = (threadId: string, agentId: string, post: AgentPost, turnId?: string): void => {
    const prev = chains.get(threadId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const asker = askerOf.get(threadId);
      const as = (p: AgentPost): AgentPost => (asker ? { ...p, actingFor: asker } : p);
      let posted = false;
      const [first = [], ...more] = fitBlocks(post.blocks);
      try {
        await o.postAs(agentId, as({ ...post, blocks: first }));
        posted = true;
        // what did not fit goes after it, in order, as messages of their own
        for (const rest of more) await o.postAs(agentId, as({ threadId, body: "", blocks: rest, mentions: [], clientId: brgId(), ...(post.via ? { via: post.via } : {}) }));
      } catch (e) {
        warn("the bridge could not post an agent reply", { threadId, agentId, error: e instanceof Error ? e.message : String(e) });
        if (!posted) {
          // A reply must never vanish: say so in the chat with a failed turn the person can retry, and keep the words if the words were the part that could not go.
          const failure: PostBlock = { type: "turn_status", v: 1, data: { state: "failed", turnId: turnId ?? "", code: "engine.post_failed" } };
          try { await o.postAs(agentId, as({ threadId, body: post.body, blocks: [failure], mentions: post.mentions, clientId: brgId(), ...(post.via ? { via: post.via } : {}) })); }
          catch (again) {
            try { await o.postAs(agentId, as({ threadId, body: "", blocks: [failure], mentions: [], clientId: brgId() })); }
            catch (last) { warn("the bridge could not even say that a reply was lost", { threadId, agentId, error: last instanceof Error ? last.message : String(again) }); }
          }
        }
      }
      if (turnId) emit({ kind: "final", threadId, turnId, agentId, messageId: posted ? post.clientId : null });   // after the post: the row exists when the reader hears which one it is
    });
    chains.set(threadId, next);
  };

  type Ended = Extract<EngineEvent, { type: "turn.failed" | "turn.cancelled" }> | Extract<EngineEvent, { type: "turn.waiting"; reason: "approval" }>;
  const status = (e: Ended): PostBlock => {
    if (e.type === "turn.waiting") return { type: "turn_status", v: 1, data: { state: "waiting", turnId: e.turnId, taskId: e.taskId } };
    if (e.type === "turn.failed") {
      // An engine that is not installed names its program (a fixed few, never free text), so the chat can offer the exact install command.
      const program = e.code === "engine.cli_missing" ? /^(claude|codex|grok) is not installed/.exec(e.message ?? "")?.[1] : undefined;
      // A Vault that could not be read gives the code it answered with (a fixed word shape, never the text that came with it).
      const reason = e.code === "engine.vault_unreadable" ? /^The Vault could not be read \(([a-z_]+(?:\.[a-z_]+)*)\)\.$/.exec(e.message ?? "")?.[1] : undefined;
      return { type: "turn_status", v: 1, data: { state: "failed", turnId: e.turnId, code: e.code, ...(program ? { program } : {}), ...(reason ? { reason } : {}) } };
    }
    return { type: "turn_status", v: 1, data: { state: "cancelled", turnId: e.turnId } };
  };

  const onEngine = (e: EngineEvent): void => {
    switch (e.type) {
      case "turn.queued": queuedRoutine.set(`${e.threadId}:${e.qseq}`, e.routine); return;
      case "turn.started": {
        const routine = queuedRoutine.get(`${e.threadId}:${e.qseq}`) === true;
        queuedRoutine.delete(`${e.threadId}:${e.qseq}`);
        turns.set(e.turnId, { routineOwner: routine ? e.asker : null });
        askerOf.set(e.threadId, e.asker);
        writing.set(e.turnId, { threadId: e.threadId, agentId: e.agentId });
        const triggerId = engine?.queue(e.threadId).find((q) => q.qseq === e.qseq)?.messageId ?? undefined;
        emit({ kind: "start", threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, asker: e.asker, ...(triggerId ? { triggerId } : {}) });
        return;
      }
      case "turn.completed": {
        const seg = live.get(e.turnId) ?? { blocks: [], text: "", mentions: 0 };
        const routineOwner = turns.get(e.turnId)?.routineOwner ?? null;
        live.delete(e.turnId); turns.delete(e.turnId);
        writing.delete(e.turnId);
        emit({ kind: "end", threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, state: "done" });
        // what the turn started (a task, a Run, a file...) goes under its reply as cards, one group
        seg.blocks.push(...workBlocks(e.turnId));
        // how long the whole turn took (thinking and writing too), for "Worked for 14s" under the reply
        if (seg.t0 !== undefined) { const last = [...seg.blocks].reverse().find((x) => x.type === "tool_result" || x.type === "tool_call"); if (last) last.data = { ...(last.data as Record<string, unknown>), turnSecs: Math.max(0, Math.round(((o.now ?? Date.now)() - seg.t0) / 1000)) }; }
        if (seg.text !== "" || seg.mentions > 0) {
          ready.set(`${e.threadId}:${e.agentId}`, { ...seg, routineOwner, turnId: e.turnId });   // the engine stores the reply right after this event; message.received below posts it
        } else if (seg.blocks.length > 0) {
          enqueuePost(e.threadId, e.agentId, { threadId: e.threadId, body: "", blocks: seg.blocks, mentions: askerMention(e.threadId, e.agentId), clientId: brgId(), ...(routineOwner ? { via: { routineOwner } } : {}) }, e.turnId);
        } else {
          emit({ kind: "final", threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, messageId: null });
        }
        return;
      }
      case "turn.failed": case "turn.cancelled": case "turn.waiting": {
        if (e.type === "turn.waiting" && e.reason !== "approval") return;
        // a turn a dead host left has no turn.started here: who it ran for comes with the event, so the agent can still say so in the chat
        if (e.type === "turn.failed" && e.asker) askerOf.set(e.threadId, e.asker);
        if (e.type === "turn.failed") warn("a turn failed", { threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, code: e.code, ...(e.message ? { why: scrub(e.message) } : {}) });
        const parked = e.type === "turn.waiting";
        const seg = live.get(e.turnId);
        const routineOwner = turns.get(e.turnId)?.routineOwner ?? null;
        if (!parked) { live.delete(e.turnId); turns.delete(e.turnId); }
        const blocks = [...(seg?.blocks ?? []), ...workBlocks(e.turnId), status(e)];
        writing.delete(e.turnId);
        emit({ kind: "end", threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, state: e.type === "turn.failed" ? "failed" : e.type === "turn.cancelled" ? "cancelled" : "waiting", ...(e.type === "turn.failed" ? { code: e.code } : {}) });
        enqueuePost(e.threadId, e.agentId, { threadId: e.threadId, body: seg?.text ?? "", blocks, mentions: askerMention(e.threadId, e.agentId), clientId: brgId(), ...(routineOwner ? { via: { routineOwner } } : {}) }, e.turnId);
        return;
      }
      case "message.received": {
        if (e.authorId.startsWith("usr_") || !engine) return;
        const r = ready.get(`${e.threadId}:${e.authorId}`);
        const msg = engine.messages(e.threadId).find((m) => m.id === e.messageId);
        if (!msg || msg.author.kind !== "agent") return;
        // only a turn's own reply is posted from here; an agent message that chat already holds (a crew card, a brief, a tool's post) is not a reply to send again
        if (!r) return;
        ready.delete(`${e.threadId}:${e.authorId}`);
        enqueuePost(e.threadId, e.authorId, {
          threadId: e.threadId, body: msg.body, blocks: r?.blocks ?? [], mentions: [...msg.mentions, ...askerMention(e.threadId, e.authorId).filter((m) => !msg.mentions.some((x) => x.id === m.id))], clientId: msg.id, ...(r?.routineOwner ? { via: { routineOwner: r.routineOwner } } : {}),
        }, r?.turnId);
        return;
      }
      default: return;
    }
  };

  function wrap(s: EngineSession): EngineSession {
    const send = (input: TurnInput): AsyncIterable<DriverEvent> => (async function* () {
      const seg: Segment = { blocks: [], text: "", mentions: 0, t0: (o.now ?? Date.now)(), calls: new Map() };
      let afterBlock = false;
      live.set(input.turnId, seg);
      for await (const ev of s.send(input)) {
        if (ev.type === "text") {
          // words that come after a tool call are a new paragraph, not a continuation of the sentence before it
          const t = afterBlock && ev.text !== "" && seg.text !== "" && !/\s$/.test(seg.text) && !/^\s/.test(ev.text) ? `\n\n${ev.text}` : ev.text;
          if (ev.text !== "") afterBlock = false;
          const at = seg.text.length; seg.text += t; if (ev.text !== "") emit({ kind: "delta", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, text: t, at });
          if (t !== ev.text) { yield { ...ev, text: t }; continue; }
        }
        else if (ev.type === "thinking") { if (ev.text !== "") emit({ kind: "thinking", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, text: ev.text }); }
        else if (ev.type === "block" && ev.kind === "tool_input") {
          // what a call touches goes to the live line only, over the same gated link as the words: it is never saved with the reply
          const p = (ev.payload ?? {}) as { id?: unknown; detail?: unknown };
          if (typeof p.id === "string" && typeof p.detail === "string" && p.detail !== "") emit({ kind: "step", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, phase: "input", id: p.id, detail: p.detail });
          // a subagent's own one-line description is saved on its call, so the trail names it ("Working with a helper: Check the pricing page") instead of a bare "Using agent"
          const call = typeof p.id === "string" && typeof p.detail === "string" && p.detail !== "" ? seg.blocks.find((x) => x.type === "tool_call" && (x.data as { id?: unknown }).id === p.id) : undefined;
          if (call && /^(Agent|Task)$/.test(String((call.data as { name?: unknown }).name))) call.data = { ...(call.data as Record<string, unknown>), detail: p.detail };
        }
        else if (ev.type === "block") {
          afterBlock = true;
          const p = (ev.payload ?? {}) as { id?: unknown; name?: unknown; ok?: unknown };
          const id = typeof p.id === "string" ? p.id : "";
          const now = (o.now ?? Date.now)();
          let data: Record<string, unknown> = ev.payload ?? {};
          if (ev.kind === "tool_call" && id !== "") {
            const name = typeof p.name === "string" ? p.name : "";
            seg.calls?.set(id, { name, at: now });
            emit({ kind: "step", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, phase: "call", id, ...(name ? { name } : {}) });
          } else if (ev.kind === "tool_result" && id !== "") {
            const call = seg.calls?.get(id);
            emit({ kind: "step", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, phase: "result", id, ...(call?.name ? { name: call.name } : {}), ...(typeof p.ok === "boolean" ? { ok: p.ok } : {}) });
            if (call) data = { ...data, name: call.name, secs: Math.max(0, Math.round((now - call.at) / 1000)) };
          }
          seg.blocks.push({ type: ev.kind, v: 1, data });
        }
        else if (ev.type === "done") {
          // The engine routes the reply with the mentions the driver ends on: a reply addressed to the asker (a reviewer's verdict) names them, so it reaches them and no agent answers it.
          const aimed = o.addressAsker?.(input.threadId, input.agent.id) ? [{ kind: "person" as const, id: input.asker }] : [];
          const mentions = [...(ev.mentions ?? []), ...aimed.filter((m) => !(ev.mentions ?? []).some((x) => x.id === m.id))];
          seg.mentions = mentions.length;
          yield mentions.length > 0 ? { ...ev, mentions } : ev;
          continue;
        }
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
  type Row = { messageId: string; threadSeq?: number; author: { kind: string; id: string }; body: string; depth?: number; attachments?: string[]; blocks?: Array<{ type: string; data?: unknown }> };

  /**
   * What a message points at, as plain lines after its words, so the agent sees the files and links the person sent: "[Attached: brief.docx (file fil_1)]", "[Linked: Rivera Holdings (record rec_2)]".
   * A file the asker cannot name (gone, not theirs) is listed by id only. Chat keeps the words as typed; only the engine's copy carries these lines.
   */
  async function pointers(read: (cap: string, input: unknown) => Promise<unknown>, m: Row): Promise<string> {
    const lines: string[] = [];
    for (const id of (m.attachments ?? []).slice(0, 20)) {
      let name = "";
      try { name = String(((await read("files.get", { fileId: id })) as { file?: { name?: unknown } }).file?.name ?? ""); } catch { /* listed by id */ }
      lines.push(name === "" ? `[Attached: file ${id}]` : `[Attached: ${name} (file ${id})]`);
    }
    for (const b of m.blocks ?? []) {
      if (b.type !== "refs" || typeof b.data !== "object" || b.data === null) continue;
      const refs = (b.data as { refs?: unknown }).refs;
      if (!Array.isArray(refs)) continue;
      for (const r of refs.slice(0, 20)) {
        const x = r as { kind?: unknown; id?: unknown; title?: unknown };
        if (typeof x.kind === "string" && typeof x.id === "string") lines.push(`[Linked: ${typeof x.title === "string" ? x.title : x.id} (${x.kind} ${x.id})]`);
      }
    }
    return lines.length === 0 ? "" : `\n\n${lines.join("\n")}`;
  }

  /** A read of the chat for this message: as its person author when the host gave us a way to, else with the consumer's own ctx. */
  const reader = (ctx: EngineCtx, authorId: string, threadId?: string): ((cap: string, input: unknown) => Promise<unknown>) => {
    if (!o.callAs) return (cap, input) => ctx.call(cap, input);
    if (authorId.startsWith("usr_")) return (cap, input) => o.callAs!(cap, input, authorId);
    // An agent speaks for the person it works for, and a private chat opens only to its people: read as the last person who spoke in the thread (an agent that mentions another agent, a reviewer asked).
    const person = threadId === undefined ? undefined : (ctx.db.all("SELECT author_id FROM engine_messages WHERE thread_id = ? AND author_kind = 'person' ORDER BY thread_seq DESC LIMIT 1", threadId)[0] as { author_id?: string } | undefined)?.author_id;
    return person ? (cap, input) => o.callAs!(cap, input, person) : (cap, input) => ctx.call(cap, input);
  };

  async function open(ctx: EngineCtx, threadId: string, skipId: string, authorId: string): Promise<boolean> {
    const read = reader(ctx, authorId, threadId);
    if (!engine) return false;
    if (opened.has(threadId)) return true;
    let got: ThreadGet;
    try { got = (await read("threads.get", { threadId })) as ThreadGet; } catch (e) {
      // not "no agents": the thread could not be read at all (a private chat the calling principal is not in, a thread that is gone). Say so, with the trace, instead of skipping in silence.
      ctx.log.warn("the bridge could not read the thread, so no turn runs for its message", { traceId: ctx.trace.traceId, threadId, code: (e as { error?: { code?: string } })?.error?.code ?? "unknown", error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    if (got.thread.agents.length === 0) return false;   // nobody to run; the thread opens on the first message after an agent joins
    // a chat pins no model unless the person picked one for the thread: the agent's own model is then the one the turn runs and is metered on
    const own = new Map<string, string>();
    for (const a of got.thread.agents) {
      if (a.model) continue;
      try {
        const m = ((await read("agents.get", { agentId: a.agentId })) as { agent?: { model?: string } } | null)?.agent?.model;
        if (m) own.set(a.agentId, m);
      } catch { /* an agent that cannot be read runs on the account's default */ }
    }
    const agents: EngineAgent[] = got.thread.agents.map((a) => ({
      id: a.agentId, mode: a.mode, ...(a.model || own.get(a.agentId) ? { model: a.model ?? own.get(a.agentId) as string } : {}), ...(a.accountRef ? { accountRef: a.accountRef } : {}), ...(a.watches !== undefined ? { watching: true } : {}),
    }));
    const store = sqlMessages(ctx.db, ctx.now);
    if (store.recent(threadId, 1).length === 0) {
      // First time this host sees the thread: copy the window the agent will read as history, oldest first, under chat's own ids.
      const list = (await read("chat.messages.list", { threadId, limit: HISTORY })) as { messages: Row[] };
      // only what came before this message: a message that arrived after it has its own event coming, and copying it now would make that event read "known" and the message never reach an agent
      const upto = list.messages.find((r) => r.messageId === skipId)?.threadSeq ?? Number.MAX_SAFE_INTEGER;
      for (const r of [...list.messages].sort((a, b) => (a.threadSeq ?? 0) - (b.threadSeq ?? 0))) {
        if (r.messageId === skipId || (r.threadSeq ?? 0) > upto || store.get(r.messageId)) continue;
        const body = r.body + await pointers(read, r);
        withMessageId(r.messageId, () => store.append({ id: r.messageId, threadId, author: { kind: r.author.id.startsWith("agt_") ? "agent" : "person", id: r.author.id }, mentions: [], depth: r.depth ?? 0, body }));
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
    const a = (p["author"] ?? {}) as { kind?: string; id?: string };
    // an agent's message is read as the person it speaks for when the event says so (the first brief of a crew teammate: nobody has spoken in its thread yet)
    const readAs = str(p["actingFor"]).startsWith("usr_") ? str(p["actingFor"]) : str(a.id);
    if (!(await open(ctx, threadId, messageId, readAs))) return { skipped: "no_agents" };
    if (store.get(messageId)) return { skipped: "known" };
    const got = (await reader(ctx, readAs, threadId)("chat.message.get", { threadId, messageId })) as { message: Row };
    const authorId = str(a.id) || got.message.author.id;
    const note = await pointers(reader(ctx, readAs, threadId), got.message);
    const mentions = ((p["mentions"] ?? []) as RouteMention[]).map((m) => ({ kind: m.kind, id: m.id }));
    const eng = engine;
    // an agent added to the chat after it was opened here (a Space agent @mentioned in a chat between people joins as a listener) is not yet known to the engine: read the chat's line-up once and let
    // the engine know the ones this message names, so the mention reaches them
    const named = mentions.filter((m) => m.kind === "agent").map((m) => m.id);
    if (named.length > 0) {
      const known = new Set(eng.agents(threadId).map((a) => a.id));
      if (named.some((id) => !known.has(id))) {
        try {
          const now = (await reader(ctx, authorId, threadId)("threads.get", { threadId })) as ThreadGet;
          for (const a of now.thread.agents) if (named.includes(a.agentId) && !known.has(a.agentId)) eng.engage(threadId, { id: a.agentId, mode: a.mode, ...(a.model ? { model: a.model } : {}), ...(a.accountRef ? { accountRef: a.accountRef } : {}) });
        } catch (e) { ctx.log.warn("the bridge could not read who joined the chat", { traceId: ctx.trace.traceId, threadId, error: e instanceof Error ? e.message : String(e) }); }
      }
    }
    const res = withMessageId(messageId, () => eng.receive({
      threadId, author: { kind: a.kind === "agent" ? "agent" : "person", id: authorId }, mentions, depth: Number(p["depth"] ?? 0), body: got.message.body + note,
    }));
    return { receivedAs: res.responders };
  }

  async function onEdited(ctx: EngineCtx, p: Record<string, unknown>): Promise<{ skipped?: string; receivedAs?: string[] }> {
    const messageId = str(p["messageId"]), threadId = str(p["threadId"]);
    const known = sqlMessages(ctx.db, ctx.now).get(messageId);
    if (!known) return { skipped: "unknown" };
    const got = (await reader(ctx, known.author.id)("chat.message.get", { threadId, messageId })) as { message: Row };
    ctx.db.run("UPDATE engine_messages SET body = ? WHERE id = ?", got.message.body + (await pointers(reader(ctx, known.author.id), got.message)), messageId);
    return {};
  }

  return {
    attach(e) {
      engine = e;
      return e.subscribe(onEngine);
    },
    tap: (openSession) => async (spec) => wrap(await openSession(spec)),
    onEvent: (ctx, event) => (event.name === "message.edited" ? onEdited(ctx, event.payload) : onReceived(ctx, event.payload)),
    liveTurns(threadId) {
      const out: Array<{ turnId: string; agentId: string; text: string }> = [];
      for (const [turnId, w] of writing) if (w.threadId === threadId) out.push({ turnId, agentId: w.agentId, text: live.get(turnId)?.text ?? "" });
      return out;
    },
    async flush() {
      let snap: Array<Promise<void>>;
      do { snap = [...chains.values()]; await Promise.all(snap); } while (snap.length !== chains.size || [...chains.values()].some((p, i) => p !== snap[i]));
    },
  };
}

// The bridge that runs on this host, bound at boot like the engine (projections.bindEngine).
let bound: Bridge | null = null;
export function bindBridge(b: Bridge | null): void { bound = b; }

/** engine.live_turns: the turns being written in a thread the caller can read, with their text so far. */
export async function liveTurns(ctx: EngineCtx, input: { threadId: string }): Promise<{ turns: Array<{ turnId: string; agentId: string; text: string }> }> {
  await ctx.call("threads.get", { threadId: input.threadId });   // the caller's own access to the thread decides, as for any read of it
  return { turns: bound ? bound.liveTurns(input.threadId) : [] };
}

/** The consumer the engine module exports from impl.ts. A host without a running engine skips the event (nothing reads it later; the chat itself is untouched). */
export const bridgeConsumers = {
  "engine.bridge": {
    on: ["message.received", "message.edited"],
    run: async (ctx: EngineCtx, event: BridgeEvent): Promise<{ skipped?: string; receivedAs?: string[] }> => {
      const res = bound ? await bound.onEvent(ctx, event) : { skipped: "engine_not_running" };
      // a message that did not reach the engine says why, with the trace and the ids (one trace id, clear logs); the ones that did are not logged here
      if (res.skipped && res.skipped !== "known" && res.skipped !== "own_post") {
        ctx.log.warn("the engine bridge did not run a turn for a message", { traceId: ctx.trace.traceId, reason: res.skipped, event: event.name, threadId: String(event.payload["threadId"] ?? ""), messageId: String(event.payload["messageId"] ?? "") });
      }
      return res;
    },
  },
};
