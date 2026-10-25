// Journeys projections (spec 2.12, ARCH 7.7). The design and its versions, where each Journey record stands, the tasks made for it and the time limits raised.
// Durable tables: migrations/0001_journeys.sql. Every statement names only journeys_* tables (ctx.db refuses anything else, ARCH B2).
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface Assignee { kind: string; id: string }
export interface TaskTemplate {
  key: string; title: string; description?: string; kind?: string; assigned: Assignee; reviewer?: Assignee; approver?: Assignee; required: boolean;
  dueAfterHours?: number; keyId?: string; backupKeyId?: string; doneByAutomation?: string;
}
export interface TimeLimit { hours: number; escalateTo?: { kind: string; id: string } }
export interface Stage {
  key: string; title: string; order: number; exit: { requireTasks: boolean; manualOnly?: boolean }; timeLimit?: TimeLimit; tasks: TaskTemplate[]; automations: string[]; final?: boolean; onLeaving?: string[];
}
export interface StartRule { event: string; filter?: unknown; enabled: boolean }
export interface Journey {
  id: string; name: string; subjectType: string; recordType: string; version: number; stages: Stage[]; startRule?: StartRule; startAutomationId?: string; createdAt: number; updatedAt: number;
}
export interface VersionRow { versionId: string; n: number; by: string; at: number; reason?: string; name?: string }
export interface JRecord {
  recordId: string; journeyId: string; subjectRecordId: string; version: number; stage: string; startStage: string; enteredAt: number; completedAt?: number; ownerId: string;
  startKey: string; channelId?: string; threadId?: string; startedAt: number;
}

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts { idempotencyKey?: string; vis?: string; cause?: string }
export interface JourneysCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: EmitOpts): { id: string };
  call?(cap: string, input: unknown): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
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
export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const me = (ctx: JourneysCtx): string => ctx.actingFor ?? ctx.principal.id;
export const HOUR = 3_600_000;

type Raw = Record<string, unknown>;

// ---- the design ----

