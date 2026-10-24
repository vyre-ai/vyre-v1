// Turn engine (ARCH 6.2, 6.5). At most one turn runs per thread. Everything else waits on thread_queue.
// message.received calls route() from @vyre/lib and enqueues only those responders.
// Listeners are named in the lead's context and make no provider call until they are a responder.
// Steering (a message while a turn runs) is injected at the next tool boundary. Interrupt cancels now.
// A failed turn always records turn.failed and the worker releases the lease before the next item.
// Any host resumes by acquiring the lease; expiry is 20 s without a heartbeat.

import { mintId, mintUuid } from "../../../lib/ids.ts";
import { route } from "../../../lib/route.ts";
import type { RouteMessage, RoutePolicy, RouteReason, RouteThread } from "../../../lib/route.ts";
import { agentLabel, replyLine, systemPrompt } from "./lead.ts";
import { LeaseTable } from "./lease.ts";
import { LEASE_HEARTBEAT_MS } from "./lease.ts";
import { ThreadQueue } from "./queue.ts";
import type { DriverEvent, TurnInput, TurnSession, UserMessage } from "./session.ts";
import type {
  AccountChoice,
  EngineAgent,
  IncomingMessage,
  LogEvent,
  OpenThread,
  Placement,
  PreviewResult,
  QueueItem,
  QueueKind,
  ReceiveResult,
  SpendRow,
  StoredMessage,
  StoredThread,
  TurnBlock,
  TurnRow,
} from "./types.ts";

const COALESCE_MS = 250;
const INTERRUPT_PRIORITY = 10;

export interface EngineClock {
  now(): number;
}

export interface LimitCaps {
  costMicros?: number;
}

export interface TurnEngineOptions {
  /** 'host:<space>' or 'device:<id>'. This worker acquires the lease under that holder. */
  holder: string;
  where?: Placement;
  clock?: EngineClock;
  policy?: RoutePolicy;
  open: (agent: EngineAgent, turn: TurnRow) => TurnSession | Promise<TurnSession>;
  callTool?: (call: { id: string; name: string; input: unknown }, turn: TurnRow) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  toolsFor?: (agent: EngineAgent, asker: string) => { name: string }[];
  onFrame?: (frame: { threadId: string; turnId: string; kind: "text" | "thinking"; text: string }) => void;
  limits?: (agentId: string) => LimitCaps | undefined;
}

interface ActiveTurn {
  turnId: string;
  agentId: string;
  session: TurnSession;
}

interface TextBuf {
  kind: "text" | "thinking";
  text: string;
  since: number;
}

export class TurnEngine {
  readonly holder: string;
  readonly where: Placement;
  readonly leases: LeaseTable;
  private readonly clock: EngineClock;
  private readonly policy: RoutePolicy;
  private readonly opts: TurnEngineOptions;
  private readonly threads = new Map<string, StoredThread>();
  private readonly messages = new Map<string, StoredMessage>();
  private readonly maxSeq = new Map<string, number>();
  private readonly seen = new Map<string, { reason: RouteReason; qseqs: number[] }>();
  private readonly queue = new ThreadQueue();
  private readonly turnRows: TurnRow[] = [];
  private readonly spendRows: SpendRow[] = [];
  private readonly log: LogEvent[] = [];
  private readonly active = new Map<string, ActiveTurn>();
  private readonly cancelFlag = new Set<string>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly lastBeat = new Map<string, number>();
  private readonly buffers = new Map<string, TextBuf>();

  constructor(opts: TurnEngineOptions) {
    this.opts = opts;
    this.holder = opts.holder;
    this.where = opts.where ?? (opts.holder.startsWith("device:") ? "device" : "host");
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.policy = opts.policy ?? {};
    this.leases = new LeaseTable(() => this.clock.now());
  }

  get events(): readonly LogEvent[] {
    return this.log;
  }

  openThread(input: OpenThread): void {
    const agents = input.agents.map((agent) => ({ ...agent }));
    this.threads.set(input.id, {
      id: input.id,
      kind: input.kind,
      starter: input.starter,
      starterAccountRef: input.starterAccountRef ?? null,
      where: input.where ?? "host",
      agents,
    });
  }

