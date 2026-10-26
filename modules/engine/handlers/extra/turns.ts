// The turn worker's system capabilities and the turn reads (spec 4.14; ARCH 6.1, 6.2, 6.7):
//   engine.turn.enqueue/start/append/wait/finish/fallback, engine.turn.get, engine.turns.list, engine.turn.retry.
// The worker in @vyre/agent calls these through invoke, so every turn event has an owning capability and a trace id. Each turn is one engine_turns row;
// queue rows stay in engine_thread_queue (shared with the in-process engine). A write that repeats (same queue row, same outcome) answers with the first result.
import { PRIORITY_INTERRUPT } from "../../../../agent/src/turn-engine/queue.ts";
import { actorOf, mintId, raise, sqlQueue } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { blockedBy, readPolicy } from "./config.ts";
import { ensureExtra } from "./schema.ts";
import { num, optStr, pageOf, rows, str, turnOf } from "./util.ts";
import type { ErrShape, Row, TurnOut, TurnState } from "./util.ts";

type Kind = "message" | "interrupt" | "wake" | "handoff";
/** A completed turn this long raises agent.task_finished (a long agent task, the "it finished" notification). */
export const LONG_TASK_MS = 60_000;
/** Failures that mean the agent cannot go on until a person signs in again; they raise agent.blocked with an Unblock task. */
const BLOCKING_CODES: ReadonlySet<string> = new Set(["provider.auth_failed", "auth.expired"]);
const DEFAULT_SAMPLE_PERCENT = 5;

function loadTurn(ctx: EngineCtx, turnId: string): Row {
  ensureExtra(ctx.db);
  const r = rows(ctx, "SELECT * FROM engine_turns WHERE turn_id = ?", turnId)[0];
  if (!r) raise(ctx, "validation.not_found", "There is no such turn.", { turnId });
  return r;
}

const isOpen = (state: string): boolean => state === "running" || state === "waiting" || state === "queued";

// ---- enqueue

export function turnEnqueue(
  ctx: EngineCtx,
  input: { threadId: string; agentId: string; kind: Kind; messageId?: string; priority?: number; from: string },
): { qseq: number } {
  ensureExtra(ctx.db);
  if (input.priority !== undefined && !Number.isInteger(input.priority)) raise(ctx, "validation.bad_input", "Priority must be a whole number.", { field: "priority" });
  // The same message for the same agent and kind is queued once: a retried call returns the row it made.
  if (input.messageId !== undefined) {
    const dup = rows(
      ctx,
      "SELECT qseq FROM engine_thread_queue WHERE thread_id = ? AND agent_id = ? AND kind = ? AND message_id = ? AND state IN ('queued', 'running') ORDER BY qseq DESC LIMIT 1",
      input.threadId, input.agentId, input.kind, input.messageId,
    )[0];
    if (dup) return { qseq: num(dup["qseq"]) };
  }
  const item = sqlQueue(ctx.db).enqueue({
    threadId: input.threadId, kind: input.kind, messageId: input.messageId ?? null, agentId: input.agentId, from: input.from,
    priority: input.priority ?? (input.kind === "interrupt" ? PRIORITY_INTERRUPT : 0), enqueuedAt: ctx.now(), routine: false, steer: false,
  });
  ctx.emit("turn.queued", input.threadId, {
    threadId: input.threadId, agentId: input.agentId, kind: input.kind, qseq: item.qseq, ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
  });
  return { qseq: item.qseq };
}

// ---- start

