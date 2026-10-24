// Turn engine (ARCH 6.2): at most one turn runs per thread; everything else waits in thread_queue, in order.
// A message is routed with lib/route.ts (the same function the composer uses), each responder is queued, and a worker holding the thread lease runs them one at a time.
// A message that arrives while the same agent is working is steering: injected at the next step boundary, never a second concurrent turn.
// An interrupt cancels the running turn now and runs first. runTurn catches everything: a failed thread accepts the next message as a fresh turn.
// A tool call held at the Gate parks the turn (turn.waiting { task }, state waiting); resume() queues the wake that continues it once the task is answered.
// Messages and waits sit behind MessageStore and WaitStore, so a second host that takes the thread over (recover) replays the same bodies.
import { nextDepth, route } from "../../../lib/route.ts";
import { createMemoryQueue } from "./queue.ts";
import type { QueueStore } from "./queue.ts";
import { HEARTBEAT_MS, createMemoryLeases } from "./lease.ts";
import type { LeaseStore } from "./lease.ts";
import { createMemoryMessages, createMemoryWaits } from "./stores.ts";
import type { MessageStore, WaitStore } from "./stores.ts";
import { PRIORITY_INTERRUPT } from "./queue.ts";
import { preview, withMode } from "./lead.ts";
import type {
  AgentMode, DriverEvent, EngineAgent, EngineEvent, EngineSession, IncomingMessage, OpenSession, OpenThread, Placement, PreviewResult,
  QueueItem, ReceiveResult, SpendRow, StoredMessage, ToolResult, TurnRow,
} from "./types.ts";
import type { RoutePolicy, RouteMention } from "../../../lib/route.ts";

export interface ToolContext { threadId: string; turnId: string; agentId: string; asker: string }
/** A tool call parked at the Gate: the task that decides it, and the Run when the call belongs to one. */
export interface HeldCall { taskId: string; runId?: string }
export type ToolRunResult = ToolResult & { held?: HeldCall };
export type ToolRunner = (call: { id: string; name: string; input: unknown }, ctx: ToolContext) => Promise<ToolRunResult>;

export interface StopResult {
  /** Turns that were running and were cancelled. */
  stopped: Array<{ turnId: string; agentId: string }>;
  /** Turns parked on a held tool call that were released. */
  released: Array<{ turnId: string; agentId: string; taskId: string }>;
  /** Queue rows that were waiting and were dropped. */
  dropped: QueueItem[];
}
export interface InterruptResult { cancelled: Array<{ turnId: string; agentId: string }>; queued: boolean; qseqs: number[] }
export type ResumeOutcome = { approved: boolean; result?: ToolResult };

export interface EngineOptions {
  /** 'host:<space>' or 'device:<id>'. */
  holder: string;
  openSession: OpenSession;
  queue?: QueueStore;
  leases?: LeaseStore;
  messages?: MessageStore;
  waits?: WaitStore;
  /** Ids for messages, turns and traces. The default counts per engine; two hosts on one store need unique ids (pass mintId). */
  newId?: (prefix: string) => string;
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
interface ThreadState { thread: OpenThread; messages: StoredMessage[]; running: Running | null; worker: Promise<void> | null; active: boolean }

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
  /**
   * Stop button: cancel the running turn. `agentId` limits it to one agent (its running turn, its queued rows, its parked turns).
   * `clearQueue` stops everything in the thread: running, queued and parked (stop all).
   */
  stop(threadId: string, opts?: { agentId?: string; clearQueue?: boolean }): Promise<StopResult>;
  /** "Stop and send" for a message that is already stored: cancel the running turn and queue the responders first. Without a message it only cancels. */
  interrupt(threadId: string, messageId?: string): Promise<InterruptResult>;
  /** A held tool call was answered (approved or denied): queue the wake that continues the parked turn. Null when the task is unknown or already answered. */
  resume(taskId: string, outcome: ResumeOutcome): number | null;
  /** Turns parked on a held tool call in this thread. */
  waiting(threadId: string): Array<{ turnId: string; agentId: string; taskId: string }>;
  setMode(threadId: string, agentId: string, mode: AgentMode): void;
  /** Change the model, engine or paying account an agent runs on in this thread, from its next turn. */
  setAgent(threadId: string, agentId: string, patch: { model?: string; accountRef?: string }): void;
  agents(threadId: string): EngineAgent[];
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
  const messages = opts.messages ?? createMemoryMessages();
  const waits = opts.waits ?? createMemoryWaits();
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
  const nextId = opts.newId ?? ((p: string): string => `${p}_${++counter}`);

