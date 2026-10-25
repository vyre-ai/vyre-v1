// Tasks projections (ARCH 4.7). The task row (tasks_core + tasks_meta), its history, the Space policy and the read queries behind
// tasks.get, tasks.list, tasks.needs_you, tasks.count_needs_you, tasks.my_work and tasks.history.
// Durable tables: migrations/0001_tasks_state.sql. Every statement names only tasks_* tables (ctx.db refuses anything else, ARCH B2).
import { fail } from "../../host/src/routes/errors.ts";
import { makeId } from "../../packages/contracts/src/ids.ts";

export type TaskKind = "work" | "approve" | "review" | "answer" | "unblock" | "signature";
export type TaskState = "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
export type Slot = "assigned" | "reviewer" | "approver";
export type AssigneeKind = "person" | "agent" | "group" | "role" | "automation";
export interface Assignee { kind: AssigneeKind; id: string }
export interface Block { type: string; v?: number; data: unknown }
export interface ActionDef { key: string; label: string; note?: "required" | "optional" }
export interface TaskSource { kind: "chat" | "run" | "gate" | "journey" | "manual"; id: string }

export const KINDS: readonly TaskKind[] = ["work", "approve", "review", "answer", "unblock", "signature"];
export const STATES: readonly TaskState[] = ["todo", "doing", "in_review", "awaiting_approval", "done", "canceled"];
/** The kinds a Request is made of (spec 2.8): what Needs you shows. */
export const REQUEST_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>(["approve", "review", "answer", "unblock"]);
export const isOpen = (s: TaskState): boolean => s !== "done" && s !== "canceled";
export const isRequest = (k: TaskKind): boolean => REQUEST_KINDS.has(k);

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  summary?: string;
  why?: string;
  state: TaskState;
  blocks: Block[];
  actions: ActionDef[];
  assigned: Assignee;
  reviewer?: Assignee;
  approver?: Assignee;
  takenBy?: string;
  takenAt?: number;
  due?: number;
  effort?: number;
  recordId?: string;
  fileIds: string[];
  source?: TaskSource;
  parentTaskId?: string;
  dependsOn: string[];
  followers: string[];
  workingNotes: Record<string, string>;
  threadId?: string;
  reviewLoops: number;
  snoozedUntil?: number;
  expiresAt?: number;
  /** Gate holds: the decision and payload hash the approval token is bound to (set once, never edited). */
  decisionId?: string;
  payloadHash?: string;
  handledBy?: string;
  handledAt?: number;
  /** The person responsible for an agent assignee (its owner), resolved when the slot was set. */
  responsible?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts { idempotencyKey?: string; vis?: string; cause?: string }
export interface TasksCtx {
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
  seal?: { seal(v: Uint8Array, scope: string): { keyId: string; nonce: string; bytes: string }; unseal(s: { keyId: string; nonce: string; bytes: string }): Uint8Array };
}

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

export function newTaskId(): string {
  return makeId("tsk", globalThis.crypto.getRandomValues(new Uint8Array(14)));
}
function randomHex(n: number): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- policy (the three tasks.* settings) ----

export interface Policy { reviewLoopLimit: number; allowSelfReview: boolean; requireHumanApprover: boolean }
export const POLICY_DEFAULTS: Policy = { reviewLoopLimit: 2, allowSelfReview: false, requireHumanApprover: false };

export function readPolicy(db: Db): Policy {
  const p: Policy = { ...POLICY_DEFAULTS };
  for (const r of db.all("SELECT policy_key, policy_value FROM tasks_policy") as { policy_key: string; policy_value: string }[]) {
    let v: unknown;
    try { v = JSON.parse(r.policy_value); } catch { continue; }
    if (r.policy_key === "tasks.review_loop_limit" && typeof v === "number" && Number.isInteger(v) && v >= 1) p.reviewLoopLimit = v;
    if (r.policy_key === "tasks.allow_self_review" && typeof v === "boolean") p.allowSelfReview = v;
    if (r.policy_key === "tasks.require_human_approver" && typeof v === "boolean") p.requireHumanApprover = v;
  }
  return p;
}

// ---- row <-> task ----