  thread(threadId: string): { id: string; starter: string; leadId: string | null; agents: EngineAgent[] } | undefined {
    const thread = this.threads.get(threadId);
    if (!thread) return undefined;
    const lead = thread.agents.find((agent) => agent.mode === "lead");
    return { id: thread.id, starter: thread.starter, leadId: lead?.id ?? null, agents: thread.agents.map((agent) => ({ ...agent })) };
  }

  /** Exactly one lead. Promoting an agent demotes the previous lead to listen. */
  setMode(threadId: string, agentId: string, mode: "lead" | "listen"): { mode: "lead" | "listen"; leadAgentId: string | null } {
    const thread = this.mustThread(threadId);
    const agent = thread.agents.find((row) => row.id === agentId);
    if (!agent) throw new Error(`unknown agent ${agentId}`);
    if (mode === "lead") {
      for (const row of thread.agents) {
        if (row.id === agentId) row.mode = "lead";
        else if (row.mode === "lead") row.mode = "listen";
      }
    } else {
      agent.mode = "listen";
    }
    const lead = thread.agents.find((row) => row.mode === "lead");
    return { mode: agent.mode, leadAgentId: lead?.id ?? null };
  }

  /** Same route() the composer runs. Does not enqueue. */
  preview(input: IncomingMessage): PreviewResult {
    const thread = this.mustThread(input.threadId);
    const decision = route(toRouteThread(thread), toRouteMessage(input), this.policy);
    const names = decision.responders.map((id) => {
      const agent = thread.agents.find((row) => row.id === id);
      return agent ? agentLabel(agent) : id;
    });
    return { responders: decision.responders, reason: decision.reason, listeners: decision.listeners, line: replyLine(names) };
  }

  message(id: string): StoredMessage | undefined {
    return this.messages.get(id);
  }

  queueItems(threadId: string): readonly QueueItem[] {
    return this.queue.items(threadId).map((item) => ({ ...item, account: { ...item.account } }));
  }

  turns(threadId: string): readonly TurnRow[] {
    return this.turnRows.filter((turn) => turn.threadId === threadId);
  }

  spend(agentId: string): { rows: number; costMicros: number; tokensIn: number; tokensOut: number } {
    const rows = this.spendRows.filter((row) => row.agentId === agentId);
    let costMicros = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    for (const row of rows) {
      costMicros += row.costMicros;
      tokensIn += row.tokensIn;
      tokensOut += row.tokensOut;
    }
    return { rows: rows.length, costMicros, tokensIn, tokensOut };
  }

  /** onEvent message.received. Enqueues one item per responder. Does not start the worker. */
  receive(input: IncomingMessage): ReceiveResult {
    const thread = this.mustThread(input.threadId);
    if (input.id) {
      const prior = this.seen.get(input.id);
      if (prior) {
        const items = this.queue.items(thread.id).filter((row) => row.messageId === input.id);
        return { responders: items.map((row) => row.agentId), reason: prior.reason, qseqs: prior.qseqs };
      }
    }
    const kind = input.kind ?? "message";
    if (kind === "wake" || kind === "handoff") {
      const agentId = input.agentId;
      if (!agentId) throw new Error(`${kind} needs an agent`);
      const stored = this.storeMessage(thread, input);
      const item = this.enqueue(thread, stored, agentId, kind, input.priority ?? 0, false, false);
      if (input.id) this.seen.set(input.id, { reason: "lead", qseqs: [item.qseq] });
      return { responders: [agentId], reason: "lead", qseqs: [item.qseq] };
    }
    if (kind === "interrupt") {
      const stored = this.storeMessage(thread, input);
      const running = this.active.get(thread.id);
      const decision = route(toRouteThread(thread), toRouteMessage(input), this.policy);
      const targets = running ? [running.agentId] : decision.responders;
      const items = targets.map((agentId) => this.enqueue(thread, stored, agentId, "interrupt", input.priority ?? INTERRUPT_PRIORITY, false, true));
      const result = { responders: targets, reason: decision.reason, qseqs: items.map((item) => item.qseq) };
      if (input.id) this.seen.set(input.id, { reason: decision.reason, qseqs: result.qseqs });
      return result;
    }
    const stored = this.storeMessage(thread, input);
    const decision = route(toRouteThread(thread), toRouteMessage(input), this.policy);
    const items: QueueItem[] = [];
    for (const agentId of decision.responders) {
      items.push(this.enqueue(thread, stored, agentId, "message", input.priority ?? 0, false, true));
    }
    if (decision.reason !== "person_addressed" && decision.reason !== "hop_limit") {
      const chosen = new Set(decision.responders);
      for (const agent of thread.agents) {
        if (!agent.watching || chosen.has(agent.id)) continue;
        items.push(this.enqueue(thread, stored, agent.id, "message", input.priority ?? 0, true, true));
      }
    }
    const result = { responders: decision.responders, reason: decision.reason, qseqs: items.map((item) => item.qseq) };
    if (stored.id) this.seen.set(stored.id, { reason: decision.reason, qseqs: result.qseqs });
    return result;
  }