  const emit = (e: EngineEvent): void => { journal.push(e); for (const l of listeners) l(e); };
  const need = (id: string): ThreadState => {
    const st = threads.get(id);
    if (!st) throw new RangeError(`unknown thread ${id}`);
    return st;
  };

  /** A message by id: the window in memory first, then the store (a trigger older than the window, or one another host wrote). */
  const findMessage = (st: ThreadState, id: string | null): StoredMessage | null => {
    if (id === null) return null;
    return st.messages.find((m) => m.id === id) ?? messages.get(id);
  };

  function store(st: ThreadState, m: IncomingMessage): StoredMessage {
    const msg = messages.append({
      id: nextId("m"), threadId: st.thread.id, author: m.author, mentions: [...(m.mentions ?? [])], depth: m.depth ?? 0, body: m.body ?? "",
    });
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
    return dispatch(st, store(st, m), interrupt);
  }

  function dispatch(st: ThreadState, msg: StoredMessage, interrupt: boolean): ReceiveResult {
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
    if (st.active) return;
    st.active = true;   // cleared synchronously by work() at every exit, so a message can never fall between "queue empty" and "worker gone"
    st.worker = work(st);
  }

  async function work(st: ThreadState): Promise<void> {
    const id = st.thread.id;
    try {
      await loop(st, id);
    } catch (e) {
      st.active = false;   // a bug below must not leave the thread permanently "busy"
      throw e;
    }
  }

  async function loop(st: ThreadState, id: string): Promise<void> {
    for (;;) {
      if (!leases.acquire(id, opts.holder, now())) { st.active = false; return; }   // another holder runs this thread
      const next = queue.peek(id);
      if (!next) { leases.release(id, opts.holder); st.active = false; return; }
      const where = opts.place ? opts.place(st.thread, next) : mine;
      if (where !== mine) {
        leases.release(id, opts.holder);
        emit({ type: "agent.handoff", threadId: id, to: where });
        st.active = false;
        return;
      }
      const item = queue.dequeue(id);
      if (!item) continue;
      await runTurn(st, item);
    }
  }

  function payerOf(st: ThreadState, item: QueueItem): { asker: string; reason: "starter" | "steerer" } {
    const personFrom = (item.kind === "message" || item.kind === "interrupt") && findMessage(st, item.messageId)?.author.kind === "person";
    if (personFrom && item.from !== st.thread.starter) return { asker: item.from, reason: "steerer" };
    return { asker: st.thread.starter, reason: "starter" };
  }

  function steerBoundary(st: ThreadState, run: Running, turn: TurnRow): void {
    if (!run.session) return;
    for (const row of queue.steerable(st.thread.id, run.agentId)) {
      const msg = findMessage(st, row.messageId);
      if (!msg) continue;
      queue.setState(st.thread.id, row.qseq, "consumed");
      emit({ type: "queue.consumed", threadId: st.thread.id, qseq: row.qseq, messageId: row.messageId });
      run.session.inject(msg);
      turn.injected += 1;
    }
  }

  function recordSpend(turn: TurnRow): void {
    if (turn.tokensIn + turn.tokensOut > 0) spendRows.push({ agentId: turn.agentId, turnId: turn.id, payer: turn.asker, tokensIn: turn.tokensIn, tokensOut: turn.tokensOut });
  }

