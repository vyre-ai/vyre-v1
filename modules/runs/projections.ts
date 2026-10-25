// Runs projections (ARCH 4.7, 7.7). The Run row (runs_items), its durable step log (runs_steps), waits, facts the row has no column for (runs_extra)
// and the read queries behind runs.list, runs.get, runs.steps, runs.count and runs.status.
// Durable tables: generated/modules/runs/schema.sql plus migrations/0001_runs_engine.sql. Every statement names only runs_* tables (ctx.db refuses anything else, ARCH B2).
import { fail } from "../../host/src/routes/errors.ts";
import { makeId } from "../../packages/contracts/src/ids.ts";

export type RunKind = "automation" | "automation_test" | "journey" | "journey_migrate" | "routine" | "campaign" | "deployment" | "runbook" | "wait" | "terminal" | "replay" | "other";
export type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "stopped";
export type WaitReason = "approval" | "background" | "key";
export type StepState = "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting" | "stopped";
export interface ResourceRef { type: string; id: string }
export interface StepError { code: string; message: string }

export const RUN_KINDS: readonly RunKind[] = ["automation", "automation_test", "journey", "journey_migrate", "routine", "campaign", "deployment", "runbook", "wait", "terminal", "replay", "other"];
export const ACTIVE: readonly RunStatus[] = ["queued", "running", "waiting"];
export const isActive = (s: RunStatus): boolean => s === "queued" || s === "running" || s === "waiting";
export const isTerminalStep = (s: StepState): boolean => s === "succeeded" || s === "failed" || s === "skipped" || s === "stopped";
/** More step rows than this on one Run is a runaway loop. The step cap is the engine's (runs.record_step has no cap field); this is the hard floor under it. */
export const HARD_STEP_ROWS = 5000;
/** Default wait timeout: 30 days (spec runs.wait_for). */
export const DEFAULT_WAIT_MS = 30 * 86_400_000;

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts { idempotencyKey?: string; vis?: string; cause?: string }
export interface RunsCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  device?: string;
  run?: string;
  thread?: string;
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: EmitOpts): { id: string };
  call?(cap: string, input: unknown): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
}

export interface Run {
  id: string;
  kind: RunKind;
  name?: string;
  owner: string;
  startedBy: string;
  subject?: ResourceRef;
  status: RunStatus;
  waitReason?: WaitReason;
  definitionVersion?: number;
  keyUsed?: string;
  modelUsed?: string;
  costMicros: number;
  startedAt: number;
  endedAt?: number;
  parentRun?: string;
  threadId?: string;
  traceId: string;
  summary?: string;
  version: number;
  updatedAt: number;
}
export interface Extra {
  errorCode?: string; errorMessage?: string; errorStep?: string; stopReason?: string; stoppedBy?: string;
  retryOf?: string; fromStep?: string; replayOf?: string; replayVersion?: string; undoneAt?: number; consecutive?: number;
}
export interface StepRow {
  runId: string; step: string; attempt: number; ord: number; state: StepState; branch?: string; inputRef?: string; outputRef?: string;
  inputJson?: string; outputJson?: string; error?: StepError; idemKey: string; retryAt?: number; nextStep?: string | null; startedAt?: number; endedAt?: number; traceSpan?: string;
}
export interface WaitRow { runId: string; reason: string; on?: unknown; cancelOn?: unknown; untilAt?: number; taskId?: string; label?: string; createdAt: number }

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}

/** Drop undefined keys so payloads and rows stay valid under exactOptionalPropertyTypes and the JSON schemas. */
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
export const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
const js = (v: unknown): string => JSON.stringify(v);

export function newRunId(): string { return makeId("run", globalThis.crypto.getRandomValues(new Uint8Array(14))); }
/** A span id: 8 random bytes in hex (ARCH 4.9). */
export function newSpanId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function newThreadId(): string { return makeId("thr", globalThis.crypto.getRandomValues(new Uint8Array(14))); }

// ---- the Run row ----

type Raw = Record<string, unknown>;