  wake(threadId: string, agentId: string): ReceiveResult {
    return this.receive({
      threadId,
      kind: "wake",
      agentId,
      author: { kind: "agent", id: agentId },
      body: "Wake up.",
    });
  }

  /** Cancel the current turn now and queue this message at priority 10. */
  async interrupt(threadId: string, input: IncomingMessage): Promise<ReceiveResult> {
    const result = this.receive({ ...input, threadId, kind: "interrupt", priority: input.priority ?? INTERRUPT_PRIORITY });
    await this.cancelActive(threadId, input.agentId);
    return result;
  }

  stop(threadId: string, agentId?: string): { stopped: number } {
    const queued = this.queue.cancelQueued(threadId, agentId);
    const active = this.active.get(threadId);
    if (!active || (agentId !== undefined && active.agentId !== agentId)) return { stopped: queued };
    this.cancelFlag.add(threadId);
    void active.session.cancel();
    return { stopped: queued + 1 };
  }

  stopAll(threadId: string): { stopped: number } {
    return this.stop(threadId);
  }

  /** Run queued items until the queue is empty, the lease is lost, or placement is not here. */
  drain(threadId: string): Promise<void> {
    const existing = this.inflight.get(threadId);
    if (existing) return existing;
    const run = this.loop(threadId).finally(() => {
      this.inflight.delete(threadId);
    });
    this.inflight.set(threadId, run);
    return run;
  }

  private async loop(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    for (;;) {
      const got = this.leases.acquire(threadId, this.holder, "turn");
      if (!got.acquired) return;
      this.lastBeat.set(threadId, this.clock.now());
      const item = this.queue.dequeue(threadId);
      if (!item) {
        this.leases.release(threadId, this.holder);
        return;
      }
      if (thread.where !== this.where) {
        this.queue.mark(item, "queued");
        this.log.push({ type: "agent.handoff", threadId, agentId: item.agentId, to: thread.where });
        this.leases.release(threadId, this.holder);
        return;
      }
      try {
        await this.runTurn(thread, item);
      } catch (err) {
        const turn = this.turnRows.find((row) => row.threadId === threadId && row.qseq === item.qseq && row.state === "running");
        if (turn) this.finish(turn, "failed", asError(err));
        if (item.state === "running") this.queue.mark(item, "done");
      } finally {
        this.active.delete(threadId);
        this.cancelFlag.delete(threadId);
        this.leases.release(threadId, this.holder);
      }
    }
  }

  private async runTurn(thread: StoredThread, item: QueueItem): Promise<void> {
    const agent = thread.agents.find((row) => row.id === item.agentId);
    if (!agent) {
      this.queue.mark(item, "done");
      return;
    }
    const turn = this.startTurn(thread, item, agent);
    try {
      if (item.account.reason === "none" || item.account.accountRef === null) {
        this.finish(turn, "failed", { code: "account.none", message: "no account for this turn" });
        return;
      }
      const sendAt = nowMs();
      const session = await this.opts.open(agent, turn);
      turn.engine = session.driverId ?? "fake";
      this.leases.attach(thread.id, this.holder, turn.id);
      this.active.set(thread.id, { turnId: turn.id, agentId: agent.id, session });
      await this.consume(thread, item, agent, turn, session, sendAt);
    } catch (err) {
      if (this.cancelFlag.has(thread.id)) this.finish(turn, "cancelled", null);
      else this.finish(turn, "failed", asError(err));
    } finally {
      if (item.state === "running") this.queue.mark(item, turn.state === "cancelled" ? "cancelled" : "done");
    }
  }