const SELECT = `SELECT c.id AS id, m.kind AS kind, c.title AS title, c.summary AS summary, m.why AS why, c.state AS state, m.blocks AS blocks,
  c.actions AS actions, m.assigned AS assigned, m.reviewer AS reviewer, m.approver AS approver, m.taken_by AS taken_by, m.taken_at AS taken_at,
  m.due AS due, m.effort AS effort, c.record_id AS record_id, c.file_ids AS file_ids, m.source_kind AS source_kind, m.source_id AS source_id,
  m.parent_task AS parent_task, m.depends_on AS depends_on, m.followers AS followers, m.working_notes AS working_notes, m.thread_id AS thread_id,
  m.review_loops AS review_loops, m.snoozed_until AS snoozed_until, m.expires_at AS expires_at, m.decision_id AS decision_id,
  m.payload_hash AS payload_hash, c.handled_by AS handled_by, c.handled_at AS handled_at, c.responsible AS responsible,
  c.created_by AS created_by, c.created_at AS created_at, c.updated_at AS updated_at, m.version AS version
  FROM tasks_core c JOIN tasks_meta m ON m.id = c.id`;

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

function rowToTask(r: Raw): Task {
  const t: Task = {
    id: r.id as string,
    kind: r.kind as TaskKind,
    title: r.title as string,
    state: r.state as TaskState,
    blocks: json<Block[]>(r.blocks, []),
    actions: json<ActionDef[]>(r.actions, []),
    assigned: json<Assignee>(r.assigned, { kind: "person", id: "" }),
    fileIds: json<string[]>(r.file_ids, []),
    dependsOn: json<string[]>(r.depends_on, []),
    followers: json<string[]>(r.followers, []),
    workingNotes: json<Record<string, string>>(r.working_notes, {}),
    reviewLoops: num(r.review_loops) ?? 0,
    createdBy: r.created_by as string,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    version: num(r.version) ?? 0,
  };
  const summary = str(r.summary); if (summary !== undefined) t.summary = summary;
  const why = str(r.why); if (why !== undefined) t.why = why;
  const reviewer = json<Assignee | null>(r.reviewer, null); if (reviewer) t.reviewer = reviewer;
  const approver = json<Assignee | null>(r.approver, null); if (approver) t.approver = approver;
  const takenBy = str(r.taken_by); if (takenBy !== undefined) t.takenBy = takenBy;
  const takenAt = num(r.taken_at); if (takenAt !== undefined) t.takenAt = takenAt;
  const due = num(r.due); if (due !== undefined) t.due = due;
  const effort = num(r.effort); if (effort !== undefined) t.effort = effort;
  const recordId = str(r.record_id); if (recordId !== undefined) t.recordId = recordId;
  const sk = str(r.source_kind), si = str(r.source_id);
  if (sk !== undefined && si !== undefined) t.source = { kind: sk as TaskSource["kind"], id: si };
  const parent = str(r.parent_task); if (parent !== undefined) t.parentTaskId = parent;
  const thread = str(r.thread_id); if (thread !== undefined) t.threadId = thread;
  const snoozed = num(r.snoozed_until); if (snoozed !== undefined) t.snoozedUntil = snoozed;
  const expires = num(r.expires_at); if (expires !== undefined) t.expiresAt = expires;
  const decision = str(r.decision_id); if (decision !== undefined) t.decisionId = decision;
  const hash = str(r.payload_hash); if (hash !== undefined) t.payloadHash = hash;
  const handledBy = str(r.handled_by); if (handledBy !== undefined) t.handledBy = handledBy;
  const handledAt = num(r.handled_at); if (handledAt !== undefined) t.handledAt = handledAt;
  const responsible = str(r.responsible); if (responsible !== undefined) t.responsible = responsible;
  return t;
}

const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const js = (v: unknown): string => JSON.stringify(v);

