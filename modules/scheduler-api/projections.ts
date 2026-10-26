// Scheduler projections (spec 2.12, 2.13; ARCH 6.8, 7.7). Schedule and wait rows, the cron engine, and the two scheduler.* settings.
// Durable tables: migrations/0001_scheduler.sql. Every statement names only scheduler_* tables (ctx.db refuses anything else, ARCH B2).
import { isTrustedService } from "../../lib/trust.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts { idempotencyKey?: string; vis?: string; cause?: string }
export interface CallOpts { idempotencyKey?: string; traceId?: string }
export interface SchedCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  run?: string;
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: EmitOpts): { id: string };
  call?(cap: string, input: unknown, opts?: CallOpts): Promise<unknown>;
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
export const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
export const js = (v: unknown): string => JSON.stringify(v);

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts. */
export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

// ---- policy (the two scheduler.* settings) ----

export interface Policy { missedWindowMs: number; defaultWaitMs: number }
export const POLICY_DEFAULTS: Policy = { missedWindowMs: 60 * MINUTE, defaultWaitMs: 30 * DAY };

const DURATION = /^(\d+)\s*(s|m|h|d|w)$/;
const UNIT: Record<string, number> = { s: 1000, m: MINUTE, h: HOUR, d: DAY, w: 7 * DAY };
/** `30d`, `6h`, `90m`, `2w`, `45s`; undefined when the text is not a duration. */
export function durationMs(s: string): number | undefined {
  const m = DURATION.exec(s.trim());
  return m ? Number(m[1]) * UNIT[m[2]!]! : undefined;
}

export function readPolicy(db: Db): Policy {
  const p: Policy = { ...POLICY_DEFAULTS };
  for (const r of db.all("SELECT policy_key, policy_value FROM scheduler_api_policy") as { policy_key: string; policy_value: string }[]) {
    const v = json<unknown>(r.policy_value, undefined);
    if (r.policy_key === "scheduler.missed_window_minutes" && typeof v === "number" && Number.isFinite(v) && v >= 0) p.missedWindowMs = Math.min(1440, v) * MINUTE;
    if (r.policy_key === "scheduler.default_wait_timeout" && typeof v === "string") { const d = durationMs(v); if (d !== undefined && d > 0) p.defaultWaitMs = d; }
  }
  return p;
}

// ---- cron ----

interface Field { set: ReadonlySet<number>; star: boolean }
export interface CronSpec { min: Field; hour: Field; dom: Field; mon: Field; dow: Field }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOWS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MACROS: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *" };

function parseField(text: string, lo: number, hi: number, names?: readonly string[], nameBase = 0): Field | undefined {
  const value = (s: string): number | undefined => {
    if (/^\d+$/.test(s)) return Number(s);
    const i = names ? names.indexOf(s.toLowerCase()) : -1;
    return i >= 0 ? i + nameBase : undefined;
  };
  const set = new Set<number>();
  let star = false;
  for (const part of text.split(",")) {
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined || range === undefined || range === "") return undefined;
    let step = 1;
    if (stepText !== undefined) { if (!/^\d+$/.test(stepText) || Number(stepText) < 1) return undefined; step = Number(stepText); }
    let a: number | undefined;
    let b: number | undefined;
    if (range === "*") { a = lo; b = hi; if (stepText === undefined) star = true; }
    else if (range.includes("-")) { const [x, y, z] = range.split("-"); if (z !== undefined || x === undefined || y === undefined) return undefined; a = value(x); b = value(y); }
    else { a = value(range); b = stepText !== undefined ? hi : a; }
    if (a === undefined || b === undefined || a < lo || b > hi || a > b) return undefined;
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return { set, star };
}

/** A five field cron: minute hour day-of-month month day-of-week. Lists, ranges, steps, month and weekday names and the @daily style macros. Weekday 7 is Sunday. */
export function parseCron(text: string): CronSpec | undefined {
  const t = text.trim().toLowerCase();
  const parts = (MACROS[t] ?? t).split(/\s+/);
  if (parts.length !== 5) return undefined;
  const min = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dom = parseField(parts[2]!, 1, 31);
  const mon = parseField(parts[3]!, 1, 12, MONTHS, 1);
  const dowRaw = parseField(parts[4]!, 0, 7, DOWS, 0);
  if (!min || !hour || !dom || !mon || !dowRaw) return undefined;
  const dow: Field = { star: dowRaw.star, set: new Set([...dowRaw.set].map((d) => d % 7)) };
  return { min, hour, dom, mon, dow };
}