export function turnStart(
  ctx: EngineCtx,
  input: { threadId: string; agentId: string; qseq: number; placement: "host" | "device"; accountRef?: string; engine: string; model: string },
): { turn: TurnOut } {
  ensureExtra(ctx.db);
  const q = rows(ctx, "SELECT * FROM engine_thread_queue WHERE thread_id = ? AND qseq = ?", input.threadId, input.qseq)[0];
  if (!q) raise(ctx, "validation.not_found", "There is no such queued turn.", { threadId: input.threadId, qseq: input.qseq });
  if (str(q["agent_id"]) !== input.agentId) raise(ctx, "validation.bad_input", "That queue row belongs to another agent.", { qseq: input.qseq });
  const existing = rows(ctx, "SELECT * FROM engine_turns WHERE thread_id = ? AND qseq = ?", input.threadId, input.qseq)[0];
  // A retry made a queued turn row already; starting it promotes that row. Any other existing row means the turn already started.
  if (existing && str(existing["state"]) !== "queued") return { turn: turnOf(existing) };
  if (str(q["state"]) !== "queued" && str(q["state"]) !== "running") raise(ctx, "validation.precondition_failed", "That turn was cancelled or has finished.", { qseq: input.qseq, state: str(q["state"]) });
  const now = ctx.now();
  let turnId: string;
  if (existing) {
    turnId = str(existing["turn_id"]);
    ctx.db.run(
      "UPDATE engine_turns SET state = 'running', placement = ?, account_ref = ?, engine = ?, model = ?, started_at = ? WHERE turn_id = ?",
      input.placement, input.accountRef ?? null, input.engine, input.model, now, turnId,
    );
  } else {
    turnId = mintId("trn", now);
    ctx.db.run(
      `INSERT INTO engine_turns (turn_id, thread_id, agent_id, asker, account_ref, engine, model, placement, state, trace_id, run_id, qseq, started_at, ended_at, tokens_in, tokens_out, cost_micros, error, retry_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, NULL, ?, ?, NULL, 0, 0, 0, NULL, NULL)`,
      turnId, input.threadId, input.agentId, actorOf(ctx), input.accountRef ?? null, input.engine, input.model, input.placement, ctx.trace.traceId, input.qseq, now,
    );
  }
  ctx.db.run("UPDATE engine_thread_queue SET state = 'running' WHERE thread_id = ? AND qseq = ?", input.threadId, input.qseq);
  // The lease records which turn it is held for (the holder is whoever took it; this only fills the turn).
  ctx.db.run("UPDATE engine_thread_lease SET turn_id = ? WHERE thread_id = ? AND expires_at > ? AND turn_id IS NULL", turnId, input.threadId, now);
  ctx.emit("turn.started", input.threadId, {
    turnId, threadId: input.threadId, agentId: input.agentId, placement: input.placement, engine: input.engine, model: input.model,
    ...(input.accountRef === undefined ? {} : { accountRef: input.accountRef }),
  });
  return { turn: turnOf(loadTurn(ctx, turnId)) };
}

// ---- append, wait

export function turnAppend(ctx: EngineCtx, input: { turnId: string; kind: "text" | "thinking" | "tool_call" | "tool_result" | "block"; data: unknown }): { idx: number } {
  const t = loadTurn(ctx, input.turnId);
  if (!isOpen(str(t["state"]))) raise(ctx, "validation.precondition_failed", "This turn has ended.", { turnId: input.turnId, state: str(t["state"]) });
  const idx = num(rows(ctx, "SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM engine_turn_blocks WHERE turn_id = ?", input.turnId)[0]?.["n"]);
  ctx.db.run("INSERT INTO engine_turn_blocks (turn_id, idx, kind, data, at) VALUES (?, ?, ?, ?, ?)", input.turnId, idx, input.kind, JSON.stringify(input.data ?? null), ctx.now());
  ctx.emit("turn.block", str(t["thread_id"]), { turnId: input.turnId, threadId: str(t["thread_id"]), idx, kind: input.kind });
  return { idx };
}

export function turnWait(
  ctx: EngineCtx,
  input: { turnId: string; taskId?: string; blockId?: string; runId?: string; until?: number },
): { ok: boolean } {
  const t = loadTurn(ctx, input.turnId);
  if (input.taskId === undefined && input.blockId === undefined && input.runId === undefined && input.until === undefined) {
    raise(ctx, "validation.bad_input", "Say what the turn waits for: a task, an answer, a run or a time.", { turnId: input.turnId });
  }
  const state = str(t["state"]);
  if (state !== "running" && state !== "waiting") raise(ctx, "validation.precondition_failed", "Only a running turn can wait.", { turnId: input.turnId, state });
  ctx.db.run(
    "INSERT OR REPLACE INTO engine_turn_parks (turn_id, task_id, block_id, run_id, until_at, at) VALUES (?, ?, ?, ?, ?, ?)",
    input.turnId, input.taskId ?? null, input.blockId ?? null, input.runId ?? null, input.until ?? null, ctx.now(),
  );
  ctx.db.run("UPDATE engine_turns SET state = 'waiting' WHERE turn_id = ?", input.turnId);
  ctx.emit("turn.waiting", str(t["thread_id"]), {
    turnId: input.turnId, threadId: str(t["thread_id"]),
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }), ...(input.blockId === undefined ? {} : { blockId: input.blockId }), ...(input.runId === undefined ? {} : { runId: input.runId }),
  });
  return { ok: true };
}

