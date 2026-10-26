// Runs engine and lifecycle capabilities (spec 2.13, 4.3; ARCH 4.7, 7.7).
// The Run row and its durable step log are written here and nowhere else. The engine (`drive`) executes a plan of steps against an executor, one attempt at a time,
// and writes every attempt to runs_steps before and after it runs, so a crash resumes at the first non-terminal step. Steps are idempotent by key run:step:attempt:
// a recovered attempt reuses its key, a retry takes the next attempt number and so a new key.
// DECISION: runs.start leaves a Run `queued`; the first step row (or `drive`) moves it to `running`.
// DECISION: a `wait` Run that times out finishes as succeeded with a summary that starts "Timed out", so the waking thread reads it; any other Run whose wait times out fails and lands in Needs you.
// DECISION: the Run thread (kind `run`) is minted here as thread_id; the chat module renders it from the Run and its step log.
// DECISION: step cap lives in the engine (opts.maxSteps, default 500); runs.record_step has no cap field and only refuses a runaway log (HARD_STEP_ROWS).
import {
  DEFAULT_WAIT_MS, HARD_STEP_ROWS, allSteps, allWaits, clean, clearWait, countRuns, countStepRows, emitRun, engineHealth, findRun, findStep, idemKeyFor, isActive,
  isTerminalStep, latestSteps, listRuns, manageRun, newRunId, newSpanId, newThreadId, page, patchExtra, raise, readExtra, readTrigger, runOut, saveRun, saveStep, saveWait, seeRun, stepOut, touch,
} from "../projections.ts";
import { isSystemCall, isTrustedService } from "../../../lib/trust.ts";
import type { Db, ResourceRef, Run, RunKind, RunStatus, RunsCtx, StepRow, StepState, WaitReason, WaitRow } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- helpers ----

const DURATION = /^(\d+)\s*(s|m|h|d|w)$/;
const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
export function parseDuration(ctx: RunsCtx, s: string | undefined): number {
  if (s === undefined) return DEFAULT_WAIT_MS;
  const m = DURATION.exec(s.trim().toLowerCase());
  if (!m) raise(ctx, "validation.precondition_failed", "Use a duration such as 30d, 6h or 15m.", { reason: "bad_duration", given: s });
  return Number(m[1]) * UNIT[m[2]!]!;
}

/** Runs of these kinds are sandboxes: outward steps are recorded, never executed (test mode and replay, ARCH b9). */
const isSandbox = (k: RunKind): boolean => k === "automation_test" || k === "replay";

function describeOn(on: unknown): string | undefined {
  if (!on || typeof on !== "object") return undefined;
  const o = on as Record<string, unknown>;
  if (typeof o.event === "string") return `event ${o.event}`;
  if (typeof o.run === "string") return `run ${o.run}`;
  if (typeof o.at === "number") return `time ${o.at}`;
  return undefined;
}

// ---- start, wait, resume, finish ----

function newRun(ctx: RunsCtx, i: { kind: RunKind; name?: string | undefined; owner: string; subject?: ResourceRef | undefined; definitionVersion?: number | undefined; parentRun?: string | undefined; threadId?: string | undefined; keyUsed?: string | undefined; modelUsed?: string | undefined }): Run {
  const now = ctx.now();
  const run: Run = {
    id: newRunId(), kind: i.kind, owner: i.owner, startedBy: ctx.principal.id, status: "queued", costMicros: 0, startedAt: now, traceId: ctx.trace.traceId,
    threadId: i.threadId ?? newThreadId(), version: 0, updatedAt: now,
  };
  if (i.name !== undefined) run.name = i.name;
  if (i.subject !== undefined) run.subject = i.subject;
  if (i.definitionVersion !== undefined) run.definitionVersion = i.definitionVersion;
  if (i.parentRun !== undefined) run.parentRun = i.parentRun;
  if (i.keyUsed !== undefined) run.keyUsed = i.keyUsed;
  if (i.modelUsed !== undefined) run.modelUsed = i.modelUsed;
  saveRun(ctx.db, run);
  emitRun(ctx, "run.started", run.id, { kind: run.kind, name: run.name, owner: run.owner, subject: run.subject, definitionVersion: run.definitionVersion, parentRun: run.parentRun });
  return run;
}