export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const fmts = new Map<string, Intl.DateTimeFormat>();
interface Local { y: number; mo: number; d: number; h: number; mi: number }
function localOf(ms: number, tz: string): Local {
  let f = fmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }); fmts.set(tz, f); }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year!, mo: o.month!, d: o.day!, h: o.hour! % 24, mi: o.minute! };
}
const asUtc = (l: Local): number => Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);
/** The instant a wall-clock time has in a zone; undefined when that time does not exist (the hour skipped when clocks go forward). */
function localToUtc(l: Local, tz: string): number | undefined {
  const want = asUtc(l);
  let guess = want - (asUtc(localOf(want, tz)) - want);
  for (let i = 0; i < 2; i++) {
    const got = asUtc(localOf(guess, tz));
    if (got === want) return guess;
    guess -= got - want;
  }
  return asUtc(localOf(guess, tz)) === want ? guess : undefined;
}

/** The first fire time strictly after `after`, in the zone's wall clock; undefined for a cron that never fires (30 February). */
export function nextCron(spec: CronSpec, tz: string, after: number): number | undefined {
  const start = localOf(after, tz);
  const hours = [...spec.hour.set].sort((a, b) => a - b);
  const mins = [...spec.min.set].sort((a, b) => a - b);
  const day0 = Date.UTC(start.y, start.mo - 1, start.d);
  for (let n = 0; n < 366 * 9; n++) {
    const dt = new Date(day0 + n * DAY);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if (!spec.mon.set.has(mo)) continue;
    const domOk = spec.dom.set.has(d);
    const dowOk = spec.dow.set.has(dt.getUTCDay());
    // when both day fields are restricted either one matches (cron's rule); a star in one leaves the other in charge
    const dayOk = spec.dom.star || spec.dow.star ? domOk && dowOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of hours) for (const mi of mins) {
      const at = localToUtc({ y, mo, d, h, mi }, tz);
      if (at !== undefined && at > after) return at;
    }
  }
  return undefined;
}

// ---- schedules ----

export type When = { at: number } | { cron: string; tz: string };
export type IfMissed = "skip" | "run_once";
export interface Owner { kind: string; id: string }
export interface Schedule {
  id: string; owner: Owner; principal: string; cap: string; input: unknown; when: When; ifMissed: IfMissed; active: boolean; pausedReason?: string;
  nextAt?: number; lastFiredAt?: number; createdBy: string; createdAt: number; canceledAt?: number;
}
export const CAP = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