// ---- finish

/** Stable share of turns for review sampling: the same turn always lands on the same side of the percentage. */
function bucketOf(turnId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < turnId.length; i++) h = Math.imul(h ^ turnId.charCodeAt(i), 0x01000193) >>> 0;
  return h % 100;
}

async function samplePercent(ctx: EngineCtx): Promise<number> {
  try {
    const out = (await ctx.call("settings.get", { key: "engine.review_sampling" })) as { row?: { value?: { percent?: unknown } } };
    const p = out.row?.value?.percent;
    return typeof p === "number" && p >= 0 && p <= 100 ? p : DEFAULT_SAMPLE_PERCENT;
  } catch {
    return DEFAULT_SAMPLE_PERCENT;
  }
}

async function unblockCard(ctx: EngineCtx, t: Row, error: ErrShape | undefined): Promise<string | undefined> {
  try {
    const out = (await ctx.call("tasks.create", {
      idempotencyKey: `engine.unblock:${str(t["turn_id"])}`,
      kind: "unblock", title: `${str(t["agent_id"])} is blocked`, summary: error?.message ?? "The agent cannot go on.", why: error?.code ?? "provider.auth_failed",
      assigned: { kind: "person", id: str(t["asker"]) }, source: { kind: "chat", id: str(t["thread_id"]) },
    })) as { task?: { id?: string } };
    return out.task?.id;
  } catch (e) {
    ctx.log.warn("unblock card was not created", { error: e instanceof Error ? e.message : "unknown" });
    return undefined;
  }
}

export async function turnFinish(
  ctx: EngineCtx,
  input: { turnId: string; outcome: "completed" | "failed" | "cancelled"; error?: ErrShape; tokensIn?: number; tokensOut?: number; costMicros?: number },
): Promise<{ turn: TurnOut }> {
  const t = loadTurn(ctx, input.turnId);
  const state = str(t["state"]);
  if (!isOpen(state)) {
    if (state === input.outcome) return { turn: turnOf(t) };
    raise(ctx, "validation.precondition_failed", `This turn already ${state}.`, { turnId: input.turnId, state });
  }
  for (const [field, v] of [["tokensIn", input.tokensIn], ["tokensOut", input.tokensOut], ["costMicros", input.costMicros]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) raise(ctx, "validation.bad_input", `${field} must be a whole number, zero or more.`, { field });
  }
  const now = ctx.now();
  const used = rows(ctx, "SELECT tokens_in, tokens_out, cost_micros FROM engine_usage WHERE turn_id = ?", input.turnId)[0];
  const tokensIn = input.tokensIn ?? (used ? num(used["tokens_in"]) : num(t["tokens_in"]));
  const tokensOut = input.tokensOut ?? (used ? num(used["tokens_out"]) : num(t["tokens_out"]));
  const costMicros = input.costMicros ?? (used ? num(used["cost_micros"]) : num(t["cost_micros"]));
  ctx.db.run(
    "UPDATE engine_turns SET state = ?, ended_at = ?, tokens_in = ?, tokens_out = ?, cost_micros = ?, error = ? WHERE turn_id = ?",
    input.outcome, now, tokensIn, tokensOut, costMicros, input.error === undefined ? null : JSON.stringify(input.error), input.turnId,
  );
  ctx.db.run("DELETE FROM engine_turn_parks WHERE turn_id = ?", input.turnId);
  ctx.db.run("UPDATE engine_thread_queue SET state = ? WHERE thread_id = ? AND qseq = ?", input.outcome === "cancelled" ? "cancelled" : "done", str(t["thread_id"]), num(t["qseq"]));
  // Always release the lease this turn held, so the next turn of the thread is not kept waiting for the 20 second expiry.
  ctx.db.run("DELETE FROM engine_thread_lease WHERE thread_id = ? AND turn_id = ?", str(t["thread_id"]), input.turnId);

  const threadId = str(t["thread_id"]), agentId = str(t["agent_id"]);
  if (input.outcome === "completed") {
    ctx.emit("turn.completed", threadId, { turnId: input.turnId, threadId, agentId, tokensIn, tokensOut, costMicros });
    const durationMs = now - num(t["started_at"]);
    if (durationMs >= LONG_TASK_MS) ctx.emit("agent.task_finished", threadId, { agentId, threadId, turnId: input.turnId, durationMs });
    if (bucketOf(input.turnId) < (await samplePercent(ctx))) {
      ctx.db.run("INSERT OR IGNORE INTO engine_review (turn_id, thread_id, agent_id, sampled_at, state) VALUES (?, ?, ?, ?, 'waiting')", input.turnId, threadId, agentId, now);
    }
  } else if (input.outcome === "failed") {
    ctx.emit("turn.failed", threadId, { turnId: input.turnId, threadId, agentId, code: input.error?.code ?? "unknown", message: input.error?.message ?? "The turn failed." });
    if (input.error !== undefined && BLOCKING_CODES.has(input.error.code)) {
      const taskId = await unblockCard(ctx, t, input.error);
      if (taskId !== undefined) ctx.emit("agent.blocked", threadId, { agentId, threadId, turnId: input.turnId, taskId, what: input.error.message });
    }
  } else {
    ctx.emit("turn.cancelled", threadId, { turnId: input.turnId, threadId, agentId, by: actorOf(ctx) });
  }
  return { turn: turnOf(loadTurn(ctx, input.turnId)) };
}