/** Insert or replace both halves of the row. The caller sets updatedAt; version counts writes. */
export function saveTask(db: Db, t: Task): void {
  db.run(
    `INSERT OR REPLACE INTO tasks_core (id, title, summary, state, actions, file_ids, record_id, created_by, created_at, updated_at, handled_by, handled_at, responsible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id, t.title, nul(t.summary), t.state, js(t.actions), js(t.fileIds), nul(t.recordId), t.createdBy, t.createdAt, t.updatedAt,
    nul(t.handledBy), nul(t.handledAt), nul(t.responsible),
  );
  db.run(
    `INSERT OR REPLACE INTO tasks_meta (id, kind, assigned, reviewer, approver, taken_by, taken_at, snoozed_until, why, blocks, source_kind, source_id,
       parent_task, depends_on, followers, working_notes, review_loops, decision_id, payload_hash, expires_at, due, effort, thread_id, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    t.id, t.kind, js(t.assigned), t.reviewer ? js(t.reviewer) : null, t.approver ? js(t.approver) : null, nul(t.takenBy), nul(t.takenAt),
    nul(t.snoozedUntil), nul(t.why), js(t.blocks), nul(t.source?.kind), nul(t.source?.id), nul(t.parentTaskId), js(t.dependsOn), js(t.followers),
    js(t.workingNotes), t.reviewLoops, nul(t.decisionId), nul(t.payloadHash), nul(t.expiresAt), nul(t.due), nul(t.effort), nul(t.threadId), t.version, t.updatedAt,
  );
}

export function findTask(db: Db, id: string): Task | undefined {
  const rows = db.all(`${SELECT} WHERE c.id = ? AND m.deleted_at IS NULL`, id) as Raw[];
  return rows[0] ? rowToTask(rows[0]) : undefined;
}
export function getTask(ctx: TasksCtx, id: string): Task {
  const t = findTask(ctx.db, id);
  if (!t) raise(ctx, "permission.not_found", "That task is not available.");
  return t;
}
export function allTasks(db: Db, where = "", ...args: unknown[]): Task[] {
  return (db.all(`${SELECT} WHERE m.deleted_at IS NULL${where ? ` AND ${where}` : ""} ORDER BY c.created_at DESC, c.id DESC`, ...args) as Raw[]).map(rowToTask);
}

/** Bump version and updatedAt, then write. */
export function touch(ctx: TasksCtx, db: Db, t: Task): Task {
  t.updatedAt = ctx.now();
  t.version += 1;
  saveTask(db, t);
  return t;
}

// ---- derived: Blocked, index of open tasks ----

export interface OpenIndex {
  open: Set<string>;
  /** parents that have an open Unblock child */
  unblockParents: Set<string>;
  /** open tasks that another open task waits on (dependency) or that block their parent (open Unblock child) */
  blocking: Set<string>;
  /** the open tasks that wait on each id */
  waiters: Map<string, string[]>;
}

export function openIndex(db: Db): OpenIndex {
  const rows = db.all(
    "SELECT c.id AS id, m.kind AS kind, m.parent_task AS parent_task, m.depends_on AS depends_on FROM tasks_core c JOIN tasks_meta m ON m.id = c.id WHERE c.state NOT IN ('done', 'canceled') AND m.deleted_at IS NULL",
  ) as Raw[];
  const idx: OpenIndex = { open: new Set(), unblockParents: new Set(), blocking: new Set(), waiters: new Map() };
  for (const r of rows) idx.open.add(r.id as string);
  for (const r of rows) {
    const id = r.id as string;
    const parent = str(r.parent_task);
    if (r.kind === "unblock" && parent !== undefined) { idx.unblockParents.add(parent); idx.blocking.add(id); }
    for (const d of json<string[]>(r.depends_on, [])) {
      if (!idx.open.has(d)) continue;
      idx.blocking.add(d);
      idx.waiters.set(d, [...(idx.waiters.get(d) ?? []), id]);
    }
  }
  return idx;
}

/** Blocked is derived, never set by hand: an open Unblock child, or a dependency that is not Done or Canceled yet. */
export function isBlocked(t: Task, idx: OpenIndex): boolean {
  if (!isOpen(t.state)) return false;
  if (idx.unblockParents.has(t.id)) return true;
  return t.dependsOn.some((d) => idx.open.has(d));
}

// ---- output ----

export function toOut(t: Task, idx: OpenIndex): Record<string, unknown> {
  const notes: Record<string, string> = { ...t.workingNotes };
  return clean({
    id: t.id, kind: t.kind, title: t.title, summary: t.summary, why: t.why, state: t.state,
    blocked: isBlocked(t, idx), blocks: t.blocks, actions: t.actions,
    assigned: t.assigned, reviewer: t.reviewer, approver: t.approver,
    takenBy: t.takenBy, due: t.due, effort: t.effort, recordId: t.recordId, fileIds: t.fileIds, source: t.source,
    parentTaskId: t.parentTaskId, dependsOn: t.dependsOn, followers: t.followers, workingNotes: notes, threadId: t.threadId,
    reviewLoops: t.reviewLoops, snoozedUntil: t.snoozedUntil, createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt,
  });
}
export const out = (ctx: TasksCtx, t: Task): Record<string, unknown> => toOut(t, openIndex(ctx.db));

// ---- participation ----

export interface Who { id: string; kind: string; actingFor?: string | undefined }
export function whoIs(ctx: TasksCtx): Who {
  return { id: ctx.principal.id, kind: ctx.principal.kind, ...(ctx.actingFor ? { actingFor: ctx.actingFor } : {}) };
}
export const sameAssignee = (a: Assignee | undefined, b: Assignee | undefined): boolean => !!a && !!b && a.kind === b.kind && a.id === b.id;

/** Does the caller stand behind this slot? Persons, agents and automations by id. A group or role slot is open to any holder (the pipeline already authorized
 *  the call at level use on the task) until one of them takes it. A service caller (Gate, Journeys, e-sign) acts for every slot. */
export function holds(t: Task, slot: Slot, who: Who): boolean {
  if (who.kind === "service") return true;
  const a = t[slot];
  if (!a) return false;
  const me = (id: string): boolean => id === who.id || id === who.actingFor;
  if (a.kind === "person" || a.kind === "agent" || a.kind === "automation") return me(a.id);
  return t.takenBy === undefined || me(t.takenBy);
}
/** The slot whose holder acts next: the work slot for todo and doing, the reviewer for In review, the approver for Awaiting approval. */
export function actionableSlot(s: TaskState): Slot | null {
  if (s === "todo" || s === "doing") return "assigned";
  if (s === "in_review") return "reviewer";
  if (s === "awaiting_approval") return "approver";
  return null;
}
/** Direct (by id) involvement in any slot; used by My work and the lists. */
export function involved(t: Task, who: Who): boolean {
  const me = (id: string): boolean => id === who.id || id === who.actingFor;
  for (const s of ["assigned", "reviewer", "approver"] as const) {
    const a = t[s];
    if (a && (a.kind === "person" || a.kind === "agent") && me(a.id)) return true;
  }
  return t.takenBy !== undefined && me(t.takenBy);
}
/** Group and role slots: the caller sees the task when the kernel grants view on it (the grant follows the group or role). */
export function visibleTo(ctx: TasksCtx, t: Task): boolean {
  const who = whoIs(ctx);
  if (involved(t, who) || t.createdBy === who.id || t.followers.includes(who.id)) return true;
  if (!ctx.authorize) return false;
  return ctx.authorize({ perm: null, level: "view" }, { type: "task", id: t.id }).effect === "allow";
}
/** Is the next action on this task mine? Direct id match, or a group or role slot the kernel lets me act on. */
export function actionableByMe(ctx: TasksCtx, t: Task): boolean {
  const slot = actionableSlot(t.state);
  if (!slot) return false;
  const a = t[slot];
  if (!a) return false;
  const who = whoIs(ctx);
  if (a.kind === "group" || a.kind === "role") {
    if (t.takenBy !== undefined && t.takenBy !== who.id && t.takenBy !== who.actingFor) return false;
    return !!ctx.authorize && ctx.authorize({ perm: null, level: "use" }, { type: "task", id: t.id }).effect === "allow";
  }
  return holds(t, slot, who);
}

// ---- history and events ----

export function emitTask(ctx: TasksCtx, db: Db, name: string, t: Pick<Task, "id">, payload: Record<string, unknown>, h: { type: string; by: string; note?: string }): string {
  const ev = ctx.emit(name, `task/${t.id}`, clean({ taskId: t.id, ...payload }), { vis: "participants" });
  db.run(
    "INSERT INTO tasks_history (id, task_id, at, type, actor, note, event_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    `thx_${randomHex(8)}`, t.id, ctx.now(), h.type, h.by, nul(h.note), ev.id,
  );
  return ev.id;
}

// ---- queries ----

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

const DAY = 86_400_000;
export type Reason = "ready" | "due_today" | "overdue" | "blocking";
export interface NeedsItem { task: Task; reason: Reason; handledBy?: string }

const startOfDay = (ms: number): number => Math.floor(ms / DAY) * DAY;   // days are UTC until the per-person time zone lands with settings

/** The Needs you rule of spec 2.8: my Ready requests (Approve, Review, Answer, Unblock), or tasks due today or overdue, or tasks that block someone.
 *  Snoozed requests are hidden until their time. Requests I did not get to because a role-mate acted show "handled by". */
export function needsYou(ctx: TasksCtx): NeedsItem[] {
  const now = ctx.now();
  const idx = openIndex(ctx.db);
  const eod = startOfDay(now) + DAY;
  const who = whoIs(ctx);
  const items: NeedsItem[] = [];
  for (const t of allTasks(ctx.db, "c.state NOT IN ('done', 'canceled')")) {
    const mine = actionableByMe(ctx, t) || (t.assigned.kind !== "group" && t.assigned.kind !== "role" && involved(t, who));
    if (!mine) continue;
    if (t.snoozedUntil !== undefined && t.snoozedUntil > now) continue;
    let reason: Reason | null = null;
    if (t.due !== undefined && t.due < startOfDay(now)) reason = "overdue";
    else if (t.due !== undefined && t.due < eod) reason = "due_today";
    else if (isRequest(t.kind) && !isBlocked(t, idx) && actionableByMe(ctx, t)) reason = "ready";
    else if (idx.blocking.has(t.id)) reason = "blocking";
    if (reason) items.push({ task: t, reason });
  }
  // role-addressed requests resolved by someone else in the last day
  for (const t of allTasks(ctx.db, "c.state IN ('done', 'canceled') AND c.handled_by IS NOT NULL AND c.handled_at >= ?", now - DAY)) {
    if (!isRequest(t.kind) || t.handledBy === undefined || t.handledBy === who.id) continue;
    const addressed = [t.assigned, t.reviewer, t.approver].some((a) => a && (a.kind === "group" || a.kind === "role"));
    if (!addressed || !ctx.authorize || ctx.authorize({ perm: null, level: "view" }, { type: "task", id: t.id }).effect !== "allow") continue;
    items.push({ task: t, reason: "ready", handledBy: t.handledBy });
  }
  const rank: Record<Reason, number> = { overdue: 0, due_today: 1, blocking: 2, ready: 3 };
  const handledLast = (i: NeedsItem): number => (i.handledBy === undefined ? 0 : 1);
  items.sort((a, b) => handledLast(a) - handledLast(b) || rank[a.reason] - rank[b.reason] || (a.task.due ?? Infinity) - (b.task.due ?? Infinity) || b.task.createdAt - a.task.createdAt);
  return items;
}

export type Scope = "mine" | "assigned_by_me" | "following" | "record" | "run" | "all";
export interface ListFilter {
  scope: Scope;
  states?: TaskState[] | undefined;
  kinds?: TaskKind[] | undefined;
  recordId?: string | undefined;
  runId?: string | undefined;
  assignee?: Assignee | undefined;
  includeSnoozed?: boolean | undefined;
}

export function listTasks(ctx: TasksCtx, f: ListFilter): Task[] {
  const now = ctx.now();
  const who = whoIs(ctx);
  const pool = f.scope === "record" && f.recordId !== undefined ? allTasks(ctx.db, "c.record_id = ?", f.recordId)
    : f.scope === "run" && f.runId !== undefined ? allTasks(ctx.db, "m.source_kind = 'run' AND m.source_id = ?", f.runId)
    : f.scope === "assigned_by_me" ? allTasks(ctx.db, "c.created_by = ?", who.id)
    : allTasks(ctx.db);
  return pool.filter((t) => {
    if (f.scope === "mine" && !(involved(t, who) || actionableByMe(ctx, t))) return false;
    if (f.scope === "following" && !t.followers.includes(who.id)) return false;
    if (f.scope === "assigned_by_me" && t.assigned.id === who.id) return false;
    if (f.scope === "record" && f.recordId === undefined) return false;
    if (f.scope === "run" && f.runId === undefined) return false;
    if (f.states && !f.states.includes(t.state)) return false;
    if (f.kinds && !f.kinds.includes(t.kind)) return false;
    if (f.assignee && !sameAssignee(t.assigned, f.assignee)) return false;
    if (!f.includeSnoozed && t.snoozedUntil !== undefined && t.snoozedUntil > now) return false;
    return visibleTo(ctx, t);
  });
}

export type Section = "open" | "assigned_by_me" | "done" | "all";
export function myWork(ctx: TasksCtx, section: Section): { tasks: Task[]; counts: { open: number; assignedByMe: number; done: number } } {
  const who = whoIs(ctx);
  const all = allTasks(ctx.db).filter((t) => involved(t, who) || t.createdBy === who.id || actionableByMe(ctx, t));
  const open = all.filter((t) => isOpen(t.state) && (involved(t, who) || actionableByMe(ctx, t)));
  const byMe = all.filter((t) => isOpen(t.state) && t.createdBy === who.id && !(t.assigned.id === who.id));
  const done = all.filter((t) => !isOpen(t.state) && (involved(t, who) || t.createdBy === who.id));
  const counts = { open: open.length, assignedByMe: byMe.length, done: done.length };
  const pick = section === "open" ? open : section === "assigned_by_me" ? byMe : section === "done" ? done : [...new Map([...open, ...byMe, ...done].map((t) => [t.id, t] as const)).values()];
  return { tasks: pick, counts };
}

export function historyOf(db: Db, taskId: string): { at: number; type: string; by: string; note?: string; eventId: string }[] {
  const rows = db.all("SELECT at, type, actor, note, event_id FROM tasks_history WHERE task_id = ? ORDER BY at DESC, rowid DESC", taskId) as Raw[];
  return rows.map((r) => clean({ at: r.at as number, type: r.type as string, by: r.actor as string, note: str(r.note), eventId: r.event_id as string }));
}
