// The bridge between chat and the turn engine (ARCH 6.1, 6.2; P-L2_23a). Chat owns the conversation; the engine runs turns. This file is the only code that moves a message from one to the other.
//
//   in   a message.received consumer opens the thread in the engine (threads.get, history back-filled from chat) and calls engine.receive for any message the engine has not seen.
//   out  the engine's reply becomes one chat post by the agent: the text the engine stored, the blocks the driver streamed, in order, labelled via.routineOwner when the turn was a routine.
//        A block-only turn, and a turn that failed, was cancelled or parked on an approval, post blocks only (the engine stores no message for them).
//
// One source of truth: chat_message holds the conversation. engine_messages is a mirror keyed by the SAME id (a person's message is stored under the id chat gave it, an agent reply is posted
// to chat with the id the engine gave it as clientId), written only by the engine's own store, so the two cannot drift (a later edit is copied by the same consumer).
// No echo: a message.received for a message the engine already holds, or one the bridge posted itself (id prefix BRIDGE_PREFIX), is never fed back to engine.receive.
import { askedIn, isGoAhead, proposedIn } from "../../../lib/asked.ts";
import { stepWords } from "../../../lib/plain-words.ts";
import { handleOf } from "../../../lib/person-handle.ts";
import { linksIn } from "../../../lib/grants.ts";
import { redact } from "../../../agent/src/transcript/sanitize.ts";
import { sessionWorkKey, workBlocks } from "../../../agent/src/tools/work-cards.ts";
import { ALL_AGENTS, route as routeOf } from "../../../lib/route.ts";
import { localClock, readPublicTime } from "../../../lib/presence.ts";
import { hasReads } from "../../../host/src/seams/answer-reads.ts";
import { sqlMessages, withMessageId, mintId } from "../projections.ts";
import { setUsing } from "../node-turns.ts";
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
  /** a key of the Space paid for this turn, so the reply is not on that person's account */
  sharedKey?: boolean;
  threadId: string; body: string; blocks: PostBlock[]; mentions: RouteMention[]; clientId: string;
  via?: { routineOwner: string };
}
/** Run chat.post as the agent (the host seam builds the call with the agent as principal; a person's ctx cannot speak for an agent). */
export type PostAs = (agentId: string, post: AgentPost) => Promise<unknown>;

/** Run a capability for a person through the real pipeline, so what a turn reads is what that person may read (the host builds the call; spec 6.3). */
export type CallAs = (cap: string, input: unknown, personId: string) => Promise<unknown>;

/**
 * "Tell Andrey the deck is ready": a name the person typed is also the teammate it names (lane l-agentdm). For each send to a bare name, every active person in the Space whose first name, last name or full
 * name is that name gets a row of their own (their id), so the Gate lets an agent's message_person to them through this turn. Read as the person who typed it; a name that matches nobody adds nothing.
 */