function rowToRun(r: Raw): Run {
  const run: Run = {
    id: r.id as string, kind: r.kind as RunKind, owner: r.owner as string, startedBy: (str(r.started_by) ?? r.owner) as string,
    status: r.status as RunStatus, costMicros: num(r.cost_micros) ?? 0, startedAt: num(r.started_at) ?? 0, traceId: (str(r.trace_id) ?? "") as string,
    version: num(r.version) ?? 0, updatedAt: num(r.updated_at) ?? 0,
  };
  const name = str(r.name); if (name !== undefined) run.name = name;
  const subject = json<ResourceRef | null>(r.subject, null); if (subject) run.subject = subject;
  const wr = str(r.wait_reason); if (wr !== undefined) run.waitReason = wr as WaitReason;
  const dv = num(r.definition_version); if (dv !== undefined) run.definitionVersion = dv;
  const key = str(r.key_used); if (key !== undefined) run.keyUsed = key;
  const model = str(r.model_used); if (model !== undefined) run.modelUsed = model;
  const ended = num(r.ended_at); if (ended !== undefined) run.endedAt = ended;
  const parent = str(r.parent_run); if (parent !== undefined) run.parentRun = parent;
  const thread = str(r.thread_id); if (thread !== undefined) run.threadId = thread;
  const summary = str(r.summary); if (summary !== undefined) run.summary = summary;
  return run;
}

