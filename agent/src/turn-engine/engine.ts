// Turn engine (ARCH 6.2): at most one turn runs per thread; everything else waits in thread_queue, in order.
// A message is routed with lib/route.ts (the same function the composer uses), each responder is queued, and a worker holding the thread lease runs them one at a time.
// A message that arrives while the same agent is working is steering: injected at the next step boundary, never a second concurrent turn.
// An interrupt cancels the running turn now and runs first. runTurn catches everything: a failed thread accepts the next message as a fresh turn.
import { nextDepth, route } from "../../../lib/route.ts";
import { createMemoryQueue } from "./queue.ts";
import type { QueueStore } from "./queue.ts";
import { HEARTBEAT_MS, createMemoryLeases } from "./lease.ts";
import type { LeaseStore } from "./lease.ts";
import { PRIORITY_INTERRUPT } from "./queue.ts";
import { preview, withMode } from "./lead.ts";
import type {
  AgentMode, DriverEvent, EngineEvent, EngineSession, IncomingMessage, OpenSession, OpenThread, Placement, PreviewResult,
  QueueItem, ReceiveResult, SpendRow, StoredMessage, ToolResult, TurnRow,
} from "./types.ts";
import type { RoutePolicy, RouteMention } from "../../../lib/route.ts";

export interface ToolContext { threadId: string; turnId: string; agentId: string; asker: string }
export type ToolRunner = (call: { id: string; name: string; input: unknown }, ctx: ToolContext) => Promise<ToolResult>;

export interface EngineOptions {
  /** 'host:<space>' or 'device:<id>'. */
  holder: string;
  openSession: OpenSession;
  queue?: QueueStore;
  leases?: LeaseStore;
  /** Wall clock for rows and lease expiry. */
  now?: () => number;
  /** Monotonic high-resolution clock for the first-token overhead measurement. */
  hr?: () => number;
  policy?: RoutePolicy;
  /** Where a queued item should run (ARCH 6.3). Default: here. */
  place?: (thread: OpenThread, item: QueueItem) => Placement;
  callTool?: ToolRunner;
  /** Repeating timer, returns its canceller. Default setInterval (unref'd). */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Messages included as transcript window in each turn input. */
  historyWindow?: number;
  /** Persisted turn.block coalescing interval for streaming text. */
  blockMs?: number;
}

interface Running { turnId: string; agentId: string; qseq: number; session: EngineSession | null; cancelled: boolean; lostLease: boolean }
interface ThreadState { thread: OpenThread; messages: StoredMessage[]; seq: number; running: Running | null; worker: Promise<void> | null }

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const h = setInterval(fn, ms);
  if (typeof h === "object" && "unref" in h) h.unref();
  return () => clearInterval(h);
};

export interface TurnEngine {
  openThread(thread: OpenThread): void;
  /** Persist, route and queue a message. `interrupt` = "stop and send": cancel the running turn now and run this first. */
  receive(msg: IncomingMessage, opts?: { interrupt?: boolean }): ReceiveResult;
  /** A background wait fired for an agent: queue a wake on the starter's account. */
  wake(threadId: string, agentId: string): number;
  /** Stop button: cancel the running turn. `clearQueue` also drops everything waiting (stop all). */
  stop(threadId: string, opts?: { clearQueue?: boolean }): Promise<void>;
  setMode(threadId: string, agentId: string, mode: AgentMode): void;
  /** The composer line "Intake will reply". */
  preview(threadId: string, draft: { author: IncomingMessage["author"]; mentions?: readonly RouteMention[]; depth?: number }): PreviewResult;
  /** After a crash or lease expiry: requeue what the dead holder was running and take the thread over. */
  recover(threadId: string): boolean;
  idle(threadId: string): Promise<void>;
  events(threadId?: string): EngineEvent[];
  subscribe(fn: (e: EngineEvent) => void): () => void;
  turns(threadId?: string): TurnRow[];
  spend(): SpendRow[];
  messages(threadId: string): StoredMessage[];
  queue(threadId: string): QueueItem[];
}