export async function withTeammates(call: (cap: string, input: unknown) => Promise<unknown>, asked: Array<{ act: string; target: string }>): Promise<Array<{ act: string; target: string }>> {
  const out = [...asked];
  for (const a of asked) {
    if (a.act !== "send" || !/^[a-z][a-z'-]{1,40}$/.test(a.target)) continue;
    try {
      const r = (await call("access.principals.list", { kind: "person", status: "active", q: a.target, limit: 20 })) as { principals?: Array<{ id?: string; name?: string }> } | null;
      for (const p of r?.principals ?? []) {
        const parts = String(p.name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        if (typeof p.id === "string" && (parts.includes(a.target) || parts.join(" ") === a.target)) { out.push({ act: "send", target: p.id }); out.push({ act: "send", target: handleOf(String(p.name ?? ""), p.id) }); }
      }
    } catch { /* no directory here: the name alone stands */ }
  }
  return out;
}

/** What a reader of a live turn is told (the host turns each into one `turn` frame to the people who may read the thread): the turn opened, a piece of its text, the turn ended, and which chat message the finished turn became. */
export type StreamEvent =
  | { kind: "start"; threadId: string; turnId: string; agentId: string; asker: string; /** the message that started the turn, so a screen puts the reply after it and before what is sent meanwhile */ triggerId?: string }
  | { kind: "delta"; threadId: string; turnId: string; agentId: string; text: string; /** characters of the turn before this piece, so a reader who also fetched the text so far never doubles or drops a piece */ at: number;
      /** The turn read something (records, files, mail...): its text goes live to the asker only, until the answer is checked against everyone in the chat (answer-audience.ts). */
      asker?: string; privately?: boolean }
  /** A step of the turn (a tool call or its result): what the agent is doing, for the line under its reply. Names only; no input. */
  | { kind: "step"; threadId: string; turnId: string; agentId: string; phase: "call" | "result" | "input"; id: string; name?: string; ok?: boolean; /** what the call touches, in safe words (a file name, a query): for the live line only */ detail?: string }
  /** Steps gathered to about one frame a second for the screens (live-coalesce.ts): what the fan-out sends instead of each `step`. */
  | { kind: "steps"; threadId: string; turnId: string; agentId: string; steps: Array<{ phase: "call" | "result" | "input"; id: string; name?: string; ok?: boolean; detail?: string }> }
  /** A piece of the thinking the provider sent. It goes only to the person whose turn it is (hole 8), over the live link; it is never logged and never saved. */
  | { kind: "thinking"; threadId: string; turnId: string; agentId: string; text: string; asker?: string }
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

/** Does this agent run outside Vyre? Read as the server: an outside agent is hidden from everyone but its owner, and a teammate's message must not start a turn for it. */
const runsOutside = (ctx: EngineCtx, agentId: string): Promise<boolean> => ctx.call("agents.get", { agentId }).then((r) => (r as { agent?: { runtime?: string } } | null)?.agent?.runtime === "outside", () => false);

export interface BridgeEvent { name: string; subject?: string; payload: Record<string, unknown>; /** the device the message was sent from */ device?: string }

export interface Bridge {
  /** Connect the engine built after the bridge (the engine needs `tap` for its openSession, the bridge needs the engine). */
  attach(engine: TurnEngine): () => void;
  /** Wrap the engine's openSession so the blocks a driver streams reach the chat post. */
  tap(open: OpenSession): OpenSession;
  /** message.received / message.edited from the event log. */
  onEvent(ctx: EngineCtx, event: BridgeEvent): Promise<{ skipped?: string; receivedAs?: string[] }>;
  /** Resolves when every chat post queued so far is done (tests, shutdown). */
  flush(): Promise<void>;
  /** The agents of a chat changed (added, removed, Listening, topics, hours, style): the engine reads the line-up again before the next message. */
  rosterChanged(threadId: string): void;
  /** The turns being written in a thread right now, with the text so far (a chat opened or reconnected mid-turn). */
  liveTurns(threadId: string): Array<{ turnId: string; agentId: string; text: string; step?: string }>;
}

interface Segment { blocks: PostBlock[]; text: string; mentions: number; t0?: number; /** the call it is inside now, in plain words once asked */ step?: { id: string; name: string; detail?: string }; calls?: Map<string, { name: string; at: number }>; /** its live text goes to the asker only */ private?: boolean }
interface Ready { blocks: PostBlock[]; text: string; mentions: number; routineOwner: string | null; turnId: string }

const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** What a poked agent is told, after the line that poked it. Only the agent reads this copy. */
const POKE_NOTE = "\n\n[You were poked: answer the person who poked you, from the last 12 messages and tool calls above. To read further back in this chat, call chat_history_page with the number of the oldest message you can see.]";

/** An engine error can echo a key or a token. It goes to the log only: it passes the shared credential redactor (agent/src/transcript/sanitize.ts, the same rules as every transcript) and is cut to 300 characters. The key is `why`: the sink drops a key named message. */
export const scrub = (text: string): string => redact(text.slice(0, 600)).text.slice(0, 300);

/** A message carries at most this many blocks (modules/chat/projections.ts MAX_BLOCKS); the bridge keeps to it so a long turn's reply is never refused. */
const MAX_POST_BLOCKS = 20;
const STEP_BLOCKS: ReadonlySet<string> = new Set(["tool_call", "tool_result"]);
const NATIVE_OUTSIDE: ReadonlySet<string> = new Set(["WebSearch", "WebFetch", "web_search", "web_fetch"]);

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
  const onSharedKey = new Set<string>();                 // threadId|agentId: the account of this agent's turn here is a key of the Space
  const chains = new Map<string, Promise<void>>();       // per thread: posts go out one after another, in the order the events arrived
  const warn = (msg: string, attrs?: Record<string, unknown>): void => o.log?.warn(msg, attrs);
  const dirty = new Set<string>();                        // threads whose agents changed in the chat since the engine last read them
  const withSettings = new Set<string>();                 // threads where some agent has Listening, topics, hours or a style set: read the line-up before every message
  const homeOf = new Map<string, string>();                // thread id -> the chat it answers for, where agents reply in a thread under the asking message
  const pokedBy = new Map<string, string>();              // `${thread}:${agent}` -> the person who poked it: the reply says so

  const askerMention = (threadId: string, agentId: string): AgentPost["mentions"] => {
    const who = askerOf.get(threadId);
    return who && o.addressAsker?.(threadId, agentId) ? [{ kind: "person", id: who }] : [];
  };

  const enqueuePost = (threadId: string, agentId: string, post: AgentPost, turnId?: string): void => {
    const prev = chains.get(threadId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const asker = askerOf.get(threadId);
      const as = (p: AgentPost): AgentPost => (asker ? { ...p, actingFor: asker, ...(onSharedKey.has(`${threadId}|${agentId}`) ? { sharedKey: true } : {}) } : p);
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
      // An engine that is not installed names its program (a fixed few, never free text), so the chat can offer to install it, and why Vyre's own install did not finish (a fixed word in brackets).
      const program = e.code === "engine.cli_missing" ? /^(claude|codex|grok) is not installed/.exec(e.message ?? "")?.[1] : undefined;
      const setup = program ? /\((offline|checksum|unsupported|disk|failed)\)\.?$/.exec(e.message ?? "")?.[1] : undefined;
      // A Vault that could not be read gives the code it answered with (a fixed word shape, never the text that came with it).
      const reason = e.code === "engine.vault_unreadable" ? /^The Vault could not be read \(([a-z_]+(?:\.[a-z_]+)*)\)\.$/.exec(e.message ?? "")?.[1] : undefined;
      // a picked model nothing can serve: the words name the model and what can run (model-fallback.ts noModelWords), a fixed sentence of Vyre's own
      const detail = e.code === "engine.model_unavailable" ? e.message : undefined;
      return { type: "turn_status", v: 1, data: { state: "failed", turnId: e.turnId, code: e.code, ...(detail ? { detail } : {}), ...(program ? { program } : {}), ...(setup ? { setup } : {}), ...(reason ? { reason } : {}) } };
    }
    return { type: "turn_status", v: 1, data: { state: "cancelled", turnId: e.turnId, ...(e.type === "turn.cancelled" && e.reason ? { reason: e.reason } : {}) } };
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
        seg.blocks.push(...workBlocks(e.turnId), ...workBlocks(sessionWorkKey(e.threadId, e.agentId)));
        // a poked agent's reply carries the quiet line "Poked by <person>"
        const by = pokedBy.get(`${e.threadId}:${e.agentId}`);
        if (by !== undefined) { pokedBy.delete(`${e.threadId}:${e.agentId}`); seg.blocks.push({ type: "poked", v: 1, data: { by, agentId: e.agentId } }); }
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
        if (!parked) pokedBy.delete(`${e.threadId}:${e.agentId}`);   // a poke that failed or was stopped does not mark a later reply
        const seg = live.get(e.turnId);
        const routineOwner = turns.get(e.turnId)?.routineOwner ?? null;
        if (!parked) { live.delete(e.turnId); turns.delete(e.turnId); }
        const blocks = [...(seg?.blocks ?? []), ...workBlocks(e.turnId), ...workBlocks(sessionWorkKey(e.threadId, e.agentId)), status(e)];
        writing.delete(e.turnId);
        emit({ kind: "end", threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, state: e.type === "turn.failed" ? "failed" : e.type === "turn.cancelled" ? "cancelled" : "waiting", ...(e.type === "turn.failed" ? { code: e.code } : {}) });
        enqueuePost(e.threadId, e.agentId, { threadId: e.threadId, body: seg?.text ?? "", blocks, mentions: askerMention(e.threadId, e.agentId), clientId: brgId(), ...(routineOwner ? { via: { routineOwner } } : {}) }, e.turnId);
        // an approval asked inside a thread rises to the chat the thread answers for: one quiet line there that opens the thread (the Island shows the approval itself)
        const up = parked ? homeOf.get(e.threadId) : undefined;
        if (up) enqueuePost(up, e.agentId, { threadId: up, body: "", blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: "needs your OK" } }, { type: "from_thread", v: 1, data: { threadId: e.threadId, messageId: "" } }], mentions: [], clientId: brgId() }, undefined);
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
          const at = seg.text.length; seg.text += t;
          // once the turn has read something, what it writes may rest on what not everyone here may open: live, it goes to the asker only (gap 6); the checked answer is posted for all
          if (hasReads(input.threadId, input.agent.id, input.asker)) seg.private = true;
          if (ev.text !== "") emit({ kind: "delta", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, text: t, at, ...(seg.private ? { asker: input.asker, privately: true } : {}) });
          if (t !== ev.text) { yield { ...ev, text: t }; continue; }
        }
        else if (ev.type === "thinking") { if (ev.text !== "") emit({ kind: "thinking", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, text: ev.text, asker: input.asker }); }
        else if (ev.type === "block" && ev.kind === "tool_input") {
          // what a call touches goes to the live line only, over the same gated link as the words: it is never saved with the reply
          const p = (ev.payload ?? {}) as { id?: unknown; detail?: unknown };
          if (seg.step && seg.step.id === p.id && typeof p.detail === "string" && p.detail !== "") seg.step.detail = p.detail;
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
            seg.step = { id, name };
            // the engine's own web tools run on the vendor's side, so the Gate never sees them: the words they bring in stop outward acts all the same
            if (NATIVE_OUTSIDE.has(name)) { try { await o.callAs?.("gate.taint.mark", { threads: [input.threadId], source: name }, input.asker); } catch (e) { warn("a web read was not marked", { threadId: input.threadId, error: e instanceof Error ? e.message : String(e) }); } }
            emit({ kind: "step", threadId: input.threadId, turnId: input.turnId, agentId: input.agent.id, phase: "call", id, ...(name ? { name } : {}) });
          } else if (ev.kind === "tool_result" && id !== "") {
            const call = seg.calls?.get(id);
            // the step stays as the latest one until the next call: a helper that is thinking between calls still shows what it did last (the helper rows and the Island read it)
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

  type RosterAgent = { agentId: string; name?: string; mode: "lead" | "listen"; model?: string; accountRef?: string; watches?: unknown; quiet?: boolean; when?: "always" | "topics" | "hours"; topics?: string; hoursFrom?: string; hoursTo?: string; style?: "short" | "full" };
  type ThreadGet = { thread: { kind?: string; scopeType?: string; scopeId?: string; starter?: string; members?: Array<{ kind?: string; id: string }>; agents: RosterAgent[] } };
  const peopleOf = (g: ThreadGet): string[] | undefined => (g.thread.members ? g.thread.members.filter((x) => (x.kind ?? "person") === "person").map((x) => x.id) : undefined);
  /** How and when an agent answers in this chat, as the chat holds it, for the engine's routing and for the turn. */
  const settingsOf = (a: RosterAgent): Pick<EngineAgent, "quiet" | "when" | "topics" | "hoursFrom" | "hoursTo" | "style"> => ({
    ...(a.quiet === true ? { quiet: true as const } : {}), ...(a.when && a.when !== "always" ? { when: a.when } : {}), ...(a.topics ? { topics: a.topics } : {}),
    ...(a.hoursFrom ? { hoursFrom: a.hoursFrom } : {}), ...(a.hoursTo ? { hoursTo: a.hoursTo } : {}), ...(a.style ? { style: a.style } : {}),
  });
  type Row = { messageId: string; threadSeq?: number; author: { kind: string; id: string }; body: string; depth?: number; replyTo?: string; attachments?: string[]; blocks?: Array<{ type: string; data?: unknown }> };

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
    const outside = new Set<string>();
    for (const a of got.thread.agents) {
      if (await runsOutside(ctx, a.agentId)) { outside.add(a.agentId); continue; }
      if (a.model) continue;
      try {
        const m = ((await read("agents.get", { agentId: a.agentId })) as { agent?: { model?: string } } | null)?.agent?.model;
        if (m) own.set(a.agentId, m);
      } catch { /* an agent that cannot be read runs on the account's default */ }
    }
    // a task's thread with several agents: the one that works the task, else the one that made it, answers without an @ (the others need one)
    let taskLead: string | undefined;
    if (got.thread.scopeType === "task" && !got.thread.agents.some((a) => a.mode === "lead") && got.thread.agents.length > 1) {
      try {
        const t = ((await read("tasks.get", { taskId: (got.thread as { scopeId?: string }).scopeId })) as { task?: { assigned?: { kind?: string; id?: string }; createdBy?: string } } | null)?.task;
        const ids = new Set(got.thread.agents.map((a) => a.agentId));
        taskLead = [t?.assigned?.kind === "agent" ? t.assigned.id : undefined, t?.createdBy].find((x): x is string => typeof x === "string" && ids.has(x));
      } catch { /* no task to read: the agents listen as before */ }
    }
    const agents: EngineAgent[] = got.thread.agents.map((a) => ({
      id: a.agentId, ...(a.name ? { name: a.name } : {}), mode: a.mode, ...(taskLead === a.agentId ? { taskLead: true as const } : {}), ...(a.model || own.get(a.agentId) ? { model: a.model ?? own.get(a.agentId) as string } : {}), ...(a.accountRef ? { accountRef: a.accountRef } : {}), ...(a.watches !== undefined ? { watching: true } : {}), ...(outside.has(a.agentId) ? { outside: true } : {}), ...settingsOf(a),
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
      engine.openThread({ id: threadId, kind: (got.thread.kind ?? "chat") as ThreadKind, starter: got.thread.starter ?? "", agents, ...(["task", "note", "goal"].includes(got.thread.scopeType ?? "") ? { personal: true } : {}), ...(peopleOf(got) ? { people: peopleOf(got)! } : {}) });
    } catch (e) {
      if (!(e instanceof RangeError) || !/already open/.test(e.message)) throw e;
    }
    opened.add(threadId);
    return true;
  }

  async function onReceived(ctx: EngineCtx, p: Record<string, unknown>, device?: string): Promise<{ skipped?: string; receivedAs?: string[] }> {
    const messageId = str(p["messageId"]);
    /** where the message lives; the turn runs here too, unless the chat sends agents to reply in a thread under it (below) */
    const home = str(p["threadId"]);
    let threadId = home;
    if (!engine) return { skipped: "engine_not_running" };
    if (messageId === "" || threadId === "") return { skipped: "no_ids" };
    if (messageId.startsWith(BRIDGE_PREFIX)) return { skipped: "own_post" };
    // a copy of a thread message into its chat ("Also post to the chat") is for reading, not for answering: the thread already woke whoever it was for
    if (p["copy"] === true) return { skipped: "copy" };
    // a poke of an outside agent went to its own queue when it was made (threads.poke): nothing runs here for it
    if ((p["poke"] as { outside?: unknown } | undefined)?.outside === true) return { skipped: "poke_outside" };
    // the computer the person is using (step 1 of where a turn runs): the device their message came from
    const sender = (p["author"] ?? {}) as { kind?: string; id?: string };
    if (device && sender.kind === "person" && typeof sender.id === "string") { try { setUsing(ctx.db, threadId, sender.id, device, ctx.now()); } catch { /* where it was sent from is a hint, never a reason to drop the message */ } }
    const store = sqlMessages(ctx.db, ctx.now);
    if (store.get(messageId)) return { skipped: "known" };            // the engine stored it: its own reply echoing back, or a replay
    const a = (p["author"] ?? {}) as { kind?: string; id?: string };
    // an agent's message is read as the person it speaks for when the event says so (the first brief of a crew teammate: nobody has spoken in its thread yet)
    const readAs = str(p["actingFor"]).startsWith("usr_") ? str(p["actingFor"]) : str(a.id);
    // the first line of a task's thread is its brief (the AI step posts it as the person who started the task): the task's own baton wakes the agent that holds it, so the brief wakes nobody a second time
    // (an AI step's brief starts "## Goal"; a person's own first words in a task's thread are a message like any other)
    if (Number(p["threadSeq"]) === 1 && a.kind === "person") {
      try {
        const first = (await reader(ctx, readAs, threadId)("chat.message.get", { threadId, messageId })) as { message?: { body?: string } };
        if (/^## Goal\n/.test(String(first.message?.body ?? "")) && (((await reader(ctx, readAs, threadId)("threads.get", { threadId })) as { thread?: { scopeType?: string } }).thread?.scopeType) === "task") return { skipped: "task_brief" };
      } catch { /* not readable: route it as any message */ }
    }
    if (!(await open(ctx, threadId, messageId, readAs))) return { skipped: "no_agents" };
    if (store.get(messageId)) return { skipped: "known" };
    const got = (await reader(ctx, readAs, threadId)("chat.message.get", { threadId: home, messageId })) as { message: Row };
    const authorId = str(a.id) || got.message.author.id;
    const note = await pointers(reader(ctx, readAs, threadId), got.message);
    let grantArgs: Record<string, unknown> | undefined;
    // The only door for "asked this turn": the words a person typed, read here before the turn starts. Never the pointers, never an agent's post, never a line the server posted in a person's name.
    if (a.kind === "person" && p["typed"] === true) {
      try {
        const ask = reader(ctx, authorId, threadId);
        // what the agent last said, when this is a plain yes to it: the yes opens that one kind of act, once. Every message since the agent's last reply counts as asked, so a second one with no words does not undo the first.
        let lastAgent: { body: string; at: number } | undefined;
        try {
          const recent = ((await ask("chat.messages.list", { threadId, limit: 30 })) as { messages: Array<Row & { createdAt?: number }> }).messages;
          const before = [...recent].filter((r) => (r.threadSeq ?? 0) < (got.message.threadSeq ?? Number.MAX_SAFE_INTEGER) && r.author.kind === "agent").sort((x, y) => (y.threadSeq ?? 0) - (x.threadSeq ?? 0))[0];
          if (before) lastAgent = { body: before.body, at: before.createdAt ?? 0 };
        } catch { /* the proposal could not be read: the person's own words still count */ }
        const own = askedIn(str(got.message.body));
        const yes = lastAgent && isGoAhead(str(got.message.body)) ? proposedIn(lastAgent.body).filter((p) => !own.some((o) => o.act === p.act)) : [];
        grantArgs = { messageId, asked: await withTeammates(ask, [...own, ...yes]), links: linksIn(str(got.message.body)), ...(lastAgent && lastAgent.at > 0 ? { since: lastAgent.at } : {}) };
        await ask("gate.grants.ask", { threadId, ...grantArgs });
      }
      catch (e) { warn("the request in a message was not read, so outward acts will ask", { threadId, messageId, error: e instanceof Error ? e.message : String(e) }); }
    }
    const mentions = ((p["mentions"] ?? []) as RouteMention[]).map((m) => ({ kind: m.kind, id: m.id }));
    // a reply to a person is for that person: the engine routes it past the lead
    let replyToPerson: string | undefined;
    if (got.message.replyTo) {
      try {
        const parent = ((await reader(ctx, readAs, threadId)("chat.message.get", { threadId: home, messageId: got.message.replyTo })) as { message: Row }).message.author;
        if (parent.kind === "person") replyToPerson = parent.id;
      } catch { /* the message it answers is gone: an ordinary message */ }
    }
    const eng = engine;
    // an agent added to the chat after it was opened here (a Space agent @mentioned in a chat between people joins as a listener) is not yet known to the engine: read the chat's line-up once and let
    // the engine know the ones this message names, so the mention reaches them
    const named = mentions.filter((m) => m.kind === "agent").map((m) => m.id);
    // a person speaking to all the agents ("both of you") reaches every agent in the chat, so each must be known to the engine, listeners added since included
    const toAll = a.kind !== "agent" && ALL_AGENTS.test(got.message.body);
    const poke = typeof (p["poke"] as { agentId?: unknown } | undefined)?.agentId === "string" ? (p["poke"] as { agentId: string; by?: string }) : undefined;
    // How and when each agent answers (Listening, topics, hours) is the chat's to change at any time: the engine's copy is made current before the message is routed, whenever the chat has any of it or it changed
    const known = new Set(eng.agents(threadId).map((a) => a.id));
    if (named.length > 0 || toAll || poke !== undefined || dirty.delete(threadId) || withSettings.has(threadId)) {
      try {
        const now = (await reader(ctx, authorId, threadId)("threads.get", { threadId })) as ThreadGet;
        withSettings.delete(threadId);
        for (const a of now.thread.agents) {
          if (Object.keys(settingsOf(a)).length > 0) withSettings.add(threadId);
          if (known.has(a.agentId)) { eng.setSettings(threadId, a.agentId, settingsOf(a)); continue; }
          if (!toAll && !named.includes(a.agentId) && a.agentId !== poke?.agentId) continue;
          eng.engage(threadId, { id: a.agentId, mode: a.mode, ...(a.model ? { model: a.model } : {}), ...(a.accountRef ? { accountRef: a.accountRef } : {}), ...((await runsOutside(ctx, a.agentId)) ? { outside: true } : {}), ...settingsOf(a) });
        }
      } catch (e) { ctx.log.warn("the bridge could not read who joined the chat", { traceId: ctx.trace.traceId, threadId, error: e instanceof Error ? e.message : String(e) }); }
    }
    // a person named in the message is spoken to only if they are in the chat: read who is, now, so someone added since the thread opened counts
    let people: string[] | undefined;
    if (mentions.some((m) => m.kind === "person") || got.message.replyTo) {
      try { people = peopleOf((await reader(ctx, authorId, threadId)("threads.get", { threadId })) as ThreadGet); } catch { /* the people the thread opened with stand */ }
    }
    // where the speaker is, for agents set to answer only inside hours
    let minutes: number | undefined;
    if (a.kind === "person" && eng.agents(threadId).some((x) => x.when === "hours")) {
      try { minutes = localClock((o.now ?? Date.now)(), (await readPublicTime(reader(ctx, authorId, threadId), authorId)).timezone ?? "UTC").minutes; } catch { /* unknown hours hold nobody back */ }
    }
    // a poke: the agent answers now, from the last 12 messages, and its reply says who poked it. It reads further back with chat_history_page.
    if (poke !== undefined && poke.by) pokedBy.set(`${threadId}:${poke.agentId}`, poke.by);
    // Where agents reply in threads (a project or channel main chat): a person's ask that an agent will answer is answered in the thread under that message, made if it is not there. The main chat keeps the ask
    // and the thread's own footer. An ask made inside a thread is already in one and is answered there. A poke and a Job's line are not asks.
    if (a.kind === "person" && poke === undefined && p["job"] !== true) {
      try {
        const g = (await reader(ctx, authorId, home)("threads.get", { threadId: home })) as ThreadGet & { thread: { agentRepliesInThreads?: boolean; parentThreadId?: string } };
        if ((g.thread.kind === "channel" || g.thread.kind === "chat") && g.thread.agentRepliesInThreads === true && g.thread.parentThreadId === undefined) {
          const would = routeOf({ agents: eng.agents(home), kind: g.thread.kind, ...(people ? { people } : {}) }, { author: { kind: "person", id: authorId }, mentions, depth: 0, replyToPerson, text: got.message.body, ...(minutes === undefined ? {} : { minutes }) });
          if (would.responders.length > 0) {
            const made = (await reader(ctx, authorId, home)("chat.thread", { threadId: home, messageId })) as { thread: { threadId: string } };
            if (await open(ctx, made.thread.threadId, messageId, authorId)) {
              threadId = made.thread.threadId; homeOf.set(threadId, home);
              // the thread answers as the chat does: who leads there is who leads in the chat, as the engine holds it now
              const inThread = new Set(eng.agents(threadId).map((x) => x.id));
              for (const ag of eng.agents(home)) if (inThread.has(ag.id) && eng.agents(threadId).find((x) => x.id === ag.id)?.mode !== ag.mode) eng.setMode(threadId, ag.id, ag.mode);
              // what the person asked in words opens the same acts in the thread where the turn runs
              if (grantArgs) await reader(ctx, authorId, home)("gate.grants.ask", { threadId, ...grantArgs });
            }
          }
        }
      } catch (e) { ctx.log.warn("the bridge could not open the thread for the reply, so the agent answers in the chat", { traceId: ctx.trace.traceId, threadId: home, error: e instanceof Error ? e.message : String(e) }); }
    }
    const job = p["job"] === true ? str(p["actingFor"]) || authorId : undefined;
    // an agent's post speaks for the person it acted for (chat.post's actingFor): a turn it sets off runs for that person, never for the chat's starter; with nobody behind it, it runs for no one
    const speaksFor = a.kind === "agent" && str(p["actingFor"]).startsWith("usr_") ? str(p["actingFor"]) : undefined;
    // a helper's or teammate's result while others of the crew still work: it is kept in the chat, and nobody is woken. The lead answers once, when the last one is back (owner, 4 Nov 2026).
    const hold = a.kind === "agent" ? await othersStillWorking(ctx, readAs, threadId, (got.message as { blocks?: Array<{ type?: string; data?: unknown }> }).blocks) : false;
    const res = withMessageId(messageId, () => eng.receive({
      ...(hold ? { hold: true } : {}),
      threadId, author: { kind: a.kind === "agent" ? "agent" : "person", id: authorId }, mentions, depth: Number(p["depth"] ?? 0), body: got.message.body + note + (poke ? POKE_NOTE : ""), replyToPerson, ...(people ? { people } : {}), ...(job ? { job } : {}), ...(speaksFor ? { asker: speaksFor } : {}),
      ...(poke ? { poke: { agentId: poke.agentId, by: poke.by ?? authorId } } : {}), ...(minutes === undefined ? {} : { minutes }),
    }));
    // held: look again shortly, because the last two helpers can end together and each sees the other still working; the lead is woken once, for the latest held result, when nobody works any more
    if (hold) scheduleRelease(ctx, threadId, readAs, res.messageId);
    // the person said go in the thread of a task assigned to them, and an agent answers: the task is theirs to do through it, so it moves to Doing and says who is on it for them
    if (a.kind === "person" && res.responders.length > 0) {
      try {
        const g = (await reader(ctx, authorId, threadId)("threads.get", { threadId })) as { thread: { scopeType?: string; scopeId?: string } };
        if (g.thread.scopeType === "task" && typeof g.thread.scopeId === "string") {
          const taskId = g.thread.scopeId;
          for (const agent of res.responders.filter((r) => r.startsWith("agt_")).slice(0, 1)) await reader(ctx, authorId, threadId)("tasks.agent_on_it", { taskId, agentId: agent });
        }
      } catch { /* not a task of theirs, or already moving: the agent's own work goes on */ }
    }
    // an agent handed the chat to another: one quiet line shows the chain ("Intake asked Docs")
    if (res.chain) {
      const nameOfAgent = (id: string): string => eng.agents(threadId).find((x) => x.id === id)?.name ?? "an agent";
      const text = `${nameOfAgent(res.chain.from)} asked ${res.chain.to.map(nameOfAgent).join(" and ")}`;
      try { await o.postAs(res.chain.from, { threadId, body: "", mentions: [], clientId: brgId(), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text } }], ...(speaksFor ? { actingFor: speaksFor } : {}) } as never); }
      catch (e) { ctx.log.warn("the hand-off line could not be shown", { threadId, error: e instanceof Error ? e.message : String(e) }); }
    }
    return { receivedAs: res.responders };
  }

  const heldNow = new Map<string, string[]>();
  function scheduleRelease(ctx: EngineCtx, threadId: string, readAs: string, messageId: string, tries = 0): void {
    const list = heldNow.get(threadId) ?? [];
    if (tries === 0) heldNow.set(threadId, [...list, messageId]);
    const t = setTimeout(() => {
      void (async () => {
        const mine = heldNow.get(threadId) ?? [];
        if (!mine.includes(messageId) || mine[mine.length - 1] !== messageId) { return; }   // a later held result looks after the wake
        const still = await othersStillWorking(ctx, readAs, threadId, [{ type: "helper", data: { status: "done", threadId: "" } }]);
        if (still) { if (tries < 40) scheduleRelease(ctx, threadId, readAs, messageId, tries + 1); return; }
        heldNow.delete(threadId);
        try { if (engine) engine.release(threadId, messageId); } catch { /* the thread is closed: nothing to wake */ }
      })();
    }, 1500);
    (t as { unref?: () => void }).unref?.();
  }

  /** True when the message is a helper's result and another member of the crew is still working or waiting for a person. */
  async function othersStillWorking(ctx: EngineCtx, readAs: string, threadId: string, blocks: ReadonlyArray<{ type?: string; data?: unknown }> | undefined): Promise<boolean> {
    const done = (blocks ?? []).find((b) => b.type === "helper" && ((b.data ?? {}) as Record<string, unknown>)["status"] !== undefined);
    if (!done) return false;
    const own = str(((done.data ?? {}) as Record<string, unknown>)["threadId"]);
    try {
      const c = (await reader(ctx, readAs, threadId)("engine.crew.status", { threadId })) as { members: Array<{ id: string; state: string }> };
      return c.members.some((m) => m.id !== own && (m.state === "working" || m.state === "needs_you"));
    } catch { return false; }
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
    tap: (openSession) => async (spec) => {
      const key = `${spec.threadId}|${spec.agent.id}`;
      if (spec.account?.shared) onSharedKey.add(key); else onSharedKey.delete(key);
      return wrap(await openSession(spec));
    },
    rosterChanged: (threadId) => { dirty.add(threadId); },
    onEvent: (ctx, event) => (event.name === "message.edited" ? onEdited(ctx, event.payload) : onReceived(ctx, event.payload, event.device)),
    liveTurns(threadId) {
      const out: Array<{ turnId: string; agentId: string; text: string; step?: string }> = [];
      // a turn whose text is the asker's alone for now shows no text to whoever opens the chat mid-turn: its answer arrives checked
      for (const [turnId, w] of writing) if (w.threadId === threadId) out.push({ turnId, agentId: w.agentId, text: live.get(turnId)?.private ? "" : live.get(turnId)?.text ?? "", ...(live.get(turnId)?.step ? { step: stepWords(live.get(turnId)!.step!.name, live.get(turnId)!.step!.detail) } : {}) });
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
export async function liveTurns(ctx: EngineCtx, input: { threadId: string }): Promise<{ turns: Array<{ turnId: string; agentId: string; text: string; step?: string }> }> {
  await ctx.call("threads.get", { threadId: input.threadId });   // the caller's own access to the thread decides, as for any read of it
  return { turns: bound ? bound.liveTurns(input.threadId) : [] };
}

/** The consumer the engine module exports from impl.ts. A host without a running engine skips the event (nothing reads it later; the chat itself is untouched). */
export const bridgeConsumers = {
  /** The agents of a chat changed in the chat (threads.agent_settings.set, add, remove): the next message is routed by the new line-up. */
  "engine.bridge_roster": {
    on: ["thread.updated", "agent.engaged", "agent.disengaged"],
    run: async (_ctx: EngineCtx, event: BridgeEvent): Promise<{ skipped?: string }> => {
      const fields = event.payload["fields"];
      const threadId = str(event.payload["threadId"]);
      if (event.name === "thread.updated" && !(Array.isArray(fields) && fields.includes("agents"))) return { skipped: "not_agents" };
      if (bound && threadId !== "") bound.rosterChanged(threadId);
      return {};
    },
  },
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