export async function start(ctx: RunsCtx, input: In): Promise<unknown> {
  // A person (or an agent) who starts a Run directly starts it for themselves or for the person they act for; the Run's owner decides who may see and manage it. Routines, connectors, journeys and the other modules
  // that start Runs for someone else call from inside the host, which is a system call (P-SEC_10).
  if (!isSystemCall(ctx) && !isTrustedService(ctx.principal) && input.owner !== ctx.principal.id && input.owner !== ctx.actingFor) {
    raise(ctx, "permission.role_lacks_permission", "A Run is started for yourself or for the person you act for.", { reason: "owner_not_caller" });
  }
  const key = input.idempotencyKey as string | undefined;
  if (key) {
    const have = (ctx.db.all("SELECT run_id FROM runs_idem WHERE idem_key = ?", key) as { run_id: string }[])[0];
    if (have && findRun(ctx.db, have.run_id)) return { runId: have.run_id };
  }
  if (input.parentRun && !findRun(ctx.db, input.parentRun)) raise(ctx, "validation.not_found", "The parent run does not exist.", { reason: "no_parent" });
  const run = newRun(ctx, input as Parameters<typeof newRun>[1]);
  const trig = input.trigger as { messageId: string; threadId: string; channelId?: string } | undefined;
  if (trig) ctx.db.run("INSERT OR REPLACE INTO runs_trigger (run_id, message_id, thread_id, channel_id) VALUES (?, ?, ?, ?)", run.id, trig.messageId, trig.threadId, trig.channelId ?? null);
  if (key) ctx.db.run("INSERT OR REPLACE INTO runs_idem (idem_key, run_id) VALUES (?, ?)", key, run.id);
  return { runId: run.id };
}

/** Record a wait on the Run and move it to waiting. Idempotent for the same reason. */
export async function markWaiting(ctx: RunsCtx, run: Run, w: { reason: WaitReason; taskId?: string | undefined; on?: string | undefined; wait?: Partial<WaitRow> }): Promise<Run> {
  if (!isActive(run.status)) raise(ctx, "validation.precondition_failed", "That run has finished.", { reason: "run_finished", status: run.status });
  if (run.status === "waiting" && run.waitReason === w.reason) return run;
  let taskId = w.taskId;
  if (!taskId && w.reason === "key" && !isSandbox(run.kind)) taskId = await unblockStarter(ctx, run, w.reason);
  run.status = "waiting";
  run.waitReason = w.reason;
  touch(ctx, run);
  saveWait(ctx.db, { runId: run.id, reason: w.reason, createdAt: ctx.now(), ...(taskId ? { taskId } : {}), ...(w.on ? { label: w.on } : {}), ...(w.wait ?? {}) });
  emitRun(ctx, "run.waiting", run.id, { reason: w.reason, taskId, on: w.on });
  return run;
}

/** The person to ask: whoever started the Run, or its owner when a service or agent started it. */
const starterOf = (run: Run): string => (run.startedBy.startsWith("usr_") ? run.startedBy : run.owner);

/** A lost key (or an expired background token, when the caller passes the Unblock task itself) lands in the starter's Needs you as an Unblock (spec 2.13 Waiting). Best effort: the Run still waits if tasks is down. */
async function unblockStarter(ctx: RunsCtx, run: Run, reason: WaitReason): Promise<string | undefined> {
  if (!ctx.call) return undefined;
  try {
    const r = (await ctx.call("tasks.create", clean({
      kind: "unblock", title: reason === "key" ? `A key is missing for ${run.name ?? "a run"}` : `${run.name ?? "A run"} needs you to sign in again`,
      summary: reason === "key" ? "The key was lost and no backup key is set. The run continues when you add one." : "The background sign-in expired. The run continues when you renew it.",
      assigned: { kind: "person", id: starterOf(run) }, source: { kind: "run", id: run.id }, idempotencyKey: `run-wait:${run.id}:${reason}`,
    }))) as { task?: { id?: unknown } } | null;
    const id = r?.task?.id;
    return typeof id === "string" ? id : undefined;
  } catch { return undefined; }
}

export async function markWaitingCap(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = seeRun(ctx, input.runId);
  const r = await markWaiting(ctx, run, { reason: input.reason, taskId: input.taskId, on: input.on });
  return { run: runOut(r, readTrigger(ctx.db, r.id)) };
}

export function resumeRun(ctx: RunsCtx, run: Run, reason?: WaitReason): Run {
  if (run.status !== "waiting") raise(ctx, "validation.precondition_failed", "That run is not waiting.", { reason: "not_waiting", status: run.status });
  if (reason !== undefined && run.waitReason !== reason) raise(ctx, "validation.precondition_failed", `The run waits for ${run.waitReason ?? "something else"}, not ${reason}.`, { reason: "wrong_wait", waiting: run.waitReason });
  const was = run.waitReason ?? reason ?? "background";
  run.status = "running";
  delete run.waitReason;
  touch(ctx, run);
  clearWait(ctx.db, run.id);
  emitRun(ctx, "run.resumed", run.id, { reason: was });
  return run;
}
export async function resume(ctx: RunsCtx, input: In): Promise<unknown> {
  return { run: ((x) => runOut(x, readTrigger(ctx.db, x.id)))(resumeRun(ctx, seeRun(ctx, input.runId), input.reason)) };
}