// ---- fallback

export function turnFallback(ctx: EngineCtx, input: { turnId: string; kind: "switch_model" | "backup_key"; to: string }): { ok: boolean } {
  const t = loadTurn(ctx, input.turnId);
  const n = num(rows(ctx, "SELECT COALESCE(MAX(n), 0) + 1 AS n FROM engine_turn_fallbacks WHERE turn_id = ?", input.turnId)[0]?.["n"]);
  ctx.db.run("INSERT INTO engine_turn_fallbacks (turn_id, n, kind, to_what, at) VALUES (?, ?, ?, ?, ?)", input.turnId, n, input.kind, input.to, ctx.now());
  // The turn now runs on what it fell back to; the record shows the model or key it ended on.
  if (input.kind === "switch_model") ctx.db.run("UPDATE engine_turns SET model = ? WHERE turn_id = ?", input.to, input.turnId);
  else ctx.db.run("UPDATE engine_turns SET account_ref = ? WHERE turn_id = ?", input.to, input.turnId);
  ctx.emit("turn.fallback_used", str(t["thread_id"]), { turnId: input.turnId, threadId: str(t["thread_id"]), kind: input.kind, to: input.to });
  return { ok: true };
}

// ---- reads

interface Step { idx: number; kind: string; title: string; durationMs: number; ok: boolean }

function stepOf(block: Row, prevAt: number): Step {
  let data: unknown = null;
  try { data = JSON.parse(str(block["data"])); } catch { data = null; }
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const title = typeof d["title"] === "string" ? d["title"] : typeof d["name"] === "string" ? d["name"] : str(block["kind"]);
  const failed = (d["error"] !== undefined && d["error"] !== null && d["error"] !== false) || d["ok"] === false || d["denied"] === true;
  return { idx: num(block["idx"]), kind: str(block["kind"]), title, durationMs: Math.max(0, num(block["at"]) - prevAt), ok: !failed };
}

export function turnGet(ctx: EngineCtx, input: { turnId: string }): {
  what: {
    turn: TurnOut; machine: "host" | "device"; keyUsed?: string; steps: Step[];
    denials: Array<{ cap: string; reason: string }>; fallbacks: Array<{ kind: string; to: string; at: number }>;
  };
} {
  const t = loadTurn(ctx, input.turnId);
  const blocks = rows(ctx, "SELECT * FROM engine_turn_blocks WHERE turn_id = ? ORDER BY idx ASC", input.turnId);
  let prev = num(t["started_at"]);
  const steps: Step[] = [];
  const denials: Array<{ cap: string; reason: string }> = [];
  for (const b of blocks) {
    steps.push(stepOf(b, prev));
    prev = num(b["at"]);
    if (str(b["kind"]) === "tool_result") {
      try {
        const d = JSON.parse(str(b["data"])) as Record<string, unknown> | null;
        if (d && d["denied"] === true) denials.push({ cap: typeof d["cap"] === "string" ? d["cap"] : str(d["name"]), reason: typeof d["reason"] === "string" ? d["reason"] : "Not allowed" });
      } catch { /* a block that is not JSON has no denial to show */ }
    }
  }
  const fallbacks = rows(ctx, "SELECT kind, to_what, at FROM engine_turn_fallbacks WHERE turn_id = ? ORDER BY n ASC", input.turnId).map((f) => ({ kind: str(f["kind"]), to: str(f["to_what"]), at: num(f["at"]) }));
  const key = optStr(t["account_ref"]);
  return { what: { turn: turnOf(t), machine: str(t["placement"]) === "device" ? "device" : "host", ...(key === undefined ? {} : { keyUsed: key }), steps, denials, fallbacks } };
}

