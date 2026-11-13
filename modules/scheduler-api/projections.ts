// Scheduler projections (spec 2.12, 2.13; ARCH 6.8, 7.7). Schedule and wait rows, the cron engine, and the two scheduler.* settings.
// Durable tables: migrations/0001_scheduler.sql. Every statement names only scheduler_* tables (ctx.db refuses anything else, ARCH B2).
import { nextCron, parseCron } from "../../lib/clock.ts";
import type { CronSpec } from "../../lib/clock.ts";
import { isTrustedService } from "../../lib/trust.ts";
import { validZone as validTimeZone } from "../../lib/zones.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface EmitOpts {
  idempotencyKey?: string;
  vis?: string;
  cause?: string;
}
export interface CallOpts {
  idempotencyKey?: string;
  traceId?: string;
  /** run with the caller's own standing (host CallOpts.asCaller) */ asCaller?: boolean;
}
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
  log?: { warn(msg: string, attrs?: Record<string, unknown>): void };
  /** On a nested call: the capability whose handler made it (the pipeline sets it; a caller cannot). */
  callerCap?: string;
  /** May every one of these people do this? Their own grants, never the caller's. Present on a booted daemon; a hand-built test ctx may omit it. */
  mayAll?(
    people: readonly string[],
    action: { perm: string | null; level: string },
    resource: { type: string; id: string | null },
  ): boolean;
}