function rowToJourney(r: Raw): Journey {
  const j: Journey = {
    id: r.id as string, name: r.name as string, subjectType: r.subject_type as string, recordType: r.record_type as string, version: num(r.version) ?? 1,
    stages: json<Stage[]>(r.stages, []), createdAt: num(r.created_at) ?? 0, updatedAt: num(r.updated_at) ?? 0,
  };
  const sr = json<StartRule | null>(r.start_rule, null); if (sr) j.startRule = sr;
  const sa = str(r.start_automation_id); if (sa !== undefined) j.startAutomationId = sa;
  return j;
}
export function saveJourney(db: Db, j: Journey): void {
  db.run(
    `INSERT OR REPLACE INTO journeys_defs (id, name, subject_type, record_type, version, stages, start_rule, start_automation_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    j.id, j.name, j.subjectType, j.recordType, j.version, js(j.stages), j.startRule ? js(j.startRule) : null, nul(j.startAutomationId), j.createdAt, j.updatedAt,
  );
}
export function findJourney(db: Db, id: string): Journey | undefined {
  const r = (db.all("SELECT * FROM journeys_defs WHERE id = ? AND deleted_at IS NULL", id) as Raw[])[0];
  return r ? rowToJourney(r) : undefined;
}
export function getJourney(ctx: JourneysCtx, id: string): Journey {
  const j = findJourney(ctx.db, id);
  if (!j) raise(ctx, "permission.not_found", "That Journey is not available.");
  return j;
}
export function allJourneys(db: Db): Journey[] {
  return (db.all("SELECT * FROM journeys_defs WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC") as Raw[]).map(rowToJourney);
}
export function markDeleted(ctx: JourneysCtx, id: string): void { ctx.db.run("UPDATE journeys_defs SET deleted_at = ? WHERE id = ?", ctx.now(), id); }

export function saveVersion(ctx: JourneysCtx, j: Journey, reason?: string): VersionRow {
  const row: VersionRow = clean({ versionId: newId("ver", ctx.now()), n: j.version, by: me(ctx), at: ctx.now(), reason, name: j.name });
  ctx.db.run(
    "INSERT INTO journeys_versions (version_id, journey_id, n, by_who, at, reason, name, stages, start_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    row.versionId, j.id, row.n, row.by, row.at, nul(reason), j.name, js(j.stages), j.startRule ? js(j.startRule) : null,
  );
  return row;
}
export function listVersions(db: Db, id: string): VersionRow[] {
  return (db.all("SELECT version_id, n, by_who, at, reason, name FROM journeys_versions WHERE journey_id = ? ORDER BY n DESC", id) as Raw[])
    .map((r) => clean({ versionId: r.version_id as string, n: num(r.n) ?? 0, by: r.by_who as string, at: num(r.at) ?? 0, reason: str(r.reason), name: str(r.name) }));
}
/** The stages of one version of a Journey. The current version is the Journey's own. */
export function stagesOf(db: Db, j: Pick<Journey, "id" | "version" | "stages">, version: number): Stage[] | undefined {
  if (version === j.version) return j.stages;
  const r = (db.all("SELECT stages FROM journeys_versions WHERE journey_id = ? AND n = ?", j.id, version) as Raw[])[0];
  return r ? json<Stage[]>(r.stages, []) : undefined;
}
export const byOrder = (stages: readonly Stage[]): Stage[] => [...stages].sort((a, b) => a.order - b.order);

export function out(j: Journey, inFlight: number): Record<string, unknown> {
  return clean({
    id: j.id, name: j.name, subjectType: j.subjectType, recordType: j.recordType, version: j.version, stages: j.stages, startRule: j.startRule, startAutomationId: j.startAutomationId,
    inFlight, createdAt: j.createdAt, updatedAt: j.updatedAt,
  });
}

// ---- records ----

function rowToRecord(r: Raw): JRecord {
  const x: JRecord = {
    recordId: r.record_id as string, journeyId: r.journey_id as string, subjectRecordId: r.subject_record_id as string, version: num(r.version) ?? 1, stage: r.stage as string,
    startStage: r.start_stage as string, enteredAt: num(r.entered_at) ?? 0, ownerId: r.owner_id as string, startKey: r.start_key as string, startedAt: num(r.started_at) ?? 0,
  };
  const c = num(r.completed_at); if (c !== undefined) x.completedAt = c;
  const ch = str(r.channel_id); if (ch !== undefined) x.channelId = ch;
  const th = str(r.thread_id); if (th !== undefined) x.threadId = th;
  return x;
}
export function saveRecord(db: Db, x: JRecord): void {
  db.run(
    `INSERT OR REPLACE INTO journeys_records (record_id, journey_id, subject_record_id, version, stage, start_stage, entered_at, completed_at, owner_id, start_key, channel_id, thread_id, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    x.recordId, x.journeyId, x.subjectRecordId, x.version, x.stage, x.startStage, x.enteredAt, nul(x.completedAt), x.ownerId, x.startKey, nul(x.channelId), nul(x.threadId), x.startedAt,
  );
}
export function findRecord(db: Db, recordId: string): JRecord | undefined {
  const r = (db.all("SELECT * FROM journeys_records WHERE record_id = ?", recordId) as Raw[])[0];
  return r ? rowToRecord(r) : undefined;
}
export function findBySubject(db: Db, journeyId: string, subject: string): JRecord | undefined {
  const r = (db.all("SELECT * FROM journeys_records WHERE journey_id = ? AND subject_record_id = ?", journeyId, subject) as Raw[])[0];
  return r ? rowToRecord(r) : undefined;
}
export function findByKey(db: Db, key: string): JRecord | undefined {
  const r = (db.all("SELECT * FROM journeys_records WHERE start_key = ?", key) as Raw[])[0];
  return r ? rowToRecord(r) : undefined;
}
export function getRecord(ctx: JourneysCtx, journeyId: string, recordId: string): JRecord {
  const r = findRecord(ctx.db, recordId);
  if (!r || r.journeyId !== journeyId) raise(ctx, "permission.not_found", "That Journey record is not available.");
  return r;
}
/** Records not yet complete, optionally of one Journey. */
export function inFlight(db: Db, journeyId?: string): JRecord[] {
  const where = journeyId ? "WHERE completed_at IS NULL AND journey_id = ?" : "WHERE completed_at IS NULL";
  return (db.all(`SELECT * FROM journeys_records ${where} ORDER BY started_at ASC, record_id ASC`, ...(journeyId ? [journeyId] : [])) as Raw[]).map(rowToRecord);
}
export function countInFlight(db: Db, journeyId: string): number {
  return Number(((db.all("SELECT COUNT(*) AS n FROM journeys_records WHERE journey_id = ? AND completed_at IS NULL", journeyId) as Raw[])[0]?.n) ?? 0);
}

// ---- tasks and breaches ----

export interface TaskLink { stage: string; taskKey: string; enteredAt: number; taskId: string; required: boolean }
export function saveTaskLink(db: Db, recordId: string, t: TaskLink): void {
  db.run("INSERT OR REPLACE INTO journeys_tasks (record_id, stage, task_key, entered_at, task_id, required) VALUES (?, ?, ?, ?, ?, ?)", recordId, t.stage, t.taskKey, t.enteredAt, t.taskId, t.required ? 1 : 0);
}
export function taskLinks(db: Db, recordId: string, stage: string, enteredAt: number): TaskLink[] {
  return (db.all("SELECT * FROM journeys_tasks WHERE record_id = ? AND stage = ? AND entered_at = ? ORDER BY task_key", recordId, stage, enteredAt) as Raw[])
    .map((r) => ({ stage: r.stage as string, taskKey: r.task_key as string, enteredAt: num(r.entered_at) ?? 0, taskId: r.task_id as string, required: num(r.required) === 1 }));
}
/** Every task made for a record, the latest entry of each stage's template key only (a record that left a stage and came back has a newer copy). */
export function allTaskLinks(db: Db, recordId: string, stage?: string): TaskLink[] {
  const rows = (db.all(`SELECT * FROM journeys_tasks WHERE record_id = ?${stage ? " AND stage = ?" : ""} ORDER BY entered_at, stage, task_key`, ...(stage ? [recordId, stage] : [recordId])) as Raw[])
    .map((r) => ({ stage: r.stage as string, taskKey: r.task_key as string, enteredAt: num(r.entered_at) ?? 0, taskId: r.task_id as string, required: num(r.required) === 1 }));
  const latest = new Map<string, TaskLink>();
  for (const l of rows) latest.set(`${l.stage}\u0000${l.taskKey}`, l);
  return [...latest.values()];
}
export function breachOf(db: Db, recordId: string, stage: string, enteredAt: number): { escalated: boolean } | undefined {
  const r = (db.all("SELECT escalated FROM journeys_breaches WHERE record_id = ? AND stage = ? AND entered_at = ?", recordId, stage, enteredAt) as Raw[])[0];
  return r ? { escalated: num(r.escalated) === 1 } : undefined;
}
export function saveBreach(db: Db, recordId: string, stage: string, enteredAt: number, escalated: boolean): void {
  db.run("INSERT OR REPLACE INTO journeys_breaches (record_id, stage, entered_at, escalated) VALUES (?, ?, ?, ?)", recordId, stage, enteredAt, escalated ? 1 : 0);
}

export function emitJ(ctx: JourneysCtx, name: string, subject: string, payload: Record<string, unknown>): string {
  return ctx.emit(name, subject, clean(payload)).id;
}
export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}