type Raw = Record<string, unknown>;
function rowToSchedule(r: Raw): Schedule {
  const cron = str(r.cron);
  const s: Schedule = {
    id: r.id as string, owner: { kind: r.owner_kind as string, id: r.owner_id as string }, principal: r.principal as string, cap: r.cap as string, input: json<unknown>(r.input, {}),
    when: cron !== undefined ? { cron, tz: (str(r.tz) ?? "UTC") } : { at: num(r.at_ms) ?? 0 }, ifMissed: r.if_missed === "skip" ? "skip" : "run_once",
    active: num(r.active) === 1, createdBy: r.created_by as string, createdAt: num(r.created_at) ?? 0,
  };
  const p = str(r.paused_reason); if (p !== undefined) s.pausedReason = p;
  const n = num(r.next_at); if (n !== undefined) s.nextAt = n;
  const l = num(r.last_fired_at); if (l !== undefined) s.lastFiredAt = l;
  const c = num(r.canceled_at); if (c !== undefined) s.canceledAt = c;
  return s;
}
export function findSchedule(db: Db, id: string): Schedule | undefined {
  const r = (db.all("SELECT * FROM scheduler_api_schedules WHERE id = ? AND canceled_at IS NULL", id) as Raw[])[0];
  return r ? rowToSchedule(r) : undefined;
}
export function allSchedules(db: Db): Schedule[] {
  return (db.all("SELECT * FROM scheduler_api_schedules WHERE canceled_at IS NULL ORDER BY created_at ASC, id ASC") as Raw[]).map(rowToSchedule);
}
/** Active schedules whose next fire time has come, oldest first. */
export function dueSchedules(db: Db, now: number): Schedule[] {
  return (db.all("SELECT * FROM scheduler_api_schedules WHERE canceled_at IS NULL AND active = 1 AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at ASC, id ASC", now) as Raw[]).map(rowToSchedule);
}
export function saveSchedule(db: Db, s: Schedule): void {
  const cron = "cron" in s.when ? s.when : undefined;
  db.run(
    `INSERT OR REPLACE INTO scheduler_api_schedules (id, owner_kind, owner_id, principal, cap, input, at_ms, cron, tz, if_missed, active, paused_reason, next_at, last_fired_at, created_by, created_at, canceled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.id, s.owner.kind, s.owner.id, s.principal, s.cap, js(s.input ?? {}), "at" in s.when ? s.when.at : null, nul(cron?.cron), nul(cron?.tz), s.ifMissed, s.active ? 1 : 0,
    nul(s.pausedReason), nul(s.nextAt), nul(s.lastFiredAt), s.createdBy, s.createdAt, nul(s.canceledAt),
  );
}
/** The next time after `after` that a schedule's When fires; a one-shot has none once its time passed. */
export function nextFire(when: When, after: number, firstAt?: boolean): number | undefined {
  if ("at" in when) return firstAt || when.at > after ? when.at : undefined;
  const spec = parseCron(when.cron);
  return spec ? nextCron(spec, when.tz, after) : undefined;
}
export function scheduleOut(s: Schedule): Record<string, unknown> {
  return clean({
    id: s.id, owner: s.owner, principal: s.principal, cap: s.cap, when: s.when, ifMissed: s.ifMissed, active: s.active, pausedReason: s.pausedReason, nextAt: s.nextAt,
    lastFiredAt: s.lastFiredAt, createdAt: s.createdAt,
  });
}

export function idemFind(db: Db, key: string): string | undefined {
  return str((db.all("SELECT ref_id FROM scheduler_api_idem WHERE idem_key = ?", key) as Raw[])[0]?.ref_id);
}
export function idemSave(db: Db, key: string, ref: string): void { db.run("INSERT OR REPLACE INTO scheduler_api_idem (idem_key, ref_id) VALUES (?, ?)", key, ref); }

export function fireRow(db: Db, scheduleId: string, scheduledFor: number): { runId?: string } | undefined {
  const r = (db.all("SELECT run_id FROM scheduler_api_fires WHERE schedule_id = ? AND scheduled_for = ?", scheduleId, scheduledFor) as Raw[])[0];
  if (!r) return undefined;
  const runId = str(r.run_id);
  return runId !== undefined ? { runId } : {};
}
export function saveFire(db: Db, scheduleId: string, scheduledFor: number, runId: string | undefined, at: number): void {
  db.run("INSERT OR IGNORE INTO scheduler_api_fires (schedule_id, scheduled_for, run_id, fired_at) VALUES (?, ?, ?, ?)", scheduleId, scheduledFor, nul(runId), at);
}

export interface MissedRow { scheduleId: string; owner: Owner; scheduledFor: number; handling: "ran_once" | "skipped"; runId?: string; note?: string; handledAt: number }
export function saveMissed(db: Db, m: MissedRow): void {
  db.run(
    "INSERT OR REPLACE INTO scheduler_api_missed (schedule_id, scheduled_for, owner_kind, owner_id, handling, run_id, note, handled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    m.scheduleId, m.scheduledFor, m.owner.kind, m.owner.id, m.handling, nul(m.runId), nul(m.note), m.handledAt,
  );
}
export function missedSince(db: Db, since: number): MissedRow[] {
  return (db.all("SELECT * FROM scheduler_api_missed WHERE handled_at >= ? ORDER BY handled_at ASC, schedule_id ASC", since) as Raw[]).map((r) => {
    const m: MissedRow = {
      scheduleId: r.schedule_id as string, owner: { kind: r.owner_kind as string, id: r.owner_id as string }, scheduledFor: num(r.scheduled_for) ?? 0,
      handling: r.handling === "ran_once" ? "ran_once" : "skipped", handledAt: num(r.handled_at) ?? 0,
    };
    const run = str(r.run_id); if (run !== undefined) m.runId = run;
    const note = str(r.note); if (note !== undefined) m.note = note;
    return m;
  });
}

// ---- waits ----

export type WaitOn = { event: string; filter?: unknown } | { run: string } | { at: number };
export type WaitState = "open" | "matched" | "expired" | "canceled";
export interface ResourceRef { type: string; id: string }
export interface Wait {
  id: string; runId: string; on: WaitOn; subject?: ResourceRef; threadId?: string; stepId?: string; expiresAt: number; cancelsOn: string[]; state: WaitState; createdAt: number;
}

/** Canonical JSON (sorted keys) so the same filter always gives the same text. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Raw)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
/** FNV-1a over the canonical filter text: the `filter_hash` of the waits index. */
export function filterHash(filter: unknown): string {
  let h = 0x811c9dc5;
  for (const c of canonical(filter ?? null)) { h ^= c.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function rowToWait(r: Raw): Wait {
  const w: Wait = {
    id: r.id as string, runId: r.run_id as string, on: json<WaitOn>(r.on_json, { at: 0 }), expiresAt: num(r.expires_at) ?? 0, cancelsOn: json<string[]>(r.cancels_on, []),
    state: r.state as WaitState, createdAt: num(r.created_at) ?? 0,
  };
  const st = str(r.subject_type), si = str(r.subject_id);
  if (st !== undefined && si !== undefined) w.subject = { type: st, id: si };
  const th = str(r.thread_id); if (th !== undefined) w.threadId = th;
  const sp = str(r.step_id); if (sp !== undefined) w.stepId = sp;
  return w;
}
export function findWait(db: Db, id: string): Wait | undefined {
  const r = (db.all("SELECT * FROM scheduler_api_waits WHERE id = ?", id) as Raw[])[0];
  return r ? rowToWait(r) : undefined;
}
export function openWaits(db: Db): Wait[] {
  return (db.all("SELECT * FROM scheduler_api_waits WHERE state = 'open' ORDER BY created_at ASC, id ASC") as Raw[]).map(rowToWait);
}
/** Open event waits for an event type: the exact type or a family pattern (`record.*`). The index is (state, event_type, filter_hash). */
export function openEventWaits(db: Db, type: string): Wait[] {
  const family = type.includes(".") ? `${type.slice(0, type.lastIndexOf("."))}.*` : "";
  return (db.all(
    "SELECT * FROM scheduler_api_waits WHERE state = 'open' AND (event_type = ? OR event_type = ?) ORDER BY created_at ASC, id ASC", type, family || type,
  ) as Raw[]).map(rowToWait);
}
export function saveWait(db: Db, w: Wait): void {
  const on = w.on;
  db.run(
    `INSERT OR REPLACE INTO scheduler_api_waits (id, run_id, on_json, event_type, filter_hash, target_run, at_ms, subject, subject_type, subject_id, thread_id, step_id, expires_at, cancels_on, state, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT ended_at FROM scheduler_api_waits WHERE id = ?))`,
    w.id, w.runId, js(on), "event" in on ? on.event : null, "event" in on ? filterHash(on.filter) : null, "run" in on ? on.run : null, "at" in on ? on.at : null,
    w.subject ? js(w.subject) : null, nul(w.subject?.type), nul(w.subject?.id), nul(w.threadId), nul(w.stepId), w.expiresAt, js(w.cancelsOn), w.state, w.createdAt, w.id,
  );
}
export function endWait(db: Db, id: string, state: WaitState, at: number): void {
  db.run("UPDATE scheduler_api_waits SET state = ?, ended_at = ? WHERE id = ? AND state = 'open'", state, at, id);
}
export function waitOut(w: Wait): Record<string, unknown> {
  return clean({ id: w.id, runId: w.runId, on: w.on, subject: w.subject, threadId: w.threadId, stepId: w.stepId, expiresAt: w.expiresAt, cancelsOn: w.cancelsOn, state: w.state, createdAt: w.createdAt });
}
/** Every key of the filter is equal in the payload (deep, by canonical text). */
export function filterMatches(filter: unknown, payload: unknown): boolean {
  if (!filter || typeof filter !== "object") return true;
  const p = (payload && typeof payload === "object" ? payload : {}) as Raw;
  for (const [k, v] of Object.entries(filter as Raw)) if (canonical(p[k]) !== canonical(v)) return false;
  return true;
}

// ---- who ----

export const me = (ctx: SchedCtx): string => ctx.actingFor ?? ctx.principal.id;
export const isService = (ctx: SchedCtx): boolean => isTrustedService(ctx.principal);
/** Manage a schedule: the host (a service caller), or the principal it runs as. */
export const mayManage = (ctx: SchedCtx, s: Pick<Schedule, "principal">): boolean => isService(ctx) || s.principal === ctx.principal.id || s.principal === ctx.actingFor;
export function emitSched(ctx: SchedCtx, name: string, scheduleId: string, payload: Record<string, unknown>): void {
  ctx.emit(name, `entity/${scheduleId}`, clean({ scheduleId, ...payload }));
}
export function emitWait(ctx: SchedCtx, name: string, runId: string, payload: Record<string, unknown>): void {
  ctx.emit(name, `run/${runId}`, clean({ runId, ...payload }));
}

/** Open waits on the end of another Run. */
export function openWaitsOnRun(db: Db, target: string): Wait[] {
  return (db.all("SELECT * FROM scheduler_api_waits WHERE state = 'open' AND target_run = ? ORDER BY created_at ASC, id ASC", target) as Raw[]).map(rowToWait);
}
export function waitsFor(db: Db, f: { runId?: string; subject?: ResourceRef; threadId?: string }): Wait[] {
  return openWaits(db).filter((w) =>
    (f.runId === undefined || w.runId === f.runId) && (f.threadId === undefined || w.threadId === f.threadId)
    && (f.subject === undefined || (w.subject?.type === f.subject.type && w.subject.id === f.subject.id)));
}