  private async consume(thread: StoredThread, item: QueueItem, agent: EngineAgent, turn: TurnRow, session: TurnSession, sendAt: number): Promise<void> {
    const input = this.buildInput(thread, agent, item);
    const latency = session.latencyMs ?? 0;
    let sawToken = false;
    const stream = session.send(input);
    for await (const ev of stream) {
      if (!this.beat(thread.id)) {
        this.finish(turn, "failed", { code: "lease.lost", message: "thread lease expired" });
        await session.cancel();
        return;
      }
      if (this.cancelFlag.has(thread.id)) break;
      if (!sawToken && (ev.type === "text" || ev.type === "thinking")) {
        sawToken = true;
        turn.firstTokenOverheadMs = nowMs() - sendAt - latency;
      }
      const stop = await this.applyEvent(thread, turn, session, ev);
      if (stop) return;
      if (this.cancelFlag.has(thread.id)) break;
    }
    if (this.cancelFlag.has(thread.id)) {
      this.finish(turn, "cancelled", null);
      return;
    }
    if (turn.state === "running") {
      this.finish(turn, "failed", { code: "provider.closed", message: "stream ended before done" });
    }
  }

  /** Returns true when the turn is already finished. */
  private async applyEvent(thread: StoredThread, turn: TurnRow, session: TurnSession, ev: DriverEvent): Promise<boolean> {
    if (ev.type === "text" || ev.type === "thinking") {
      this.opts.onFrame?.({ threadId: thread.id, turnId: turn.id, kind: ev.type, text: ev.text });
      this.pushText(turn, ev.type, ev.text);
      return false;
    }
    if (ev.type === "tool_call") {
      this.flush(turn);
      const result = await (this.opts.callTool ?? defaultTool)({ id: ev.id, name: ev.name, input: ev.input }, turn);
      if (this.cancelFlag.has(thread.id)) return false;
      if (!this.beat(thread.id)) {
        this.finish(turn, "failed", { code: "lease.lost", message: "thread lease expired" });
        await session.cancel();
        return true;
      }
      this.injectSteering(thread.id, session);
      session.sendToolResult?.(ev.id, result);
      return false;
    }
    if (ev.type === "block") {
      this.flush(turn);
      this.pushBlock(turn, ev.blockType, ev.text);
      return false;
    }
    if (ev.type === "usage") {
      const cost = ev.costMicros ?? 0;
      turn.tokensIn += ev.inputTokens;
      turn.tokensOut += ev.outputTokens;
      turn.costMicros += cost;
      this.spendRows.push({
        agentId: turn.agentId,
        turnId: turn.id,
        payer: turn.asker,
        tokensIn: ev.inputTokens,
        tokensOut: ev.outputTokens,
        costMicros: cost,
      });
      const limit = this.overLimit(turn);
      if (limit) {
        this.log.push({ type: "agent.limit_hit", threadId: thread.id, turnId: turn.id, agentId: turn.agentId, limit });
        this.finish(turn, "failed", { code: "permission.limit", message: `over ${limit} limit` });
        await session.cancel();
        return true;
      }
      return false;
    }
    if (ev.type === "done") {
      this.finish(turn, "completed", null);
      return true;
    }
    this.finish(turn, "failed", { code: ev.code ?? "provider.error", message: ev.message });
    return true;
  }

  private injectSteering(threadId: string, session: TurnSession): void {
    const pending = this.queue.peekSteering(threadId);
    for (const item of pending) {
      const stored = item.messageId ? this.messages.get(item.messageId) : undefined;
      const msg: UserMessage = {
        messageId: item.messageId ?? "",
        role: "user",
        content: stored?.body ?? "",
        authorId: item.from,
      };
      session.inject(msg);
      this.queue.mark(item, "consumed");
      this.log.push({ type: "queue.consumed", threadId, qseq: item.qseq, messageId: item.messageId });
    }
  }