export function saveRun(db: Db, r: Run): void {
  db.run(
    `INSERT OR REPLACE INTO runs_items (id, kind, name, owner, started_by, subject, status, wait_reason, definition_version, key_used, model_used, cost_micros,
       started_at, ended_at, parent_run, thread_id, trace_id, summary, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    r.id, r.kind, nul(r.name), r.owner, r.startedBy, r.subject ? js(r.subject) : null, r.status, nul(r.waitReason), nul(r.definitionVersion), nul(r.keyUsed),
    nul(r.modelUsed), r.costMicros, r.startedAt, nul(r.endedAt), nul(r.parentRun), nul(r.threadId), r.traceId, nul(r.summary), r.version, r.updatedAt,
  );
}
export function findRun(db: Db, id: string): Run | undefined {
  const rows = db.all("SELECT * FROM runs_items WHERE id = ? AND deleted_at IS NULL", id) as Raw[];
  return rows[0] ? rowToRun(rows[0]) : undefined;
}
export function getRun(ctx: RunsCtx, id: string): Run {
  const r = findRun(ctx.db, id);
  if (!r) raise(ctx, "permission.not_found", "That run is not available.");
  return r;
}
/** Bump version and updatedAt, then write. */
export function touch(ctx: RunsCtx, r: Run): Run {
  r.updatedAt = ctx.now();
  r.version += 1;
  saveRun(ctx.db, r);
  return r;
}

/** The contract's runRow. */
export interface RunTrigger { messageId: string; threadId: string; channelId?: string }
export function readTrigger(db: Db, runId: string): RunTrigger | undefined {
  const r = (db.all("SELECT * FROM runs_trigger WHERE run_id = ?", runId) as Raw[])[0];
  if (!r) return undefined;
  return clean({ messageId: String(r.message_id), threadId: String(r.thread_id), channelId: r.channel_id === null || r.channel_id === undefined ? undefined : String(r.channel_id) }) as RunTrigger;
}
export function runOut(r: Run, trigger?: RunTrigger): Record<string, unknown> {
  return clean({
    id: r.id, kind: r.kind, name: r.name, owner: r.owner, startedBy: r.startedBy, subject: r.subject, status: r.status, waitReason: r.waitReason,
    definitionVersion: r.definitionVersion, keyUsed: r.keyUsed, modelUsed: r.modelUsed, costMicros: r.costMicros, startedAt: r.startedAt, endedAt: r.endedAt,
    parentRun: r.parentRun, threadId: r.threadId, traceId: r.traceId, summary: r.summary, trigger,
  });
}

// ---- extras ----

export function readExtra(db: Db, runId: string): Extra {
  const r = (db.all("SELECT * FROM runs_extra WHERE run_id = ?", runId) as Raw[])[0];
  if (!r) return {};
  return clean({
    errorCode: str(r.error_code), errorMessage: str(r.error_message), errorStep: str(r.error_step), stopReason: str(r.stop_reason), stoppedBy: str(r.stopped_by),
    retryOf: str(r.retry_of), fromStep: str(r.from_step), replayOf: str(r.replay_of), replayVersion: str(r.replay_version), undoneAt: num(r.undone_at), consecutive: num(r.consecutive),
  }) as Extra;
}
export function patchExtra(db: Db, runId: string, patch: Extra): void {
  const cur = readExtra(db, runId);
  const e = { ...cur, ...patch };
  db.run(
    `INSERT OR REPLACE INTO runs_extra (run_id, error_code, error_message, error_step, stop_reason, stopped_by, retry_of, from_step, replay_of, replay_version, undone_at, consecutive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId, nul(e.errorCode), nul(e.errorMessage), nul(e.errorStep), nul(e.stopReason), nul(e.stoppedBy), nul(e.retryOf), nul(e.fromStep), nul(e.replayOf),
    nul(e.replayVersion), nul(e.undoneAt), nul(e.consecutive),
  );
}

// ---- the durable step log ----

function rowToStep(r: Raw): StepRow {
  const s: StepRow = {
    runId: r.run_id as string, step: r.step as string, attempt: num(r.attempt) ?? 1, ord: num(r.ord) ?? 0, state: r.state as StepState, idemKey: r.idem_key as string,
  };
  const branch = str(r.branch); if (branch !== undefined) s.branch = branch;
  const iref = str(r.input_ref); if (iref !== undefined) s.inputRef = iref;
  const oref = str(r.output_ref); if (oref !== undefined) s.outputRef = oref;
  const ij = str(r.input_json); if (ij !== undefined) s.inputJson = ij;
  const oj = str(r.output_json); if (oj !== undefined) s.outputJson = oj;
  const ec = str(r.error_code);
  if (ec !== undefined) s.error = { code: ec, message: str(r.error_message) ?? "" };
  const retry = num(r.retry_at); if (retry !== undefined) s.retryAt = retry;
  if (num(r.ended_next) === 1) s.nextStep = str(r.next_step) ?? null;
  const st = num(r.started_at); if (st !== undefined) s.startedAt = st;
  const en = num(r.ended_at); if (en !== undefined) s.endedAt = en;
  const span = str(r.trace_span); if (span !== undefined) s.traceSpan = span;
  return s;
}
export const idemKeyFor = (runId: string, step: string, attempt: number): string => `${runId}:${step}:${attempt}`;

/** Every attempt of every step, in step order then attempt order. */
export function allSteps(db: Db, runId: string): StepRow[] {
  return (db.all("SELECT * FROM runs_steps WHERE run_id = ? ORDER BY ord ASC, attempt ASC", runId) as Raw[]).map(rowToStep);
}
export function findStep(db: Db, runId: string, step: string, attempt: number): StepRow | undefined {
  const r = (db.all("SELECT * FROM runs_steps WHERE run_id = ? AND step = ? AND attempt = ?", runId, step, attempt) as Raw[])[0];
  return r ? rowToStep(r) : undefined;
}
/** The newest attempt of each step, in the order the steps were first seen. */
export function latestSteps(db: Db, runId: string): StepRow[] {
  const by = new Map<string, StepRow>();
  for (const s of allSteps(db, runId)) by.set(s.step, s);   // attempts ascend, so the last write wins
  return [...by.values()].sort((a, b) => a.ord - b.ord);
}
export function countStepRows(db: Db, runId: string): number {
  return Number(((db.all("SELECT COUNT(*) AS n FROM runs_steps WHERE run_id = ?", runId) as Raw[])[0]?.n) ?? 0);
}
function ordFor(db: Db, runId: string, step: string): number {
  const have = (db.all("SELECT ord FROM runs_steps WHERE run_id = ? AND step = ? LIMIT 1", runId, step) as Raw[])[0];
  if (have) return num(have.ord) ?? 0;
  const max = (db.all("SELECT MAX(ord) AS m FROM runs_steps WHERE run_id = ?", runId) as Raw[])[0];
  return (num(max?.m) ?? -1) + 1;
}
export function saveStep(db: Db, s: Omit<StepRow, "ord"> & { ord?: number }): StepRow {
  const ord = s.ord ?? ordFor(db, s.runId, s.step);
  db.run(
    `INSERT OR REPLACE INTO runs_steps (run_id, step, attempt, ord, state, branch, input_ref, output_ref, input_json, output_json, error_code, error_message,
       idem_key, retry_at, started_at, ended_at, trace_span, next_step, ended_next) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.runId, s.step, s.attempt, ord, s.state, nul(s.branch), nul(s.inputRef), nul(s.outputRef), nul(s.inputJson), nul(s.outputJson), nul(s.error?.code),
    nul(s.error?.message), s.idemKey, nul(s.retryAt), nul(s.startedAt), nul(s.endedAt), nul(s.traceSpan),
    s.nextStep ? s.nextStep : null, s.nextStep === undefined ? 0 : 1,
  );
  return { ...s, ord };
}
/** The contract's stepRow. */
export function stepOut(s: StepRow): Record<string, unknown> {
  return clean({
    step: s.step, attempt: s.attempt, state: s.state, branch: s.branch, inputRef: s.inputRef, outputRef: s.outputRef, error: s.error,
    startedAt: s.startedAt, endedAt: s.endedAt, traceSpan: s.traceSpan,
  });
}

// ---- waits ----

export function readWait(db: Db, runId: string): WaitRow | undefined {
  const r = (db.all("SELECT * FROM runs_waits WHERE run_id = ?", runId) as Raw[])[0];
  if (!r) return undefined;
  const w: WaitRow = { runId: r.run_id as string, reason: r.reason as string, createdAt: num(r.created_at) ?? 0 };
  const on = json<unknown>(r.on_json, undefined); if (on !== undefined) w.on = on;
  const cancel = json<unknown>(r.cancel_on, undefined); if (cancel !== undefined) w.cancelOn = cancel;
  const until = num(r.until_at); if (until !== undefined) w.untilAt = until;
  const task = str(r.task_id); if (task !== undefined) w.taskId = task;
  const label = str(r.label); if (label !== undefined) w.label = label;
  return w;
}
export function saveWait(db: Db, w: WaitRow): void {
  db.run(
    "INSERT OR REPLACE INTO runs_waits (run_id, reason, on_json, cancel_on, until_at, task_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    w.runId, w.reason, w.on === undefined ? null : js(w.on), w.cancelOn === undefined ? null : js(w.cancelOn), nul(w.untilAt), nul(w.taskId), nul(w.label), w.createdAt,
  );
}
export function clearWait(db: Db, runId: string): void { db.run("DELETE FROM runs_waits WHERE run_id = ?", runId); }
export function allWaits(db: Db): WaitRow[] {
  return (db.all("SELECT run_id FROM runs_waits ORDER BY created_at ASC, run_id ASC") as Raw[]).map((r) => readWait(db, r.run_id as string)!).filter(Boolean);
}

// ---- who may see and manage ----

const isService = (ctx: RunsCtx): boolean => ctx.principal.kind === "service";
export function isOwner(ctx: RunsCtx, r: Pick<Run, "owner">): boolean { return r.owner === ctx.principal.id || (ctx.actingFor !== undefined && r.owner === ctx.actingFor); }
/** Manage on a Run: its owner, a service caller (engine, Gate), or a holder of the `runs.manage` role permission. */
export function mayManage(ctx: RunsCtx, r: Pick<Run, "id" | "owner">): boolean {
  if (isService(ctx) || isOwner(ctx, r)) return true;
  return !!ctx.authorize && ctx.authorize({ perm: "runs.manage", level: "manage" }, { type: "run", id: r.id }).effect === "allow";
}
/** The owner, the starter, a Manage holder, or anyone the kernel lets view the Run (a Run follows the access of its subject). */
export function canSee(ctx: RunsCtx, r: Pick<Run, "id" | "owner" | "startedBy">): boolean {
  if (mayManage(ctx, r) || r.startedBy === ctx.principal.id) return true;
  return !!ctx.authorize && ctx.authorize({ perm: null, level: "view" }, { type: "run", id: r.id }).effect === "allow";
}
export function seeRun(ctx: RunsCtx, id: string): Run {
  const r = getRun(ctx, id);
  if (!canSee(ctx, r)) raise(ctx, "permission.not_found", "That run is not available.");
  return r;
}
export function manageRun(ctx: RunsCtx, id: string): Run {
  const r = seeRun(ctx, id);
  if (!mayManage(ctx, r)) raise(ctx, "permission.role_lacks_permission", "Only the owner or someone who manages runs can do that.", { reason: "manage_required" });
  return r;
}

// ---- events ----

export function emitRun(ctx: RunsCtx, name: string, runId: string, payload: Record<string, unknown>): string {
  return ctx.emit(name, `run/${runId}`, clean({ runId, ...payload }), { vis: "participants" }).id;
}

// ---- queries ----

export interface ListFilter { scope: "mine" | "subject" | "owner" | "all"; ownerId?: string | undefined; subject?: ResourceRef | undefined; kinds?: readonly string[] | undefined; statuses?: readonly string[] | undefined; since?: number | undefined }

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

function sqlFilter(f: Pick<ListFilter, "kinds" | "statuses" | "since">): { where: string; args: unknown[] } {
  const parts: string[] = ["deleted_at IS NULL"];
  const args: unknown[] = [];
  if (f.kinds && f.kinds.length) { parts.push(`kind IN (${f.kinds.map(() => "?").join(", ")})`); args.push(...f.kinds); }
  if (f.statuses && f.statuses.length) { parts.push(`status IN (${f.statuses.map(() => "?").join(", ")})`); args.push(...f.statuses); }
  if (f.since !== undefined) { parts.push("started_at >= ?"); args.push(f.since); }
  return { where: parts.join(" AND "), args };
}

/** Runs the caller may see, newest first. mine = owned by me; owner = one person's (Manage holders); subject = on one object; all = Manage holders and the Console. */
export function listRuns(ctx: RunsCtx, f: ListFilter): Run[] {
  const { where, args } = sqlFilter(f);
  const rows = (ctx.db.all(`SELECT * FROM runs_items WHERE ${where} ORDER BY started_at DESC, id DESC`, ...args) as Raw[]).map(rowToRun);
  const me = (id: string): boolean => id === ctx.principal.id || id === ctx.actingFor;
  switch (f.scope) {
    case "mine": return rows.filter((r) => me(r.owner));
    case "owner": {
      const target = f.ownerId ?? ctx.principal.id;
      return rows.filter((r) => r.owner === target && (me(target) || mayManage(ctx, r)));
    }
    case "subject": {
      const s = f.subject;
      if (!s) return [];
      return rows.filter((r) => r.subject?.type === s.type && r.subject.id === s.id && canSee(ctx, r));
    }
    default: {
      if (!isService(ctx) && !holdsAll(ctx)) raise(ctx, "permission.role_lacks_permission", "Only people who manage runs can list every run.", { reason: "manage_required" });
      return rows;
    }
  }
}
function holdsAll(ctx: RunsCtx): boolean {
  return !!ctx.authorize && ctx.authorize({ perm: "runs.manage", level: "manage" }, { type: "run", id: null }).effect === "allow";
}
/** Counts for badges. mine = owned by me; all needs Manage. */
export function countRuns(ctx: RunsCtx, scope: "mine" | "all", statuses?: readonly string[]): number {
  return listRuns(ctx, { scope, statuses }).length;
}
export interface Health { state: "healthy" | "degraded" | "down"; detail?: string; queued: number; stuck: number }
/** A Run is stuck when it has run for this long without a step row changing. */
export const STUCK_MS = 15 * 60_000;
export function engineHealth(db: Db, now: number): Health {
  const q = (db.all("SELECT COUNT(*) AS n, MIN(started_at) AS oldest FROM runs_items WHERE status = 'queued' AND deleted_at IS NULL") as Raw[])[0];
  const queued = Number(q?.n ?? 0);
  const running = db.all("SELECT id, updated_at FROM runs_items WHERE status = 'running' AND deleted_at IS NULL") as Raw[];
  const stuck = running.filter((r) => now - (num(r.updated_at) ?? now) > STUCK_MS).length;
  const oldest = num(q?.oldest);
  const lag = oldest === undefined ? 0 : now - oldest;
  const h: Health = { state: stuck > 0 || lag > STUCK_MS ? "degraded" : "healthy", queued, stuck };
  if (h.state === "degraded") h.detail = stuck > 0 ? `${stuck} run${stuck === 1 ? "" : "s"} stopped moving` : "The oldest queued run has waited over 15 minutes.";
  return h;
}