/** How many of this owner's most recent finished Runs of the same kind and name failed in a row, this one included. */
function consecutiveFailures(db: Db, run: Run): number {
  const rows = db.all(
    "SELECT status FROM runs_items WHERE kind = ? AND owner = ? AND COALESCE(name, '') = ? AND status IN ('succeeded', 'failed') AND deleted_at IS NULL ORDER BY ended_at DESC, id DESC LIMIT 50",
    run.kind, run.owner, run.name ?? "",
  ) as { status: string }[];
  let n = 0;   // the Run itself is the newest row, already written as failed
  for (const r of rows) { if (r.status !== "failed") break; n += 1; }
  return Math.max(1, n);
}

export interface FinishOpts { summary?: string | undefined; costMicros?: number | undefined; error?: { code: string; message: string; step?: string | undefined } | undefined; by?: string | undefined; reason?: string | undefined }

/** Close a Run. Idempotent for the same status; a different status on a finished Run is refused. */
export async function finishRun(ctx: RunsCtx, run: Run, status: "succeeded" | "failed" | "stopped", o: FinishOpts = {}): Promise<Run> {
  if (!isActive(run.status)) {
    if (run.status === status) return run;
    raise(ctx, "validation.precondition_failed", `That run already ${run.status === "succeeded" ? "succeeded" : run.status}.`, { reason: "run_finished", status: run.status });
  }
  run.status = status;
  delete run.waitReason;
  run.endedAt = ctx.now();
  if (o.summary !== undefined) run.summary = o.summary;
  if (o.costMicros !== undefined) run.costMicros = o.costMicros;
  touch(ctx, run);
  clearWait(ctx.db, run.id);
  if (status === "stopped") {
    // the steps that never finished stop with the Run
    for (const s of latestSteps(ctx.db, run.id)) if (!isTerminalStep(s.state)) saveStep(ctx.db, { ...s, state: "stopped", endedAt: ctx.now() });
    patchExtra(ctx.db, run.id, clean({ stopReason: o.reason, stoppedBy: o.by ?? ctx.principal.id }));
    emitRun(ctx, "run.stopped", run.id, { by: o.by ?? ctx.principal.id, reason: o.reason });
  } else if (status === "succeeded") {
    emitRun(ctx, "run.succeeded", run.id, { kind: run.kind, summary: run.summary, costMicros: run.costMicros });
  } else {
    const err = o.error ?? { code: "run.failed", message: o.summary ?? "The run failed." };
    const consecutive = consecutiveFailures(ctx.db, run);
    patchExtra(ctx.db, run.id, clean({ errorCode: err.code, errorMessage: err.message, errorStep: err.step, consecutive }));
    emitRun(ctx, "run.failed", run.id, { kind: run.kind, step: err.step, code: err.code, message: err.message, owner: run.owner, consecutive });
    await needsYou(ctx, run, err.message);
  }
  return run;
}

/** A failed Run lands in the owner's Needs you as an Unblock task (spec 2.13). Sandbox Runs (test mode, replay) stay quiet. Best effort. */
async function needsYou(ctx: RunsCtx, run: Run, message: string): Promise<void> {
  if (!ctx.call || isSandbox(run.kind)) return;
  try {
    await ctx.call("tasks.create", clean({
      kind: "unblock", title: `${run.name ?? "A run"} failed`, summary: message, why: "A run you own stopped with an error. Retry it or undo what it changed.",
      assigned: { kind: "person", id: run.owner }, source: { kind: "run", id: run.id }, recordId: run.subject?.type === "record" ? run.subject.id : undefined,
      idempotencyKey: `run-failed:${run.id}`,
    }));
  } catch { /* the failure is already on the Run and in run.failed; Needs you catches up through the notification */ }
}

export async function finish(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = seeRun(ctx, input.runId);
  const r = await finishRun(ctx, run, input.status, { summary: input.summary, costMicros: input.costMicros, error: input.error });
  return { run: runOut(r, readTrigger(ctx.db, r.id)) };
}

// ---- stop, retry, replay ----

export async function stop(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = manageRun(ctx, input.runId);
  if (run.status === "stopped") return { run: runOut(run, readTrigger(ctx.db, run.id)) };
  if (!isActive(run.status)) raise(ctx, "validation.precondition_failed", "That run has already finished.", { reason: "run_finished", status: run.status });
  return { run: ((x) => runOut(x, readTrigger(ctx.db, x.id)))(await finishRun(ctx, run, "stopped", { by: ctx.principal.id, reason: input.reason })) };
}