export function createTurnEngine(opts: EngineOptions): TurnEngine {
  const queue = opts.queue ?? createMemoryQueue();
  const leases = opts.leases ?? createMemoryLeases();
  const now = opts.now ?? Date.now;
  const hr = opts.hr ?? ((): number => performance.now());
  const schedule = opts.schedule ?? defaultSchedule;
  const historyWindow = opts.historyWindow ?? 50;
  const blockMs = opts.blockMs ?? 250;
  const mine: Placement = opts.holder.startsWith("device:") ? "device" : "host";

  const threads = new Map<string, ThreadState>();
  const journal: EngineEvent[] = [];
  const listeners = new Set<(e: EngineEvent) => void>();
  const turnRows: TurnRow[] = [];
  const spendRows: SpendRow[] = [];
  const enqueuedHr = new Map<string, number>();   // `${thread}:${qseq}` -> hr() at enqueue
  let counter = 0;
  const nextId = (p: string): string => `${p}_${++counter}`;

  const emit = (e: EngineEvent): void => { journal.push(e); for (const l of listeners) l(e); };
  const need = (id: string): ThreadState => {
    const st = threads.get(id);
    if (!st) throw new RangeError(`unknown thread ${id}`);
    return st;
  };

  function store(st: ThreadState, m: IncomingMessage): StoredMessage {
    const msg: StoredMessage = {
      id: nextId("m"), threadId: st.thread.id, threadSeq: ++st.seq, author: m.author,
      mentions: [...(m.mentions ?? [])], depth: m.depth ?? 0, body: m.body ?? "",
    };
    st.messages.push(msg);
    emit({ type: "message.received", threadId: msg.threadId, messageId: msg.id, threadSeq: msg.threadSeq, authorId: msg.author.id });
    return msg;
  }

  function enqueue(st: ThreadState, row: { kind: QueueItem["kind"]; agentId: string; from: string; messageId: string | null; priority: number; routine: boolean }): QueueItem {
    const steer = row.kind === "message" && st.running !== null && st.running.agentId === row.agentId;
    const item = queue.enqueue({ threadId: st.thread.id, kind: row.kind, messageId: row.messageId, agentId: row.agentId, from: row.from, priority: row.priority, enqueuedAt: now(), routine: row.routine, steer });
    enqueuedHr.set(`${item.threadId}:${item.qseq}`, hr());
    emit({ type: "turn.queued", threadId: item.threadId, qseq: item.qseq, agentId: item.agentId, kind: item.kind, priority: item.priority, routine: item.routine, steer: item.steer });
    return item;
  }

  function ingest(st: ThreadState, m: IncomingMessage, interrupt: boolean): ReceiveResult {
    const msg = store(st, m);
    const r = route({ agents: st.thread.agents }, { author: msg.author, mentions: msg.mentions, depth: msg.depth }, opts.policy);
    let responders = r.responders;
    let routine = false;
    if (r.reason === "hop_limit") emit({ type: "turn.waiting", threadId: st.thread.id, reason: "hop_limit", messageId: msg.id });
    // "Watches this channel": an agent may act unmentioned, but only when nobody is the lead, and the turn is logged as a routine.
    if (responders.length === 0 && r.reason === "no_lead") {
      responders = st.thread.agents.filter((a) => a.watching === true && a.id !== msg.author.id).map((a) => a.id);
      routine = responders.length > 0;
    }
    const kind = interrupt ? "interrupt" : "message";
    const qseqs = responders.map((agentId) => enqueue(st, { kind, agentId, from: msg.author.id, messageId: msg.id, priority: interrupt ? PRIORITY_INTERRUPT : 0, routine }).qseq);
    if (interrupt && st.running) void cancelRunning(st);
    if (qseqs.length > 0) kick(st);
    return { responders, reason: r.reason, qseqs, messageId: msg.id };
  }

  async function cancelRunning(st: ThreadState): Promise<void> {
    const run = st.running;
    if (!run || run.cancelled) return;
    run.cancelled = true;
    try { await run.session?.cancel(); } catch { /* the turn is ending either way */ }
  }

  function kick(st: ThreadState): void {
    if (st.worker) return;
    st.worker = work(st);
  }

  async function work(st: ThreadState): Promise<void> {
    const id = st.thread.id;
    for (;;) {
      if (!leases.acquire(id, opts.holder, now())) { st.worker = null; return; }   // another holder runs this thread
      const next = queue.peek(id);
      if (!next) { leases.release(id, opts.holder); st.worker = null; return; }
      const where = opts.place ? opts.place(st.thread, next) : mine;
      if (where !== mine) {
        leases.release(id, opts.holder);
        emit({ type: "agent.handoff", threadId: id, to: where });
        st.worker = null;
        return;
      }
      const item = queue.dequeue(id);
      if (!item) continue;
      await runTurn(st, item);
    }
  }

  function payerOf(st: ThreadState, item: QueueItem): { asker: string; reason: "starter" | "steerer" } {
    const personFrom = (item.kind === "message" || item.kind === "interrupt") && st.messages.find((m) => m.id === item.messageId)?.author.kind === "person";
    if (personFrom && item.from !== st.thread.starter) return { asker: item.from, reason: "steerer" };
    return { asker: st.thread.starter, reason: "starter" };
  }

  function steerBoundary(st: ThreadState, run: Running, turn: TurnRow): void {
    if (!run.session) return;
    for (const row of queue.steerable(st.thread.id, run.agentId)) {
      const msg = st.messages.find((m) => m.id === row.messageId);
      if (!msg) continue;
      queue.setState(st.thread.id, row.qseq, "consumed");
      emit({ type: "queue.consumed", threadId: st.thread.id, qseq: row.qseq, messageId: row.messageId });
      run.session.inject(msg);
      turn.injected += 1;
    }
  }

  async function runTurn(st: ThreadState, item: QueueItem): Promise<void> {
    const agent = st.thread.agents.find((a) => a.id === item.agentId);
    const { asker, reason } = payerOf(st, item);
    const turn: TurnRow = {
      id: nextId("t"), threadId: st.thread.id, agentId: item.agentId, asker, payerReason: reason, model: agent?.model ?? null, state: "running",
      traceId: nextId("tr"), qseq: item.qseq, kind: item.kind, routine: item.routine, startedAt: now(), endedAt: null,
      tokensIn: 0, tokensOut: 0, error: null, firstTokenOverheadMs: null, injected: 0,
    };
    turnRows.push(turn);
    const run: Running = { turnId: turn.id, agentId: item.agentId, qseq: item.qseq, session: null, cancelled: false, lostLease: false };
    st.running = run;
    leases.setTurn(st.thread.id, opts.holder, turn.id);
    emit({ type: "turn.started", threadId: st.thread.id, turnId: turn.id, agentId: item.agentId, qseq: item.qseq, asker });
    const stopBeat = schedule(() => {
      if (!leases.renew(st.thread.id, opts.holder, now())) { run.lostLease = true; void cancelRunning(st); }
    }, HEARTBEAT_MS);

    const trigger = st.messages.find((m) => m.id === item.messageId) ?? null;
    let reply = "";
    let mentions: readonly RouteMention[] = [];
    let blockIdx = 0;
    let pending = "";
    let lastFlush = hr();
    const flush = (kind: string): void => {
      if (kind === "text" && pending === "") return;
      pending = "";
      emit({ type: "turn.block", threadId: st.thread.id, turnId: turn.id, idx: blockIdx++, kind });
      lastFlush = hr();
    };
    try {
      if (!agent) throw Object.assign(new Error("agent is not in this thread"), { code: "unknown_agent" });
      const session = await opts.openSession({ threadId: st.thread.id, agent, asker });
      run.session = session;
      if (run.cancelled) await session.cancel();
      const input = {
        threadId: st.thread.id, turnId: turn.id, agent, trigger, asker,
        history: st.messages.slice(-historyWindow),
        listeners: st.thread.agents.filter((a) => a.mode === "listen" && a.id !== agent.id).map((a) => (a.role === undefined ? { id: a.id } : { id: a.id, role: a.role })),
      };
      const t0 = enqueuedHr.get(`${item.threadId}:${item.qseq}`) ?? hr();
      let ended = false;
      for await (const ev of session.send(input) as AsyncIterable<DriverEvent>) {
        if (run.cancelled || run.lostLease) break;
        switch (ev.type) {
          case "text":
          case "thinking":
            if (turn.firstTokenOverheadMs === null) turn.firstTokenOverheadMs = Math.max(0, hr() - t0 - (session.providerLatencyMs ?? 0));
            if (ev.type === "text") { reply += ev.text; pending += ev.text; if (hr() - lastFlush >= blockMs) flush("text"); }
            break;
          case "tool_call": {
            flush("text");
            flush("tool_call");
            const result = await runTool(opts.callTool, { id: ev.id, name: ev.name, input: ev.input }, { threadId: st.thread.id, turnId: turn.id, agentId: item.agentId, asker });
            if (run.cancelled || run.lostLease) break;
            session.sendToolResult(ev.id, result);
            flush("tool_result");
            steerBoundary(st, run, turn);
            break;
          }
          case "block":
            flush("text");
            flush(ev.kind);
            steerBoundary(st, run, turn);
            break;
          case "usage":
            turn.tokensIn += ev.inputTokens;
            turn.tokensOut += ev.outputTokens;
            break;
          case "done":
            mentions = ev.mentions ?? [];
            ended = true;
            break;
          case "error":
            flush("text");
            turn.error = { code: ev.code, message: ev.message };
            ended = true;
            break;
        }
        if (ended) break;
      }
      flush("text");
    } catch (e) {
      const code = typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "engine_error";
      if (!run.cancelled) turn.error = { code, message: e instanceof Error ? e.message : "the turn failed" };
    } finally {
      stopBeat();
      try { await run.session?.close(); } catch { /* a session that will not close is dropped */ }
    }

    turn.endedAt = now();
    const mineStill = leases.renew(st.thread.id, opts.holder, now());
    leases.setTurn(st.thread.id, opts.holder, null);
    st.running = null;
    if (!mineStill) { turn.state = "failed"; turn.error ??= { code: "lease_lost", message: "another host took this thread" }; return; }   // the new holder owns the row
    if (run.cancelled) turn.state = "cancelled";
    else if (turn.error) turn.state = "failed";
    else turn.state = "completed";
    queue.setState(st.thread.id, item.qseq, turn.state === "cancelled" ? "cancelled" : "done");
    if (turn.tokensIn + turn.tokensOut > 0) spendRows.push({ agentId: turn.agentId, turnId: turn.id, payer: turn.asker, tokensIn: turn.tokensIn, tokensOut: turn.tokensOut });
    if (turn.state === "completed") emit({ type: "turn.completed", threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId });
    else if (turn.state === "cancelled") emit({ type: "turn.cancelled", threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId });
    else emit({ type: "turn.failed", threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId, code: turn.error?.code ?? "engine_error" });
    // The agent's answer is a message like any other: it can @mention the next agent, which counts a hop.
    if (turn.state === "completed" && (reply !== "" || mentions.length > 0)) {
      ingest(st, { threadId: st.thread.id, author: { kind: "agent", id: turn.agentId }, mentions, depth: trigger ? nextDepth(trigger) : 0, body: reply }, false);
    }
  }

  async function runTool(fn: ToolRunner | undefined, call: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<ToolResult> {
    if (!fn) return { ok: false, content: { code: "no_tools", message: "this engine has no tool runner" } };
    try { return await fn(call, ctx); } catch (e) { return { ok: false, content: { code: "tool_error", message: e instanceof Error ? e.message : "the tool failed" } }; }
  }

  return {
    openThread(thread) {
      if (threads.has(thread.id)) throw new RangeError(`thread ${thread.id} is already open`);
      if (thread.agents.filter((a) => a.mode === "lead").length > 1) throw new RangeError("a thread has at most one lead");
      threads.set(thread.id, { thread: { ...thread, agents: thread.agents.map((a) => ({ ...a })) }, messages: [], seq: 0, running: null, worker: null });
    },
    receive: (msg, o) => ingest(need(msg.threadId), msg, o?.interrupt === true),
    wake(threadId, agentId) {
      const st = need(threadId);
      const item = enqueue(st, { kind: "wake", agentId, from: st.thread.starter, messageId: null, priority: 0, routine: false });
      kick(st);
      return item.qseq;
    },
    async stop(threadId, o) {
      const st = need(threadId);
      if (o?.clearQueue) queue.cancelQueued(threadId);
      await cancelRunning(st);
    },
    setMode(threadId, agentId, mode) {
      const st = need(threadId);
      st.thread.agents = withMode(st.thread.agents, agentId, mode);
    },
    preview(threadId, draft) {
      const st = need(threadId);
      return preview(st.thread.agents, draft.author, draft.mentions ?? [], draft.depth, opts.policy);
    },
    recover(threadId) {
      const st = need(threadId);
      if (leases.get(threadId, now())) return false;   // someone still holds it and is beating
      const dead = queue.running(threadId);
      for (const row of dead) {
        queue.setState(threadId, row.qseq, "queued");
        emit({ type: "turn.failed", threadId, turnId: `lost:${threadId}:${row.qseq}`, agentId: row.agentId, code: "host_lost" });
      }
      kick(st);
      return true;
    },
    async idle(threadId) {
      const st = need(threadId);
      while (st.worker) await st.worker;
    },
    events: (threadId) => (threadId === undefined ? journal.slice() : journal.filter((e) => e.threadId === threadId)),
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    turns: (threadId) => (threadId === undefined ? turnRows.slice() : turnRows.filter((t) => t.threadId === threadId)),
    spend: () => spendRows.slice(),
    messages: (threadId) => need(threadId).messages.slice(),
    queue: (threadId) => queue.list(threadId),
  };
}