  private startTurn(thread: StoredThread, item: QueueItem, agent: EngineAgent): TurnRow {
    const now = this.clock.now();
    const turn: TurnRow = {
      id: mintId("trn", now),
      threadId: thread.id,
      agentId: agent.id,
      asker: item.account.payer,
      accountRef: item.account.accountRef,
      payerReason: item.account.reason,
      engine: "fake",
      model: agent.model ?? "fake",
      state: "running",
      traceId: mintUuid(now).replace(/-/g, ""),
      qseq: item.qseq,
      kind: item.kind,
      routine: item.routine,
      messageId: item.messageId,
      startedAt: now,
      endedAt: null,
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
      error: null,
      firstTokenOverheadMs: null,
      blocks: [],
    };
    this.turnRows.push(turn);
    this.log.push({
      type: "turn.started",
      threadId: thread.id,
      turnId: turn.id,
      agentId: agent.id,
      qseq: item.qseq,
      accountRef: turn.accountRef,
      payerReason: turn.payerReason,
      asker: turn.asker,
    });
    return turn;
  }

  private finish(turn: TurnRow, state: "completed" | "failed" | "cancelled", error: { code: string; message: string } | null): void {
    if (turn.state !== "running") return;
    this.flush(turn);
    turn.state = state;
    turn.endedAt = this.clock.now();
    turn.error = error;
    if (state === "completed") {
      this.log.push({ type: "turn.completed", threadId: turn.threadId, turnId: turn.id, agentId: turn.agentId });
      return;
    }
    if (state === "cancelled") {
      this.log.push({ type: "turn.cancelled", threadId: turn.threadId, turnId: turn.id, agentId: turn.agentId });
      return;
    }
    this.log.push({ type: "turn.failed", threadId: turn.threadId, turnId: turn.id, agentId: turn.agentId, code: error?.code ?? "turn.failed" });
  }

  private buildInput(thread: StoredThread, agent: EngineAgent, item: QueueItem): TurnInput {
    const stored = item.messageId ? this.messages.get(item.messageId) : undefined;
    const body = stored?.body ?? (item.kind === "wake" ? "Wake up." : "");
    const tools = this.opts.toolsFor?.(agent, item.account.payer) ?? [];
    return {
      agentId: agent.id,
      model: agent.model ?? "fake",
      tools,
      messages: [
        { role: "system", content: systemPrompt(agent, thread.agents) },
        { role: "user", content: body },
      ],
    };
  }

  private enqueue(thread: StoredThread, message: StoredMessage | null, agentId: string, kind: QueueKind, priority: number, routine: boolean, steerCheck: boolean): QueueItem {
    const author = message?.author ?? { kind: "agent" as const, id: agentId };
    const account = this.bill(thread, author, message?.accountRef ?? null, kind, steerCheck);
    // A message already waiting is the next turn. Only one that lands while a turn runs is steering.
    const steer = kind === "message" && this.active.has(thread.id);
    const item = this.queue.enqueue({
      threadId: thread.id,
      threadSeq: message?.threadSeq ?? this.allocSeq(thread.id),
      kind,
      messageId: message?.id ?? null,
      agentId,
      from: author.id,
      priority,
      routine,
      steer,
      account,
      enqueuedAt: this.clock.now(),
    });
    this.log.push({
      type: "turn.queued",
      threadId: thread.id,
      qseq: item.qseq,
      agentId,
      kind,
      messageId: item.messageId,
      priority,
      routine,
    });
    return item;
  }

  private bill(thread: StoredThread, author: { kind: "person" | "agent"; id: string }, authorAccount: string | null, kind: QueueKind, steerCheck: boolean): AccountChoice {
    if (kind === "wake") {
      if (thread.starterAccountRef === null) return { accountRef: null, payer: thread.starter, reason: "none" };
      return { accountRef: thread.starterAccountRef, payer: thread.starter, reason: "starter" };
    }
    const steering = steerCheck && (kind === "interrupt" || this.active.has(thread.id));
    if (steering && author.kind === "person" && author.id !== thread.starter) {
      const accountRef = authorAccount ?? thread.starterAccountRef;
      if (accountRef === null) return { accountRef: null, payer: author.id, reason: "none" };
      return { accountRef, payer: author.id, reason: "steerer" };
    }
    if (thread.starterAccountRef === null) return { accountRef: null, payer: thread.starter, reason: "none" };
    return { accountRef: thread.starterAccountRef, payer: thread.starter, reason: "starter" };
  }