export async function retry(ctx: RunsCtx, input: In): Promise<unknown> {
  const old = manageRun(ctx, input.runId);
  if (old.status !== "failed" && old.status !== "stopped") raise(ctx, "validation.precondition_failed", "Only a failed or stopped run can be retried.", { reason: "not_retryable", status: old.status });
  const steps = latestSteps(ctx.db, old.id);
  const from = input.fromStep as string | undefined;
  const at = from === undefined ? undefined : steps.find((s) => s.step === from);
  if (from !== undefined && !at) raise(ctx, "validation.precondition_failed", "That run has no such step.", { reason: "unknown_step", step: from });
  const run = newRun(ctx, { kind: old.kind, name: old.name, owner: old.owner, subject: old.subject, definitionVersion: old.definitionVersion, parentRun: old.id });
  patchExtra(ctx.db, run.id, clean({ retryOf: old.id, fromStep: from }));
  // from a step: the steps before it keep their results, so the engine resumes at that step
  if (at) for (const s of steps) if (s.ord < at.ord && s.state === "succeeded") saveStep(ctx.db, { ...s, runId: run.id, attempt: 1, idemKey: idemKeyFor(run.id, s.step, 1) });
  // the new run's start event came first; the retry link follows it
  emitRun(ctx, "run.retried", old.id, { newRunId: run.id, fromStep: from });
  return { runId: run.id };
}

export async function replay(ctx: RunsCtx, input: In): Promise<unknown> {
  const src = seeRun(ctx, input.runId);
  const version = (input.version as "same" | "current" | undefined) ?? "same";
  const run = newRun(ctx, {
    kind: "replay", name: src.name ? `Replay of ${src.name}` : undefined, owner: ctx.actingFor ?? ctx.principal.id, subject: src.subject,
    definitionVersion: version === "same" ? src.definitionVersion : undefined, parentRun: src.id,
  });
  patchExtra(ctx.db, run.id, clean({ replayOf: src.id, replayVersion: version }));
  return { runId: run.id };
}

// ---- reads ----

export async function get(ctx: RunsCtx, input: In): Promise<unknown> {
  return { run: (() => { const x = seeRun(ctx, input.runId); return runOut(x, readTrigger(ctx.db, x.id)); })() };
}
export async function list(ctx: RunsCtx, input: In): Promise<unknown> {
  const rows = listRuns(ctx, { scope: input.scope, ownerId: input.ownerId, subject: input.subject, kinds: input.kinds, statuses: input.statuses, since: input.since });
  const p = page(rows, input.cursor, input.limit);
  return clean({ runs: p.rows.map((x) => runOut(x, readTrigger(ctx.db, x.id))), next: p.next, total: p.total });
}
export async function steps(ctx: RunsCtx, input: In): Promise<unknown> {
  seeRun(ctx, input.runId);
  const p = page(allSteps(ctx.db, input.runId), input.cursor, input.limit);
  return clean({ steps: p.rows.map(stepOut), next: p.next, total: p.total });
}
export async function count(ctx: RunsCtx, input: In): Promise<unknown> {
  return { count: countRuns(ctx, input.scope, input.statuses) };
}
export async function status(ctx: RunsCtx): Promise<unknown> {
  const t0 = performance.now();
  const h = engineHealth(ctx.db, ctx.now());
  return clean({ state: h.state, detail: h.detail, latencyMs: Math.max(0, Math.round(performance.now() - t0)), queued: h.queued, stuck: h.stuck });
}

// ---- keys and the step log ----

export async function recordKey(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = seeRun(ctx, input.runId);
  return { run: ((x) => runOut(x, readTrigger(ctx.db, x.id)))(applyKey(ctx, run, input)) };
}
function applyKey(ctx: RunsCtx, run: Run, k: { step?: string; keyUsed: string; modelUsed?: string; fellBackFrom?: string; reason?: string }): Run {
  run.keyUsed = k.keyUsed;
  if (k.modelUsed !== undefined) run.modelUsed = k.modelUsed;
  touch(ctx, run);
  if (k.fellBackFrom !== undefined) emitRun(ctx, "run.key_fallback", run.id, clean({ step: k.step, fromKey: k.fellBackFrom, toKey: k.keyUsed, reason: k.reason ?? "The key was lost; the backup key took over." }));
  return run;
}

const sameRow = (a: StepRow, b: Omit<StepRow, "ord">): boolean =>
  a.state === b.state && a.branch === b.branch && a.inputRef === b.inputRef && a.outputRef === b.outputRef && a.error?.code === b.error?.code && a.error?.message === b.error?.message;