export function turnsList(ctx: EngineCtx, input: { threadId: string; state?: TurnState[]; cursor?: string; limit?: number }): { turns: TurnOut[]; next?: string; total?: number } {
  ensureExtra(ctx.db);
  const states = input.state && input.state.length > 0 ? input.state : null;
  const where = states ? ` AND state IN (${states.map(() => "?").join(", ")})` : "";
  const all = rows(ctx, `SELECT * FROM engine_turns WHERE thread_id = ?${where} ORDER BY started_at DESC, qseq DESC`, input.threadId, ...(states ?? [])).map(turnOf);
  const p = pageOf(all, input);
  return { turns: p.items, ...(p.next === undefined ? {} : { next: p.next }), total: p.total };
}

// ---- retry

export async function turnRetry(
  ctx: EngineCtx,
  input: { turnId: string; model?: string; provider?: string; accountRef?: string },
): Promise<{ turn: TurnOut }> {
  const old = loadTurn(ctx, input.turnId);
  if (str(old["state"]) !== "failed") raise(ctx, "validation.precondition_failed", "Only a failed turn can be retried.", { turnId: input.turnId, state: str(old["state"]) });
  // A retry that is already queued or running is the answer to a second click.
  const again = rows(ctx, "SELECT * FROM engine_turns WHERE retry_of = ? AND state IN ('queued', 'running', 'waiting') ORDER BY started_at DESC LIMIT 1", input.turnId)[0];
  if (again) return { turn: turnOf(again) };
  const spend = rows(ctx, "SELECT paused FROM engine_spend_state WHERE id = 'space'")[0];
  if (spend && num(spend["paused"]) === 1) raise(ctx, "permission.limit", "AI spend is paused in this Space.", { reason: "spend_paused" });
  const model = input.model ?? str(old["model"]);
  const policy = await readPolicy(ctx);
  const why = blockedBy(policy, { model, ...(input.provider === undefined ? {} : { provider: input.provider }) });
  if (why !== null) raise(ctx, "permission.provider_label", `${input.model ?? input.provider ?? model} is not allowed by this Space's AI policy.`, { reason: why });
  const threadId = str(old["thread_id"]);
  const oldQ = rows(ctx, "SELECT kind, message_id FROM engine_thread_queue WHERE thread_id = ? AND qseq = ?", threadId, num(old["qseq"]))[0];
  const kind = (oldQ ? str(oldQ["kind"]) : "message") as Kind;
  const messageId = oldQ ? optStr(oldQ["message_id"]) : undefined;
  const item = sqlQueue(ctx.db).enqueue({
    threadId, kind, messageId: messageId ?? null, agentId: str(old["agent_id"]), from: actorOf(ctx), priority: 0, enqueuedAt: ctx.now(), routine: false, steer: false,
  });
  const turnId = mintId("trn", ctx.now());
  ctx.db.run(
    `INSERT INTO engine_turns (turn_id, thread_id, agent_id, asker, account_ref, engine, model, placement, state, trace_id, run_id, qseq, started_at, ended_at, tokens_in, tokens_out, cost_micros, error, retry_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?, NULL, 0, 0, 0, NULL, ?)`,
    turnId, threadId, str(old["agent_id"]), actorOf(ctx), input.accountRef ?? optStr(old["account_ref"]) ?? null, str(old["engine"]), model, str(old["placement"]), ctx.trace.traceId, item.qseq, ctx.now(), input.turnId,
  );
  ctx.emit("turn.queued", threadId, { threadId, agentId: str(old["agent_id"]), kind, qseq: item.qseq, ...(messageId === undefined ? {} : { messageId }) });
  return { turn: turnOf(loadTurn(ctx, turnId)) };
}