  private storeMessage(thread: StoredThread, input: IncomingMessage): StoredMessage {
    if (input.id) {
      const prior = this.messages.get(input.id);
      if (prior) return prior;
    }
    const threadSeq = this.allocSeq(thread.id, input.threadSeq);
    const stored: StoredMessage = {
      id: input.id ?? mintId("msg", this.clock.now()),
      threadId: thread.id,
      threadSeq,
      author: input.author,
      mentions: [...(input.mentions ?? [])],
      depth: input.depth ?? 0,
      body: input.body ?? "",
      accountRef: input.accountRef ?? null,
    };
    this.messages.set(stored.id, stored);
    this.log.push({ type: "message.received", threadId: thread.id, messageId: stored.id, threadSeq, authorId: input.author.id });
    return stored;
  }

  private allocSeq(threadId: string, requested?: number): number {
    const cur = this.maxSeq.get(threadId) ?? 0;
    const seq = requested ?? cur + 1;
    if (seq > cur) this.maxSeq.set(threadId, seq);
    return seq;
  }

  private async cancelActive(threadId: string, agentId: string | undefined): Promise<void> {
    const active = this.active.get(threadId);
    if (!active) return;
    if (agentId !== undefined && active.agentId !== agentId) return;
    this.cancelFlag.add(threadId);
    await active.session.cancel();
  }

  /** True when the lease is still ours. A missed heartbeat that finds an expired row returns false. */
  private beat(threadId: string): boolean {
    const now = this.clock.now();
    const last = this.lastBeat.get(threadId) ?? now;
    if (now - last < LEASE_HEARTBEAT_MS) return true;
    const res = this.leases.heartbeat(threadId, this.holder);
    if (!res.ok) return false;
    this.lastBeat.set(threadId, now);
    return true;
  }

  private overLimit(turn: TurnRow): "run" | null {
    const caps = this.opts.limits?.(turn.agentId);
    if (!caps || caps.costMicros === undefined) return null;
    if (turn.costMicros > caps.costMicros) return "run";
    return null;
  }

  private pushText(turn: TurnRow, kind: "text" | "thinking", text: string): void {
    const now = this.clock.now();
    const buf = this.buffers.get(turn.id);
    if (buf && buf.kind === kind && now - buf.since < COALESCE_MS) {
      buf.text += text;
      return;
    }
    if (buf) this.flush(turn);
    this.buffers.set(turn.id, { kind, text, since: now });
  }

  private pushBlock(turn: TurnRow, kind: string, text: string | null): void {
    const block: TurnBlock = { idx: turn.blocks.length, kind, text };
    turn.blocks.push(block);
    this.log.push({ type: "turn.block", threadId: turn.threadId, turnId: turn.id, idx: block.idx, kind });
  }

  private flush(turn: TurnRow): void {
    const buf = this.buffers.get(turn.id);
    if (!buf) return;
    this.buffers.delete(turn.id);
    this.pushBlock(turn, buf.kind, buf.text);
  }

  private mustThread(threadId: string): StoredThread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown thread ${threadId}`);
    return thread;
  }
}

export function createTurnEngine(opts: TurnEngineOptions): TurnEngine {
  return new TurnEngine(opts);
}

function toRouteThread(thread: StoredThread): RouteThread {
  return { agents: thread.agents.map((agent) => ({ id: agent.id, mode: agent.mode })) };
}

function toRouteMessage(input: IncomingMessage): RouteMessage {
  return { author: input.author, mentions: input.mentions ?? [], depth: input.depth ?? 0 };
}

function defaultTool(): Promise<{ ok: boolean; data: Record<string, never> }> {
  return Promise.resolve({ ok: true, data: {} });
}

function asError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) return { code: "turn.failed", message: err.message };
  return { code: "turn.failed", message: "turn failed" };
}

function nowMs(): number {
  return globalThis.performance.now();
}