/** One row of the durable step log. Idempotent by (run, step, attempt): the same row twice is a no-op, a terminal row never goes back. */
export async function recordStep(ctx: RunsCtx, input: In): Promise<unknown> {
  const run = seeRun(ctx, input.runId);
  const next: Omit<StepRow, "ord"> = clean({
    runId: run.id, step: input.step, attempt: input.attempt, state: input.state as StepState, branch: input.branch, inputRef: input.inputRef, outputRef: input.outputRef,
    error: input.error, traceSpan: input.traceSpan, idemKey: idemKeyFor(run.id, input.step, input.attempt),
  });
  const have = findStep(ctx.db, run.id, input.step, input.attempt);
  if (have) {
    if (sameRow(have, next)) return { ok: true };
    // a step the Run's stop marked stopped may still report how it ended; every other finished step is final
    if (isTerminalStep(have.state) && have.state !== "stopped") raise(ctx, "validation.precondition_failed", "That step already finished; a retry is a new attempt.", { reason: "step_terminal", step: input.step, attempt: input.attempt, state: have.state });
  }
  if (!isActive(run.status) && !(run.status === "stopped" && isTerminalStep(next.state))) {
    raise(ctx, "validation.precondition_failed", "That run has finished.", { reason: "run_finished", status: run.status });
  }
  if (!have && countStepRows(ctx.db, run.id) >= HARD_STEP_ROWS) raise(ctx, "validation.too_large", "This run has more steps than a run may log.", { reason: "step_log_full", limit: HARD_STEP_ROWS });
  const now = ctx.now();
  saveStep(ctx.db, {
    ...next, ...(have ? { ord: have.ord } : {}), ...(have?.startedAt !== undefined ? { startedAt: have.startedAt } : next.state === "pending" ? {} : { startedAt: now }),
    ...(isTerminalStep(next.state) ? { endedAt: now } : {}), ...(have?.inputJson ? { inputJson: have.inputJson } : {}), ...(have?.outputJson ? { outputJson: have.outputJson } : {}),
  });
  if (run.status === "queued" && next.state === "running") { run.status = "running"; touch(ctx, run); } else if (isActive(run.status)) touch(ctx, run);
  return { ok: true };
}

// ---- waits: wait_for, wake, timeouts ----

export async function waitFor(ctx: RunsCtx, input: In): Promise<unknown> {
  const on = input.on as { event?: string; filter?: unknown; run?: string; at?: number };
  const timeout = parseDuration(ctx, input.timeout);
  if (on.run && !findRun(ctx.db, on.run)) raise(ctx, "validation.not_found", "The run to wait for does not exist.", { reason: "no_such_run" });
  const now = ctx.now();
  const run = newRun(ctx, { kind: "wait", name: input.label ?? describeOn(on), owner: ctx.actingFor ?? ctx.principal.id, subject: input.subject, threadId: input.threadId });
  run.status = "waiting";
  run.waitReason = "background";
  touch(ctx, run);
  saveWait(ctx.db, { runId: run.id, reason: "background", on, untilAt: now + timeout, createdAt: now, ...(input.label ? { label: input.label } : {}) });
  emitRun(ctx, "run.waiting", run.id, { reason: "background", on: describeOn(on) });
  // waiting for a Run that already ended is a match: the next sweep ends the wait (a capability may only emit the events it declares)
  return { runId: run.id };
}

const RUN_ENDED = new Set(["run.succeeded", "run.failed", "run.stopped"]);