  async function runTurn(st: ThreadState, item: QueueItem): Promise<void> {
    const agent = st.thread.agents.find((a) => a.id === item.agentId);
    // A wake that continues a parked turn runs on the account that was paying, and answers the held call.
    const wait = item.kind === "wake" ? waits.forWake(st.thread.id, item.qseq) : null;
    const payer = payerOf(st, item);
    const asker = wait?.asker ?? payer.asker;
    const reason = wait ? ("starter" as const) : payer.reason;
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

    const trigger = findMessage(st, item.messageId);
    let parked: { callId: string; name: string; held: HeldCall } | null = null;
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
        ...(wait && wait.resolution ? { resumed: { taskId: wait.taskId, callId: wait.callId, toolName: wait.toolName, approved: wait.resolution.approved, result: wait.resolution.result } } : {}),
      };
      if (wait) waits.remove(wait.taskId);
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
            if (result.held) {
              // Held at the Gate: no mode, Ask, Allow or Auto, turns this into a result. The turn parks on the task.
              parked = { callId: ev.id, name: ev.name, held: result.held };
              ended = true;
              break;
            }
            session.sendToolResult(ev.id, { ok: result.ok, content: result.content });
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

    const mineStill = leases.renew(st.thread.id, opts.holder, now());
    leases.setTurn(st.thread.id, opts.holder, null);
    st.running = null;
    if (!mineStill) { turn.endedAt = now(); turn.state = "failed"; turn.error ??= { code: "lease_lost", message: "another host took this thread" }; return; }   // the new holder owns the row
    if (parked && !run.cancelled && !turn.error) {
      turn.state = "waiting";
      waits.put({
        taskId: parked.held.taskId, threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId, callId: parked.callId, toolName: parked.name, asker: turn.asker,
        runId: parked.held.runId ?? null, at: now(), resolution: null, wakeQseq: null,
      });
      queue.setState(st.thread.id, item.qseq, "done");
      recordSpend(turn);
      emit({ type: "turn.waiting", threadId: st.thread.id, reason: "approval", turnId: turn.id, agentId: turn.agentId, taskId: parked.held.taskId, ...(parked.held.runId === undefined ? {} : { runId: parked.held.runId }) });
      return;
    }
    turn.endedAt = now();
    if (run.cancelled) turn.state = "cancelled";
    else if (turn.error) turn.state = "failed";
    else turn.state = "completed";
    queue.setState(st.thread.id, item.qseq, turn.state === "cancelled" ? "cancelled" : "done");
    recordSpend(turn);
    if (turn.state === "completed") emit({ type: "turn.completed", threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId });
    else if (turn.state === "cancelled") emit({ type: "turn.cancelled", threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId });
    else emit({ type: "turn.failed", threadId: st.thread.id, turnId: turn.id, agentId: turn.agentId, code: turn.error?.code ?? "engine_error" });
    // The agent's answer is a message like any other: it can @mention the next agent, which counts a hop.
    if (turn.state === "completed" && (reply !== "" || mentions.length > 0)) {
      ingest(st, { threadId: st.thread.id, author: { kind: "agent", id: turn.agentId }, mentions, depth: trigger ? nextDepth(trigger) : 0, body: reply }, false);
    }
  }

  async function runTool(fn: ToolRunner | undefined, call: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<ToolRunResult> {
    if (!fn) return { ok: false, content: { code: "no_tools", message: "this engine has no tool runner" } };
    try { return await fn(call, ctx); } catch (e) { return { ok: false, content: { code: "tool_error", message: e instanceof Error ? e.message : "the tool failed" } }; }
  }

  return {
    openThread(thread) {
      if (threads.has(thread.id)) throw new RangeError(`thread ${thread.id} is already open`);
      if (thread.agents.filter((a) => a.mode === "lead").length > 1) throw new RangeError("a thread has at most one lead");
      threads.set(thread.id, { thread: { ...thread, agents: thread.agents.map((a) => ({ ...a })) }, messages: messages.recent(thread.id, historyWindow), running: null, worker: null, active: false });
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
      const only = o?.agentId;
      const everything = o?.clearQueue === true;
      const run = st.running;
      const hit = run !== null && !run.cancelled && (only === undefined || run.agentId === only) ? run : null;
      const dropped = everything ? queue.cancelQueued(threadId) : only !== undefined ? queue.cancelQueued(threadId, only) : [];
      const stopped = hit ? [{ turnId: hit.turnId, agentId: hit.agentId }] : [];
      const released: StopResult["released"] = [];
      if (everything || only !== undefined) {
        for (const w of waits.open(threadId)) {
          if (only !== undefined && w.agentId !== only) continue;
          waits.remove(w.taskId);
          const row = turnRows.find((t) => t.id === w.turnId);
          if (row && row.state === "waiting") { row.state = "cancelled"; row.endedAt = now(); }
          released.push({ turnId: w.turnId, agentId: w.agentId, taskId: w.taskId });
        }
      }
      if (hit) await cancelRunning(st);
      return { stopped, released, dropped };
    },
    async interrupt(threadId, messageId) {
      const st = need(threadId);
      const run = st.running !== null && !st.running.cancelled ? st.running : null;
      const cancelled = run ? [{ turnId: run.turnId, agentId: run.agentId }] : [];
      if (messageId === undefined) {
        if (run) await cancelRunning(st);
        return { cancelled, queued: false, qseqs: [] };
      }
      const msg = findMessage(st, messageId);
      if (!msg || msg.threadId !== threadId) throw new RangeError(`no message ${messageId} in thread ${threadId}`);
      const r = dispatch(st, msg, true);
      return { cancelled, queued: r.qseqs.length > 0, qseqs: r.qseqs };
    },
    resume(taskId, outcome) {
      const w = waits.get(taskId);
      if (!w || w.resolution) return null;
      const st = threads.get(w.threadId);
      if (!st) return null;   // the thread is not open on this host; the host that holds it resumes
      const result: ToolResult = outcome.result ?? (outcome.approved
        ? { ok: true, content: { approved: true } }
        : { ok: false, content: { code: "denied", message: "A person did not approve this." } });
      const item = enqueue(st, { kind: "wake", agentId: w.agentId, from: w.asker, messageId: null, priority: 0, routine: false });
      if (!waits.resolve(taskId, { approved: outcome.approved, result }, item.qseq)) { queue.setState(w.threadId, item.qseq, "cancelled"); return null; }
      kick(st);
      return item.qseq;
    },
    waiting: (threadId) => waits.open(threadId).filter((w) => w.resolution === null).map((w) => ({ turnId: w.turnId, agentId: w.agentId, taskId: w.taskId })),
    setMode(threadId, agentId, mode) {
      const st = need(threadId);
      st.thread.agents = withMode(st.thread.agents, agentId, mode);
    },
    setAgent(threadId, agentId, patch) {
      const st = need(threadId);
      if (!st.thread.agents.some((a) => a.id === agentId)) throw new RangeError(`no agent ${agentId} in this thread`);
      st.thread.agents = st.thread.agents.map((a) => (a.id === agentId ? { ...a, ...(patch.model === undefined ? {} : { model: patch.model }), ...(patch.accountRef === undefined ? {} : { accountRef: patch.accountRef }) } : a));
    },
    agents: (threadId) => need(threadId).thread.agents.map((a) => ({ ...a })),
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
      while (st.active && st.worker) await st.worker;
    },
    events: (threadId) => (threadId === undefined ? journal.slice() : journal.filter((e) => e.threadId === threadId)),
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    turns: (threadId) => (threadId === undefined ? turnRows.slice() : turnRows.filter((t) => t.threadId === threadId)),
    spend: () => spendRows.slice(),
    messages: (threadId) => need(threadId).messages.slice(),
    queue: (threadId) => queue.list(threadId),
  };
}