type Code = Parameters<typeof fail>[0];
export function raise(
  ctx: { trace: { traceId: string } },
  code: Code,
  message?: string,
  details?: Record<string, unknown>,
): never {
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
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
export const js = (v: unknown): string => JSON.stringify(v);

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts. */
export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

export function page<T>(
  all: readonly T[],
  cursor?: string,
  limit?: number,
): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

// ---- policy (the two scheduler.* settings) ----

export interface Policy {
  missedWindowMs: number;
  defaultWaitMs: number;
}
export const POLICY_DEFAULTS: Policy = { missedWindowMs: 60 * MINUTE, defaultWaitMs: 30 * DAY };

const DURATION = /^(\d+)\s*(s|m|h|d|w)$/;
const UNIT: Record<string, number> = { s: 1000, m: MINUTE, h: HOUR, d: DAY, w: 7 * DAY };
/** `30d`, `6h`, `90m`, `2w`, `45s`; undefined when the text is not a duration. */
export function durationMs(s: string): number | undefined {
  const m = DURATION.exec(s.trim());
  return m ? Number(m[1]) * UNIT[m[2]!]! : undefined;
}

const POLICY_KEYS: ReadonlySet<string> = new Set(["scheduler.missed_window_minutes", "scheduler.default_wait_timeout"]);
export function readPolicy(db: Db): Policy {
  const p: Policy = { ...POLICY_DEFAULTS };
  for (const r of db.all("SELECT policy_key, policy_value FROM scheduler_api_policy") as {
    policy_key: string;
    policy_value: string;
  }[]) {
    const v = json<unknown>(r.policy_value, undefined);
    if (r.policy_key === "scheduler.missed_window_minutes" && typeof v === "number" && Number.isFinite(v) && v >= 0)
      p.missedWindowMs = Math.min(1440, v) * MINUTE;
    if (r.policy_key === "scheduler.default_wait_timeout" && typeof v === "string") {
      const d = durationMs(v);
      if (d !== undefined && d > 0) p.defaultWaitMs = d;
    }
  }
  return p;
}

/**
 * The scheduler.* settings live in the settings module and a module reads only its own tables, so this keeps the copy `readPolicy` reads, from settings.changed. A reset announces the
 * shipped default as `after`, which reads the same as no row.
 */
export function syncPolicy(db: Db, p: Record<string, unknown>): boolean {
  const key = String(p["key"] ?? "");
  if (!POLICY_KEYS.has(key) || p["scope"] !== "space" || p["after"] === undefined) return false;
  db.run(
    "INSERT OR REPLACE INTO scheduler_api_policy (policy_key, policy_value) VALUES (?, ?)",
    key,
    JSON.stringify(p["after"]),
  );
  return true;
}

// ---- cron: the clock's (lib/clock.ts), under the names this module has always had ----

export { nextCron, parseCron, validTimeZone };
export type { CronSpec };

// ---- schedules ----

export type When = { at: number } | { cron: string; tz: string };
export type IfMissed = "skip" | "run_once";
export interface Owner {
  kind: string;
  id: string;
}
export interface Schedule {
  id: string;
  owner: Owner;
  principal: string;
  cap: string;
  input: unknown;
  when: When;
  ifMissed: IfMissed;
  active: boolean;
  pausedReason?: string;
  nextAt?: number;
  lastFiredAt?: number;
  createdBy: string;
  createdAt: number;
  canceledAt?: number;
  /** The Wake columns (P1): what this wake is for, whose account it runs on, who may see it, the zone it keeps its clock in (absent follows the Space), and what to do when a time comes while one is open. */
  kind: WakeKind;
  person?: string;
  agentId?: string;
  scope: WakeScope;
  roomId?: string;
  zone?: string;
  quiet?: { from: string; to: string };
  overlap: "skip" | "coalesce";
  answerWithinMin?: number;
  maxAttempts: number;
  pausedBy?: string;
}
export type WakeKind = "call" | "routine" | "watch" | "goal" | "baton";
export type WakeScope = "private" | "shared" | "room";
export const CAP = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

type Raw = Record<string, unknown>;
function rowToSchedule(r: Raw): Schedule {
  const cron = str(r.cron);
  const s: Schedule = {
    id: r.id as string,
    owner: { kind: r.owner_kind as string, id: r.owner_id as string },
    principal: r.principal as string,
    cap: r.cap as string,
    input: json<unknown>(r.input, {}),
    when: cron !== undefined ? { cron, tz: str(r.tz) ?? "UTC" } : { at: num(r.at_ms) ?? 0 },
    ifMissed: r.if_missed === "skip" ? "skip" : "run_once",
    active: num(r.active) === 1,
    createdBy: r.created_by as string,
    createdAt: num(r.created_at) ?? 0,
    kind: (str(r.kind) as WakeKind | undefined) ?? "call",
    scope: (str(r.scope) as WakeScope | undefined) ?? "private",
    overlap: r.overlap === "coalesce" ? "coalesce" : "skip",
    maxAttempts: num(r.max_attempts) ?? 1,
  };
  for (const [k, col] of [
    ["person", "person"],
    ["agentId", "agent_id"],
    ["roomId", "room_id"],
    ["zone", "zone"],
    ["pausedBy", "paused_by"],
  ] as const) {
    const v = str(r[col]);
    if (v !== undefined) s[k] = v;
  }
  const q = json<{ from: string; to: string } | undefined>(r.quiet, undefined);
  if (q) s.quiet = q;
  const aw = num(r.answer_within_min);
  if (aw !== undefined) s.answerWithinMin = aw;
  const p = str(r.paused_reason);
  if (p !== undefined) s.pausedReason = p;
  const n = num(r.next_at);
  if (n !== undefined) s.nextAt = n;
  const l = num(r.last_fired_at);
  if (l !== undefined) s.lastFiredAt = l;
  const c = num(r.canceled_at);
  if (c !== undefined) s.canceledAt = c;
  return s;
}
export function findSchedule(db: Db, id: string): Schedule | undefined {
  const r = (db.all("SELECT * FROM scheduler_api_schedules WHERE id = ? AND canceled_at IS NULL", id) as Raw[])[0];
  return r ? rowToSchedule(r) : undefined;
}
export function allSchedules(db: Db): Schedule[] {
  return (
    db.all("SELECT * FROM scheduler_api_schedules WHERE canceled_at IS NULL ORDER BY created_at ASC, id ASC") as Raw[]
  ).map(rowToSchedule);
}
/** Active schedules whose next fire time has come, by time, then in the order they were made (rowid): never by id, which is random. */
export function dueSchedules(db: Db, now: number): Schedule[] {
  return (
    db.all(
      "SELECT * FROM scheduler_api_schedules WHERE canceled_at IS NULL AND active = 1 AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at ASC, created_at ASC, rowid ASC",
      now,
    ) as Raw[]
  ).map(rowToSchedule);
}
export function saveSchedule(db: Db, s: Schedule): void {
  const cron = "cron" in s.when ? s.when : undefined;
  db.run(
    `INSERT OR REPLACE INTO scheduler_api_schedules (id, owner_kind, owner_id, principal, cap, input, at_ms, cron, tz, if_missed, active, paused_reason, next_at, last_fired_at, created_by, created_at, canceled_at,
       kind, person, agent_id, scope, room_id, zone, quiet, overlap, answer_within_min, max_attempts, paused_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.id,
    s.owner.kind,
    s.owner.id,
    s.principal,
    s.cap,
    js(s.input ?? {}),
    "at" in s.when ? s.when.at : null,
    nul(cron?.cron),
    nul(cron?.tz),
    s.ifMissed,
    s.active ? 1 : 0,
    nul(s.pausedReason),
    nul(s.nextAt),
    nul(s.lastFiredAt),
    s.createdBy,
    s.createdAt,
    nul(s.canceledAt),
    s.kind,
    nul(s.person),
    nul(s.agentId),
    s.scope,
    nul(s.roomId),
    nul(s.zone),
    s.quiet ? js(s.quiet) : null,
    s.overlap,
    nul(s.answerWithinMin),
    s.maxAttempts,
    nul(s.pausedBy),
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
    id: s.id,
    owner: s.owner,
    principal: s.principal,
    cap: s.cap,
    when: s.when,
    ifMissed: s.ifMissed,
    active: s.active,
    pausedReason: s.pausedReason,
    nextAt: s.nextAt,
    lastFiredAt: s.lastFiredAt,
    createdAt: s.createdAt,
    zone: s.zone,
    scope: s.scope,
    person: s.person,
  });
}

export function idemFind(db: Db, key: string): string | undefined {
  return str((db.all("SELECT ref_id FROM scheduler_api_idem WHERE idem_key = ?", key) as Raw[])[0]?.ref_id);
}
export function idemSave(db: Db, key: string, ref: string): void {
  db.run("INSERT OR REPLACE INTO scheduler_api_idem (idem_key, ref_id) VALUES (?, ?)", key, ref);
}

export function fireRow(db: Db, scheduleId: string, scheduledFor: number): { runId?: string } | undefined {
  const r = (
    db.all(
      "SELECT run_id FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
      scheduleId,
      String(scheduledFor),
    ) as Raw[]
  )[0];
  if (!r) return undefined;
  const runId = str(r.run_id);
  return runId !== undefined ? { runId } : {};
}
/** A fire of a time that was made and is over (the call was made): `done`. The due key of a time wake is the instant, in milliseconds, as text. */
export function saveFire(
  db: Db,
  scheduleId: string,
  scheduledFor: number,
  runId: string | undefined,
  at: number,
): void {
  db.run(
    "INSERT OR IGNORE INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, run_id, fired_at, state, ended_at) VALUES (?, ?, ?, ?, ?, 'done', ?)",
    scheduleId,
    String(scheduledFor),
    scheduledFor,
    nul(runId),
    at,
    at,
  );
}

// ---- the claim rule (P1): a fire is created once and claimed once, each a conditional write ----

export type FireState =
  | "due"
  | "claimed"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"
  | "skipped"
  | "dropped";
/** A claim is taken again when it is older than this. */
export const LEASE_MS = 2 * MINUTE;
export const fireIdOf = (scheduleId: string, dueKey: string): string => `${scheduleId}#${dueKey}`;
export function splitFireId(fireId: string): { scheduleId: string; dueKey: string } | undefined {
  const i = fireId.indexOf("#");
  return i > 0 ? { scheduleId: fireId.slice(0, i), dueKey: fireId.slice(i + 1) } : undefined;
}
/** Makes a fire due. True when this write made the row: whoever gets true goes on, whoever gets false finds it already made. */
export function createFire(
  db: Db,
  scheduleId: string,
  dueKey: string,
  scheduledFor: number,
  now: number,
  as: { state?: "due" | "skipped"; reasons?: unknown; skipReason?: string } = {},
): boolean {
  // ONE insert carries the state and the reasons: a kill cannot leave a stale fire without them
  const state = as.state ?? "due";
  return (
    db.run(
      "INSERT OR IGNORE INTO scheduler_api_fires (schedule_id, due_key, scheduled_for, fired_at, state, reasons, skip_reason, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      scheduleId,
      dueKey,
      scheduledFor,
      now,
      state,
      as.reasons === undefined ? null : js(as.reasons),
      nul(as.skipReason),
      state === "skipped" ? now : null,
    ).changes === 1
  );
}
/** Claims a due fire, or one whose claim ran out. True only for the write that changed the row. */
export function claimFire(
  db: Db,
  scheduleId: string,
  dueKey: string,
  host: string,
  now: number,
): { attempt: number } | undefined {
  const won =
    db.run(
      `UPDATE scheduler_api_fires SET state = 'claimed', claimed_by = ?, lease_until = ?, attempt = attempt + 1
         WHERE schedule_id = ? AND due_key = ? AND (state = 'due' OR (state = 'claimed' AND lease_until < ?))`,
      host,
      now + LEASE_MS,
      scheduleId,
      dueKey,
      now,
    ).changes === 1;
  if (!won) return undefined;
  const r = (
    db.all("SELECT attempt FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?", scheduleId, dueKey) as Raw[]
  )[0];
  return { attempt: num(r?.attempt) ?? 1 };
}
export function fireState(db: Db, scheduleId: string, dueKey: string): FireState | undefined {
  const r = (
    db.all("SELECT state FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?", scheduleId, dueKey) as Raw[]
  )[0];
  return r ? (str(r.state) as FireState) : undefined;
}
const OPEN: readonly FireState[] = ["claimed", "running", "waiting"];
const ENDED: readonly FireState[] = ["done", "failed", "stopped", "skipped"];
/** Moves a fire the engine holds on: running, waiting for a person, or ended. A fire that is not claimed, running or waiting does not move (a late report of a fire already ended changes nothing). */
export function reportFire(
  db: Db,
  scheduleId: string,
  dueKey: string,
  attempt: number,
  state: "running" | "waiting" | "done" | "failed" | "stopped" | "skipped",
  runId: string | undefined,
  note: string | undefined,
  now: number,
): { ok: boolean; superseded?: true } {
  const moved =
    db.run(
      `UPDATE scheduler_api_fires SET state = ?, run_id = COALESCE(?, run_id), skip_reason = COALESCE(?, skip_reason), ended_at = ?, lease_until = ?
         WHERE schedule_id = ? AND due_key = ? AND attempt = ? AND state IN ('claimed', 'running', 'waiting')`,
      state,
      nul(runId),
      nul(note),
      (ENDED as readonly string[]).includes(state) ? now : null,
      // a fire that says running or waiting has two leases from now to show a Run: the sweep closes a Run-less one only after that, measured from this report, not from when the fire was made
      state === "running" || state === "waiting" ? now + 2 * LEASE_MS : null,
      scheduleId,
      dueKey,
      attempt,
    ).changes === 1;
  if (moved) return { ok: true };
  // the fence: a claim that was taken over reports to a fire that is now another claimer's; it is told so and nothing moves
  const have = (
    db.all("SELECT attempt FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?", scheduleId, dueKey) as Raw[]
  )[0];
  const held = num(have?.attempt) ?? 0; // 0: never claimed, so nothing was taken over
  return held > 0 && held !== attempt ? { ok: false, superseded: true } : { ok: false };
}
/** Fires that say running or waiting. The sweep asks each one's Run how it really is. */
export function openRunFires(
  db: Db,
  after = 0,
  limit = SWEEP_SLICE,
): { rowid: number; scheduleId: string; dueKey: string; runId?: string; state: FireState; graceUntil: number }[] {
  return (
    db.all(
      "SELECT rowid, schedule_id, due_key, run_id, state, lease_until FROM scheduler_api_fires WHERE state IN ('running', 'waiting') AND rowid > ? ORDER BY rowid ASC LIMIT ?",
      after,
      limit,
    ) as Raw[]
  ).map((r) => ({
    rowid: num(r.rowid) ?? 0,
    scheduleId: r.schedule_id as string,
    dueKey: r.due_key as string,
    ...(str(r.run_id) !== undefined ? { runId: str(r.run_id) as string } : {}),
    state: r.state as FireState,
    graceUntil: num(r.lease_until) ?? 0,
  }));
}
/** How many open fires the sweep reads at a time: all of them are visited, oldest first, a slice after a slice. */
export const SWEEP_SLICE = 200;
/** Closes a fire the sweep found over: the Run ended, failed, was stopped or is gone. Only a running or waiting fire closes. */
export function closeFire(
  db: Db,
  scheduleId: string,
  dueKey: string,
  state: "done" | "failed" | "stopped",
  note: string,
  now: number,
): boolean {
  return (
    db.run(
      "UPDATE scheduler_api_fires SET state = ?, skip_reason = ?, ended_at = ? WHERE schedule_id = ? AND due_key = ? AND state IN ('running', 'waiting')",
      state,
      note,
      now,
      scheduleId,
      dueKey,
    ).changes === 1
  );
}
/** Due fires in a stable order: by due time, then the order they were made (rowid). Whoever works through them (the engine consumer) gets "first A then B" whatever the ids are. */
export function dueFires(db: Db, now?: number): { scheduleId: string; dueKey: string; scheduledFor: number }[] {
  // with `now`, a claim whose lease ran out counts too: it is the one to take again
  const where = now === undefined ? "state = 'due'" : "(state = 'due' OR (state = 'claimed' AND lease_until < ?))";
  return (
    db.all(
      `SELECT schedule_id, due_key, scheduled_for FROM scheduler_api_fires WHERE ${where} ORDER BY scheduled_for ASC, rowid ASC`,
      ...(now === undefined ? [] : [now]),
    ) as Raw[]
  ).map((r) => ({
    scheduleId: r.schedule_id as string,
    dueKey: r.due_key as string,
    scheduledFor: num(r.scheduled_for) ?? 0,
  }));
}
/** Is a fire of this wake open (due, claimed, running or waiting)? The overlap rule asks. */
export function openFire(db: Db, scheduleId: string): boolean {
  return (
    db.all(
      "SELECT 1 AS x FROM scheduler_api_fires WHERE schedule_id = ? AND state IN ('due', 'claimed', 'running', 'waiting') LIMIT 1",
      scheduleId,
    ).length > 0
  );
}
export { OPEN as OPEN_FIRE_STATES };

// ---- retention: bounded, one statement per pass, never a fire that is open ----

/** Most rows one pass deletes. */
export const PRUNE_BOUND = 500;
const KEEP_CALL_PER_WAKE = 20;
const KEEP_FAILED_MS = 7 * DAY;
const KEEP_HISTORY_MS = 400 * DAY;
/**
 * `call` and `baton` fires: the last 20 finished per wake, plus any that failed in the last 7 days. `routine`, `watch` and goal fires are history people read: kept 400 days. A fire that is due, claimed, running
 * or waiting is never deleted. Returns how many rows went; never more than PRUNE_BOUND.
 */
export function pruneFires(db: Db, now: number): number {
  const finished = "('done', 'failed', 'stopped', 'skipped', 'dropped')";
  return db.run(
    `DELETE FROM scheduler_api_fires WHERE rowid IN (
       SELECT f.rowid FROM scheduler_api_fires f JOIN scheduler_api_schedules s ON s.id = f.schedule_id
        WHERE f.state IN ${finished} AND (
          (s.kind IN ('call', 'baton') AND NOT (f.state = 'failed' AND f.fired_at > ?)
             AND (f.scheduled_for, f.due_key) < (
               SELECT g.scheduled_for, g.due_key FROM scheduler_api_fires g
                WHERE g.schedule_id = f.schedule_id AND g.state IN ${finished} AND NOT (g.state = 'failed' AND g.fired_at > ?)
                ORDER BY g.scheduled_for DESC, g.due_key DESC LIMIT 1 OFFSET ?))
          OR (s.kind NOT IN ('call', 'baton') AND f.fired_at < ?))
        LIMIT ?)`,
    now - KEEP_FAILED_MS,
    now - KEEP_FAILED_MS,
    KEEP_CALL_PER_WAKE - 1,
    now - KEEP_HISTORY_MS,
    PRUNE_BOUND,
  ).changes;
}

export interface MissedRow {
  scheduleId: string;
  owner: Owner;
  scheduledFor: number;
  handling: "ran_once" | "skipped";
  runId?: string;
  note?: string;
  handledAt: number;
}
export function saveMissed(db: Db, m: MissedRow): void {
  db.run(
    "INSERT OR REPLACE INTO scheduler_api_missed (schedule_id, scheduled_for, owner_kind, owner_id, handling, run_id, note, handled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    m.scheduleId,
    m.scheduledFor,
    m.owner.kind,
    m.owner.id,
    m.handling,
    nul(m.runId),
    nul(m.note),
    m.handledAt,
  );
}
export function missedSince(db: Db, since: number): MissedRow[] {
  return (
    db.all(
      "SELECT * FROM scheduler_api_missed WHERE handled_at >= ? ORDER BY handled_at ASC, schedule_id ASC",
      since,
    ) as Raw[]
  ).map((r) => {
    const m: MissedRow = {
      scheduleId: r.schedule_id as string,
      owner: { kind: r.owner_kind as string, id: r.owner_id as string },
      scheduledFor: num(r.scheduled_for) ?? 0,
      handling: r.handling === "ran_once" ? "ran_once" : "skipped",
      handledAt: num(r.handled_at) ?? 0,
    };
    const run = str(r.run_id);
    if (run !== undefined) m.runId = run;
    const note = str(r.note);
    if (note !== undefined) m.note = note;
    return m;
  });
}

// ---- waits ----

export type WaitOn = { event: string; filter?: unknown } | { run: string } | { at: number };
export type WaitState = "open" | "matched" | "expired" | "canceled";
export interface ResourceRef {
  type: string;
  id: string;
}
export interface Wait {
  id: string;
  runId: string;
  on: WaitOn;
  subject?: ResourceRef;
  threadId?: string;
  stepId?: string;
  expiresAt: number;
  cancelsOn: string[];
  state: WaitState;
  createdAt: number;
}

/** Canonical JSON (sorted keys) so the same filter always gives the same text. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Raw)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
/** FNV-1a over the canonical filter text: the `filter_hash` of the waits index. */
export function filterHash(filter: unknown): string {
  let h = 0x811c9dc5;
  for (const c of canonical(filter ?? null)) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function rowToWait(r: Raw): Wait {
  const w: Wait = {
    id: r.id as string,
    runId: r.run_id as string,
    on: json<WaitOn>(r.on_json, { at: 0 }),
    expiresAt: num(r.expires_at) ?? 0,
    cancelsOn: json<string[]>(r.cancels_on, []),
    state: r.state as WaitState,
    createdAt: num(r.created_at) ?? 0,
  };
  const st = str(r.subject_type),
    si = str(r.subject_id);
  if (st !== undefined && si !== undefined) w.subject = { type: st, id: si };
  const th = str(r.thread_id);
  if (th !== undefined) w.threadId = th;
  const sp = str(r.step_id);
  if (sp !== undefined) w.stepId = sp;
  return w;
}
export function findWait(db: Db, id: string): Wait | undefined {
  const r = (db.all("SELECT * FROM scheduler_api_waits WHERE id = ?", id) as Raw[])[0];
  return r ? rowToWait(r) : undefined;
}
export function openWaits(db: Db): Wait[] {
  return (
    db.all("SELECT * FROM scheduler_api_waits WHERE state = 'open' ORDER BY created_at ASC, id ASC") as Raw[]
  ).map(rowToWait);
}
/** Open event waits for an event type: the exact type or a family pattern (`record.*`). The index is (state, event_type, filter_hash). */
export function openEventWaits(db: Db, type: string): Wait[] {
  const family = type.includes(".") ? `${type.slice(0, type.lastIndexOf("."))}.*` : "";
  return (
    db.all(
      "SELECT * FROM scheduler_api_waits WHERE state = 'open' AND (event_type = ? OR event_type = ?) ORDER BY created_at ASC, id ASC",
      type,
      family || type,
    ) as Raw[]
  ).map(rowToWait);
}
export function saveWait(db: Db, w: Wait): void {
  const on = w.on;
  db.run(
    `INSERT OR REPLACE INTO scheduler_api_waits (id, run_id, on_json, event_type, filter_hash, target_run, at_ms, subject, subject_type, subject_id, thread_id, step_id, expires_at, cancels_on, state, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT ended_at FROM scheduler_api_waits WHERE id = ?))`,
    w.id,
    w.runId,
    js(on),
    "event" in on ? on.event : null,
    "event" in on ? filterHash(on.filter) : null,
    "run" in on ? on.run : null,
    "at" in on ? on.at : null,
    w.subject ? js(w.subject) : null,
    nul(w.subject?.type),
    nul(w.subject?.id),
    nul(w.threadId),
    nul(w.stepId),
    w.expiresAt,
    js(w.cancelsOn),
    w.state,
    w.createdAt,
    w.id,
  );
}
export function endWait(db: Db, id: string, state: WaitState, at: number): void {
  db.run("UPDATE scheduler_api_waits SET state = ?, ended_at = ? WHERE id = ? AND state = 'open'", state, at, id);
}
export function waitOut(w: Wait): Record<string, unknown> {
  return clean({
    id: w.id,
    runId: w.runId,
    on: w.on,
    subject: w.subject,
    threadId: w.threadId,
    stepId: w.stepId,
    expiresAt: w.expiresAt,
    cancelsOn: w.cancelsOn,
    state: w.state,
    createdAt: w.createdAt,
  });
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
/**
 * What a wake of each kind may name, a fixed table in code (never a free-form capability on the row), and who may make or change one. A person, an agent, a tenant service and an outside agent calling
 * scheduler.* directly cannot: only the host, or the agents module's own doors as a nested call. A plain `call` schedule is as before.
 */
export const WAKE_CAP: Readonly<Record<string, string>> = { routine: "agents.routine.fire" };
export const WAKE_DOORS: readonly string[] = [
  "agents.routine.save",
  "agents.routine.delete",
  "agents.routine.delegate",
];
export const mayMakeWake = (ctx: SchedCtx): boolean =>
  isTrustedService(ctx.principal) || (ctx.callerCap !== undefined && WAKE_DOORS.includes(ctx.callerCap));
export const mayManage = (ctx: SchedCtx, s: Pick<Schedule, "principal">): boolean =>
  isService(ctx) || s.principal === ctx.principal.id || s.principal === ctx.actingFor;
export function emitSched(ctx: SchedCtx, name: string, scheduleId: string, payload: Record<string, unknown>): void {
  ctx.emit(name, `entity/${scheduleId}`, clean({ scheduleId, ...payload }));
}
export function emitWait(ctx: SchedCtx, name: string, runId: string, payload: Record<string, unknown>): void {
  ctx.emit(name, `run/${runId}`, clean({ runId, ...payload }));
}

/** Open waits on the end of another Run. */
export function openWaitsOnRun(db: Db, target: string): Wait[] {
  return (
    db.all(
      "SELECT * FROM scheduler_api_waits WHERE state = 'open' AND target_run = ? ORDER BY created_at ASC, id ASC",
      target,
    ) as Raw[]
  ).map(rowToWait);
}
export function waitsFor(db: Db, f: { runId?: string; subject?: ResourceRef; threadId?: string }): Wait[] {
  return openWaits(db).filter(
    (w) =>
      (f.runId === undefined || w.runId === f.runId) &&
      (f.threadId === undefined || w.threadId === f.threadId) &&
      (f.subject === undefined || (w.subject?.type === f.subject.type && w.subject.id === f.subject.id)),
  );
}