function matches(w: WaitRow, ev: { type: string; payload: unknown }): boolean {
  const on = w.on as { event?: string; filter?: Record<string, unknown>; run?: string } | undefined;
  if (on && typeof on.run === "string") return RUN_ENDED.has(ev.type) && (ev.payload as { runId?: unknown } | null)?.runId === on.run;
  if (!on || typeof on.event !== "string") return false;
  if (on.event !== ev.type && !(on.event.endsWith(".*") && ev.type.startsWith(on.event.slice(0, -1)))) return false;
  if (on.filter && typeof on.filter === "object") {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(on.filter)) if (JSON.stringify(p[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

/** The Run is parked by a step of its plan (drive wrote that step as waiting), not by runs.mark_waiting. */
function inStepWait(ctx: RunsCtx, run: Run): boolean {
  const rows = allSteps(ctx.db, run.id);
  return rows.length > 0 && rows[rows.length - 1]!.state === "waiting";
}

async function endWait(ctx: RunsCtx, run: Run, summary: string, timedOut: boolean): Promise<void> {
  if (run.kind === "wait") { await finishRun(ctx, run, "succeeded", { summary }); return; }
  // a Wait step that times out is resumed; the step reads the clock and ends with resumedBy timeout, so the Run goes on
  if (timedOut && !inStepWait(ctx, run)) { await finishRun(ctx, run, "failed", { summary, error: { code: "run.wait_timeout", message: summary } }); return; }
  resumeRun(ctx, run);
}

/** The event consumer for waiting Runs: a matching event wakes the Run; a cancel-on event stops it. Call once per event from the trigger consumer. */
export async function wake(ctx: RunsCtx, ev: { type: string; payload?: unknown }): Promise<string[]> {
  const woken: string[] = [];
  for (const w of allWaits(ctx.db)) {
    const run = findRun(ctx.db, w.runId);
    if (!run || run.status !== "waiting") continue;
    const cancel = w.cancelOn as { events?: string[] } | string[] | undefined;
    const cancelEvents = Array.isArray(cancel) ? cancel : cancel?.events;
    if (cancelEvents?.includes(ev.type)) { await finishRun(ctx, run, "stopped", { by: "system", reason: `Canceled by ${ev.type}.` }); continue; }
    if (matches(w, { type: ev.type, payload: ev.payload })) {
      const on = w.on as { run?: string } | undefined;
      await endWait(ctx, run, on?.run ? `Run ${on.run} ${ev.type.slice("run.".length)}.` : `Matched ${ev.type}.`, false);
      woken.push(run.id);
    }
  }
  return woken;
}
/** The clock consumer: ends waits whose time came, waits on a Run that has ended, and waits past their timeout. Returns the Runs it ended. */
export async function sweepWaits(ctx: RunsCtx): Promise<string[]> {
  const now = ctx.now();
  const done: string[] = [];
  for (const w of allWaits(ctx.db)) {
    const run = findRun(ctx.db, w.runId);
    if (!run || run.status !== "waiting") continue;
    const on = w.on as { at?: number; run?: string } | undefined;
    const target = on?.run ? findRun(ctx.db, on.run) : undefined;
    if (target && !isActive(target.status)) { await endWait(ctx, run, `Run ${target.id} ${target.status}.`, false); done.push(run.id); continue; }
    if (on?.at !== undefined && on.at <= now) { await endWait(ctx, run, "The time came.", false); done.push(run.id); continue; }
    if (w.untilAt !== undefined && w.untilAt <= now) { await endWait(ctx, run, `Timed out waiting${w.label ? ` for ${w.label}` : ""}.`, true); done.push(run.id); }
  }
  return done;
}

// ---- the engine ----

export interface RetryPolicy { max: number; backoff: "none" | "linear" | "exp"; baseMs: number }
export const NO_RETRY: RetryPolicy = { max: 0, backoff: "none", baseMs: 0 };
const BACKOFF_CAP_MS = 3_600_000;
/** Delay before attempt+1 after attempt failed: none 0, linear base*attempt, exp base*2^(attempt-1), capped at an hour. */
export function backoffMs(p: RetryPolicy, attempt: number): number {
  if (p.backoff === "none") return 0;
  const raw = p.backoff === "linear" ? p.baseMs * attempt : p.baseMs * 2 ** (attempt - 1);
  return Math.min(BACKOFF_CAP_MS, Math.max(0, Math.round(raw)));
}

export interface PlanStep {
  id: string;
  branch?: string;
  input?: unknown;
  retry?: RetryPolicy;
  effects?: "read" | "write" | "outward";
  /** output a sandbox records instead of running an outward step (StepDef.sample) */
  sample?: unknown;
}
export interface StepResult {
  output?: unknown;
  /** the step to run next; null ends the Run; absent means the next step of the plan */
  next?: string | null;
  /** park the Run: the step continues when the Run is resumed */
  wait?: StepWait;
}
/** What a step asks the engine to park the Run on. `on` is the label; the rest is registered on the wait row so the event and clock consumers can end it. */
export interface StepWait {
  reason: WaitReason;
  taskId?: string;
  on?: string;
  /** wake at this time */
  at?: number;
  /** wake on this event */
  event?: { event: string; filter?: unknown };
  /** give up at this time: the step is called again and ends with resumedBy timeout (the Run does not fail) */
  timeoutAt?: number;
  /** events that cancel the wait and stop the Run */
  cancelOn?: string[];
}
export interface StepCall {
  attempt: number;
  /** run:step:attempt, the idempotency key to hand to the capability */
  key: string;
  input: unknown;
  /** results of the steps that already succeeded, by step id */
  outputs: Readonly<Record<string, unknown>>;
  sandbox: boolean;
  /** the step is continuing after a wait or a crash */
  resumed: boolean;
  /** when this step first started; kept across waits and crashes so a Wait can tell a time that came from a timeout */
  startedAt: number;
}
export type Executor = (step: PlanStep, call: StepCall) => Promise<StepResult>;
export interface DriveOptions {
  /** a ceiling on step rows in one drive of one Run (loops); default 500 */
  maxSteps?: number;
  /** wait in-process for a retry delay; without it drive returns {retryAt} and the scheduler calls it again */
  sleep?: (ms: number) => Promise<void>;
  /** the key to fall to when the first one is lost (provider.auth_failed) */
  backupKey?: string;
  summary?: (steps: number) => string;
}
export interface DriveResult { status: RunStatus; retryAt?: number; failedStep?: string }

const KEY_LOST = /^(provider\.auth_failed|key\.lost)$/;
interface Caught { code: string; message: string; retryable: boolean }
function caught(e: unknown): Caught {
  const he = (e as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null)?.error;
  if (he && typeof he.code === "string") return { code: he.code, message: typeof he.message === "string" ? he.message : he.code, retryable: he.retryable !== false };
  const m = (e as { message?: unknown } | null)?.message;
  return { code: "step.failed", message: typeof m === "string" && m ? m : "The step failed.", retryable: true };
}
const parseJson = (s: string | undefined): unknown => { if (s === undefined) return undefined; try { return JSON.parse(s); } catch { return undefined; } };

/** Recorded outputs of the Run a replay copies, by step. */
function recordedOutputs(db: Db, runId: string): Record<string, unknown> {
  const src = readExtra(db, runId).replayOf;
  const out: Record<string, unknown> = {};
  if (!src) return out;
  for (const s of latestSteps(db, src)) if (s.state === "succeeded") out[s.step] = parseJson(s.outputJson);
  return out;
}

/**
 * Run a plan of steps to its end, a wait, a pending retry or a failure.
 * - Every attempt is a row in the step log, written running before the executor is called and succeeded or failed after it.
 * - Resume: succeeded and skipped steps are walked past using their stored results and their stored `next`; the first other step runs. A step found `running` (a crash)
 *   runs again as the same attempt with the same key; a `failed` step with a retry time runs as the next attempt once the time has come; a `waiting` step continues as the same attempt.
 * - Sandboxes (test mode, replay) record outward steps (and, in replay, writes) from the recorded or sample output instead of running them.
 * - Stop is read before every step: a stopped Run does not start another.
 */
export async function drive(ctx: RunsCtx, runId: string, plan: readonly PlanStep[], exec: Executor, opts: DriveOptions = {}): Promise<DriveResult> {
  const maxSteps = opts.maxSteps ?? 500;
  const byId = new Map(plan.map((p) => [p.id, p] as const));
  let run = findRun(ctx.db, runId);
  if (!run) raise(ctx, "permission.not_found", "That run is not available.");
  if (!isActive(run.status)) return { status: run.status };
  if (run.status === "waiting") return { status: "waiting" };
  if (run.status === "queued") { run.status = "running"; touch(ctx, run); }
  const sandbox = isSandbox(run.kind);
  const replaying = run.kind === "replay";
  const recorded = replaying ? recordedOutputs(ctx.db, runId) : {};
  const outputs: Record<string, unknown> = {};
  let cur: string | undefined = plan[0]?.id;
  let executed = 0;
  let fellBack = false;
  const visited = new Set<string>();
  let lastCur: string | undefined;

  while (cur !== undefined) {
    run = findRun(ctx.db, runId)!;
    if (run.status === "stopped") return { status: "stopped" };
    if (run.status === "waiting") return { status: "waiting" };
    if (!isActive(run.status)) return { status: run.status };
    // a loop enters a step again as `id#2`, `id#3`: its own rows, the definition of `id`
    const base = cur.replace(/#\d+$/, "");
    const step = byId.get(cur) ?? byId.get(base);
    if (!step) return failRun(ctx, run, { code: "run.unknown_step", message: `The plan has no step ${cur}.`, step: cur });
    const idx = plan.findIndex((p) => p.id === step.id);
    if (cur !== lastCur && visited.has(cur)) return failRun(ctx, run, { code: "run.cycle", message: `The run came back to ${cur}; a loop must enter a step as ${base}#2.`, step: cur });
    visited.add(cur);
    lastCur = cur;
    const rows = allSteps(ctx.db, runId).filter((s) => s.step === cur);
    const last = rows[rows.length - 1];

    if (last && (last.state === "succeeded" || last.state === "skipped")) {
      outputs[cur] = parseJson(last.outputJson);
      cur = last.nextStep === undefined ? plan[idx + 1]?.id : last.nextStep ?? undefined;
      continue;
    }
    if (executed >= maxSteps) return failRun(ctx, run, { code: "run.step_cap", message: `The run went past ${maxSteps} steps and was stopped.`, step: cur });

    let attempt = 1;
    let resumed = false;
    if (last) {
      if (last.state === "failed") {
        if (last.retryAt === undefined) return failRun(ctx, run, { code: last.error?.code ?? "step.failed", message: last.error?.message ?? "The step failed.", step: cur });
        attempt = last.attempt + 1;
        const wait = last.retryAt - ctx.now();
        if (wait > 0) {
          if (!opts.sleep) return { status: "running", retryAt: last.retryAt };
          await opts.sleep(wait);
        }
      } else { attempt = last.attempt; resumed = true; }
    }
    const key = idemKeyFor(runId, cur, attempt);
    const startedAt = last?.startedAt !== undefined && resumed ? last.startedAt : ctx.now();
    const inputJson = JSON.stringify(step.input ?? null);
    saveStep(ctx.db, {
      runId, step: cur, attempt, state: "running", inputRef: `in:${key}`, inputJson, idemKey: key, startedAt,
      traceSpan: resumed && last?.traceSpan ? last.traceSpan : newSpanId(),
      ...(step.branch !== undefined ? { branch: step.branch } : {}), ...(last ? { ord: last.ord } : {}),
    });
    touch(ctx, run);
    executed += 1;

    let result: StepResult;
    try {
      const stubbed = sandbox && (step.effects === "outward" || (replaying && step.effects === "write"));
      if (stubbed) result = { output: step.id in recorded ? recorded[step.id] : step.sample };
      else result = await exec(step, { attempt, key, input: step.input, outputs: { ...outputs }, sandbox, resumed, startedAt });
    } catch (e) {
      const c = caught(e);
      const policy = step.retry ?? NO_RETRY;
      run = findRun(ctx.db, runId)!;
      if (KEY_LOST.test(c.code) && !isSandbox(run.kind)) {
        // a lost key falls to the backup key once, then the Run waits in Needs you; it never fails silently
        if (opts.backupKey && !fellBack && run.keyUsed !== opts.backupKey) {
          fellBack = true;
          applyKey(ctx, run, { step: cur, keyUsed: opts.backupKey, fellBackFrom: run.keyUsed ?? "unknown", reason: c.message });
          saveStep(ctx.db, { ...rowOf(ctx.db, runId, cur, attempt), state: "failed", error: { code: c.code, message: c.message }, retryAt: ctx.now(), endedAt: ctx.now() });
          continue;
        }
        saveStep(ctx.db, { ...rowOf(ctx.db, runId, cur, attempt), state: "waiting" });
        await markWaiting(ctx, run, { reason: "key", on: "a working key" });
        return { status: "waiting" };
      }
      if (c.retryable && attempt <= policy.max) {
        const retryAt = ctx.now() + backoffMs(policy, attempt);
        saveStep(ctx.db, { ...rowOf(ctx.db, runId, cur, attempt), state: "failed", error: { code: c.code, message: c.message }, retryAt, endedAt: ctx.now() });
        continue;
      }
      saveStep(ctx.db, { ...rowOf(ctx.db, runId, cur, attempt), state: "failed", error: { code: c.code, message: c.message }, endedAt: ctx.now() });
      return failRun(ctx, run, { code: c.code, message: c.message, step: cur });
    }

    run = findRun(ctx.db, runId)!;
    if (result.wait) {
      saveStep(ctx.db, { ...rowOf(ctx.db, runId, cur, attempt), state: "waiting" });
      if (isActive(run.status) && run.status !== "waiting") await markWaiting(ctx, run, { reason: result.wait.reason, taskId: result.wait.taskId, on: result.wait.on, wait: waitExtras(result.wait) });
      return { status: "waiting" };
    }
    const outputJson = result.output === undefined ? undefined : JSON.stringify(result.output);
    saveStep(ctx.db, {
      ...rowOf(ctx.db, runId, cur, attempt), state: "succeeded", outputRef: `out:${key}`, ...(outputJson !== undefined ? { outputJson } : {}),
      ...(result.next !== undefined ? { nextStep: result.next } : {}), endedAt: ctx.now(),
    });
    outputs[cur] = result.output;
    cur = result.next === undefined ? plan[idx + 1]?.id : result.next ?? undefined;
  }

  run = findRun(ctx.db, runId)!;
  if (run.status === "stopped") return { status: "stopped" };
  const n = latestSteps(ctx.db, runId).filter((s) => s.state === "succeeded").length;
  await finishRun(ctx, run, "succeeded", { summary: opts.summary ? opts.summary(n) : `${n} step${n === 1 ? "" : "s"} done` });
  return { status: "succeeded" };
}

/** The parts of a step's wait that the consumers read: what to wake on (`on`), when to give up (`untilAt`) and what cancels it. */
function waitExtras(w: StepWait): Partial<WaitRow> {
  const on = clean({ event: w.event?.event, filter: w.event?.filter, at: w.at });
  return clean({
    ...(Object.keys(on).length ? { on } : {}), untilAt: w.timeoutAt, cancelOn: w.cancelOn && w.cancelOn.length ? w.cancelOn : undefined,
  }) as Partial<WaitRow>;
}
function rowOf(db: Db, runId: string, step: string, attempt: number): StepRow {
  const r = findStep(db, runId, step, attempt);
  if (!r) throw new Error(`step row ${runId}:${step}:${attempt} is missing`);
  return r;
}
async function failRun(ctx: RunsCtx, run: Run, e: { code: string; message: string; step: string }): Promise<DriveResult> {
  await finishRun(ctx, run, "failed", { summary: e.message, error: e });
  return { status: "failed", failedStep: e.step };
}

/** Runs that were queued or running when the host stopped. The host scheduler calls `recoverRuns` at start; each is driven again from its step log. */
export function interrupted(db: Db): string[] {
  return (db.all("SELECT id FROM runs_items WHERE status IN ('queued', 'running') AND deleted_at IS NULL ORDER BY started_at ASC, id ASC") as { id: string }[]).map((r) => r.id);
}
export type Resolver = (run: Run) => { plan: readonly PlanStep[]; exec: Executor; opts?: DriveOptions } | undefined;
export async function recoverRuns(ctx: RunsCtx, resolve: Resolver): Promise<Record<string, DriveResult>> {
  const out: Record<string, DriveResult> = {};
  for (const id of interrupted(ctx.db)) {
    const run = findRun(ctx.db, id)!;
    const r = resolve(run);
    if (r) out[id] = await drive(ctx, id, r.plan, r.exec, r.opts);
  }
  return out;
}

