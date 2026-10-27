// One schedule model: a friendly preset and an advanced cron both store cron + time zone + missed policy.
// Missed ticks are skip, one run for the whole gap, or one run per tick. Backfill is oldest first, under lookback, cap, spacing and overlap.
// A backlog larger than the cap starts nothing, pauses that schedule only, and asks for one Needs You request.
// The request uses tasks.create (kind unblock, which tasks.needs_you lists) and notifications.send collapseKey. It does not open a second task store.
// Tick ids are deterministic. A tick that was already claimed is not started again, including after a restart.
// When a schedule is first enabled, set the cursor to now so earlier history is not treated as a backlog.

import { nextCron, nextOccurrences, parseCron, summarizeCron, validTimeZone } from "./cron.ts";
import type { CronSpec } from "./cron.ts";

export const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_BACKFILL_CAP = 500;
export const DEFAULT_ON_TIME_MS = 60_000;
const MAX_SCAN = 50_000;
const PREVIEW_LIMIT = 50;

export type MissedPolicy = "skip" | "run_once" | "backfill_each_tick";
export type OverlapPolicy = "queue" | "skip_while_active" | "bounded_concurrency";
export type ScheduleChoiceKey = "run_first_n" | "run_latest_n" | "skip_backlog_and_resume" | "change_limits" | "keep_paused";

export interface ScheduleChoiceDef {
  key: ScheduleChoiceKey;
  label: string;
}

/** The recovery choices named for an over-cap backlog. `applyScheduleChoice` is the handler the request points at. */
export const SCHEDULE_CHOICES: readonly ScheduleChoiceDef[] = [
  { key: "run_first_n", label: "Run first N" },
  { key: "run_latest_n", label: "Run latest N" },
  { key: "skip_backlog_and_resume", label: "Skip backlog and resume" },
  { key: "change_limits", label: "Change limits" },
  { key: "keep_paused", label: "Keep paused" },
];

export const SCHEDULE_CHOICE_HANDLER = "applyScheduleChoice";

/** Stable dedup key for the one open Needs You request. Keep in step with host/src/seams/automation-schedule.ts. */
export function scheduleRequestKey(automationId: string): string {
  return `automation-schedule:${automationId}`;
}

/** Deterministic tick id: the automation plus the scheduled timestamp. The same id is never claimed twice. */
export function tickId(automationId: string, fireAt: number): string {
  return `${automationId}:${fireAt}`;
}

export type FriendlyPreset =
  | { kind: "every_minutes"; n: number }
  | { kind: "every_hours"; n: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "selected_days"; weekdays: number[]; hour: number; minute: number }
  | { kind: "monthly"; day: number; hour: number; minute: number };

export interface AutomationSchedule {
  automationId: string;
  cron: string;
  timezone: string;
  missed: MissedPolicy;
  startAt?: number;
  endAt?: number;
  lookbackMs?: number;
  cap?: number;
  spacingMs?: number;
  overlap?: OverlapPolicy;
  concurrency?: number;
}

export interface TickPlan {
  automationId: string;
  tickId: string;
  fireAt: number;
}

export interface NeedsYouNotification {
  to: string;
  kind: "limit.hit";
  collapseKey: string;
  title: string;
  body: string;
  data: { title: string; backlogCount: number };
}

export interface NeedsYouTaskInput {
  kind: "unblock";
  title: string;
  summary: string;
  why: string;
  assigned: { kind: "person"; id: string };
  source: { kind: "manual"; id: string };
  blocks: { type: string; v: number; data: Record<string, unknown> }[];
  idempotencyKey: string;
}

/** One unblock task for the owner, followers for shared recipients, and one collapsed notification each. */
export interface NeedsYouRequest {
  dedupKey: string;
  handler: typeof SCHEDULE_CHOICE_HANDLER;
  backlogCount: number;
  /** Timestamps to show. Not a start list. */
  preview: number[];
  choices: ScheduleChoiceDef[];
  ownerId: string;
  sharedRecipientIds: string[];
  task: NeedsYouTaskInput;
  followers: string[];
  notifications: NeedsYouNotification[];
}

export interface SchedulePlan {
  ticks: TickPlan[];
  /** Unstarted timestamps in the gap, oldest first. Present so a person can preview without starting runs. */
  backlog: number[];
  backlogCount: number;
  paused: boolean;
  pausedReason?: string;
  /** Watermark to store. Occurrences at or before this are decided. */
  cursor: number;
  nextAt?: number;
  /** Next fires after now, for the editor. */
  upcoming: number[];
  request?: NeedsYouRequest;
  /** True when the overflow request is already open, so nothing new is created. */
  deduped: boolean;
  skippedTickIds: string[];
  timezone: string;
  summary: string;
}

export type SchedulePlanResult = { ok: true; plan: SchedulePlan } | { ok: false; error: "bad_cron" | "bad_timezone" | "bad_bounds" | "missing_guardrails" | "bad_policy"; message: string };

export interface PlanContext {
  now: number;
  /** Last decided scheduled timestamp. Occurrences strictly after this, and at or before now, are the gap. */
  cursor: number;
  startedTickIds?: ReadonlySet<string>;
  /** Wall time of the last start. Spacing is measured from this. */
  lastStartedAt?: number;
  activeRunCount?: number;
  openRequestKeys?: ReadonlySet<string>;
  paused?: boolean;
  /** A due tick newer than this is on time. Older gaps are missed. Default one minute. */
  onTimeMs?: number;
  ownerId: string;
  sharedRecipientIds?: readonly string[];
}

export interface Guardrails {
  lookbackMs: number;
  cap: number;
  spacingMs: number;
  overlap: OverlapPolicy;
  concurrency: number;
}

const OVERLAPS = new Set<OverlapPolicy>(["queue", "skip_while_active", "bounded_concurrency"]);

function message(error: Exclude<SchedulePlanResult, { ok: true }>["error"]): string {
  if (error === "bad_cron") return "That cron is not valid. Use five fields: minute hour day month weekday.";
  if (error === "bad_timezone") return "That time zone is not valid.";
  if (error === "bad_bounds") return "The schedule end is before its start.";
  if (error === "bad_policy") return "The missed policy must be skip, run once, or backfill each tick.";
  return "Backfill needs a lookback, a cap, spacing, and an overlap rule.";
}

function fail(error: Exclude<SchedulePlanResult, { ok: true }>["error"]): SchedulePlanResult {
  return { ok: false, error, message: message(error) };
}

export function clampBackfill(spec: Pick<AutomationSchedule, "lookbackMs" | "cap" | "spacingMs" | "overlap" | "concurrency">): { ok: true; guards: Guardrails } | { ok: false; error: "missing_guardrails" } {
  if (spec.lookbackMs === undefined || spec.cap === undefined || spec.spacingMs === undefined || spec.overlap === undefined) return { ok: false, error: "missing_guardrails" };
  if (!Number.isFinite(spec.lookbackMs) || spec.lookbackMs <= 0) return { ok: false, error: "missing_guardrails" };
  if (!Number.isInteger(spec.cap) || spec.cap < 1) return { ok: false, error: "missing_guardrails" };
  if (!Number.isFinite(spec.spacingMs) || spec.spacingMs < 0) return { ok: false, error: "missing_guardrails" };
  if (!OVERLAPS.has(spec.overlap)) return { ok: false, error: "missing_guardrails" };
  const cap = Math.min(spec.cap, MAX_BACKFILL_CAP);
  let concurrency = 1;
  if (spec.overlap === "bounded_concurrency") {
    if (spec.concurrency === undefined || !Number.isInteger(spec.concurrency) || spec.concurrency < 1) return { ok: false, error: "missing_guardrails" };
    concurrency = Math.min(spec.concurrency, cap);
  }
  return { ok: true, guards: { lookbackMs: Math.min(spec.lookbackMs, MAX_LOOKBACK_MS), cap, spacingMs: spec.spacingMs, overlap: spec.overlap, concurrency } };
}

function clockOk(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function dayField(days: number[]): string | undefined {
  const uniq = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (uniq.length === 0 || uniq.length !== days.length) return undefined;
  if (uniq.length === 5 && uniq[0] === 1 && uniq[4] === 5) return "1-5";
  return uniq.join(",");
}

/** Compile a friendly preset to the cron that is stored. */
export function compilePreset(preset: FriendlyPreset): { ok: true; cron: string } | { ok: false; error: string } {
  if (preset.kind === "every_minutes") {
    if (!Number.isInteger(preset.n) || preset.n < 1 || preset.n > 59) return { ok: false, error: "Minutes must be from 1 to 59." };
    return { ok: true, cron: preset.n === 1 ? "* * * * *" : `*/${preset.n} * * * *` };
  }
  if (preset.kind === "every_hours") {
    if (!Number.isInteger(preset.n) || preset.n < 1 || preset.n > 23) return { ok: false, error: "Hours must be from 1 to 23." };
    return { ok: true, cron: preset.n === 1 ? "0 * * * *" : `0 */${preset.n} * * *` };
  }
  if (!clockOk(preset.hour, preset.minute)) return { ok: false, error: "Use an hour from 0 to 23 and a minute from 0 to 59." };
  const hm = `${preset.minute} ${preset.hour}`;
  if (preset.kind === "daily") return { ok: true, cron: `${hm} * * *` };
  if (preset.kind === "weekdays") return { ok: true, cron: `${hm} * * 1-5` };
  if (preset.kind === "weekly") {
    if (!Number.isInteger(preset.weekday) || preset.weekday < 0 || preset.weekday > 6) return { ok: false, error: "Weekday must be 0 (Sunday) through 6 (Saturday)." };
    return { ok: true, cron: `${hm} * * ${preset.weekday}` };
  }
  if (preset.kind === "selected_days") {
    const field = dayField(preset.weekdays);
    if (!field) return { ok: false, error: "Pick at least one weekday, 0 (Sunday) through 6 (Saturday)." };
    return { ok: true, cron: `${hm} * * ${field}` };
  }
  if (!Number.isInteger(preset.day) || preset.day < 1 || preset.day > 31) return { ok: false, error: "The day of the month must be from 1 to 31." };
  return { ok: true, cron: `${hm} ${preset.day} * *` };
}

export interface CanonicalInput {
  automationId: string;
  timezone: string;
  missed: MissedPolicy;
  preset?: FriendlyPreset;
  cron?: string;
  startAt?: number;
  endAt?: number;
  lookbackMs?: number;
  cap?: number;
  spacingMs?: number;
  overlap?: OverlapPolicy;
  concurrency?: number;
}

/** Preset or advanced cron, stored as the same cron plus time zone plus missed policy. A preset wins when both are sent. */
export function canonicalSchedule(input: CanonicalInput): { ok: true; schedule: AutomationSchedule; summary: string } | { ok: false; error: string } {
  if (!input.automationId) return { ok: false, error: "An automation id is required." };
  if (!validTimeZone(input.timezone)) return { ok: false, error: "That time zone is not valid." };
  if (input.missed !== "skip" && input.missed !== "run_once" && input.missed !== "backfill_each_tick") return { ok: false, error: "The missed policy must be skip, run once, or backfill each tick." };
  if (input.startAt !== undefined && input.endAt !== undefined && input.endAt < input.startAt) return { ok: false, error: "The schedule end is before its start." };
  let cron = input.cron?.trim() ?? "";
  if (input.preset) {
    const compiled = compilePreset(input.preset);
    if (!compiled.ok) return compiled;
    cron = compiled.cron;
  }
  if (!cron || !parseCron(cron)) return { ok: false, error: "That cron is not valid. Use five fields: minute hour day month weekday." };
  const summary = summarizeCron(cron);
  if (!summary) return { ok: false, error: "That cron is not valid. Use five fields: minute hour day month weekday." };
  const schedule: AutomationSchedule = { automationId: input.automationId, cron, timezone: input.timezone, missed: input.missed };
  if (input.startAt !== undefined) schedule.startAt = input.startAt;
  if (input.endAt !== undefined) schedule.endAt = input.endAt;
  if (input.lookbackMs !== undefined) schedule.lookbackMs = input.lookbackMs;
  if (input.cap !== undefined) schedule.cap = input.cap;
  if (input.spacingMs !== undefined) schedule.spacingMs = input.spacingMs;
  if (input.overlap !== undefined) schedule.overlap = input.overlap;
  if (input.concurrency !== undefined) schedule.concurrency = input.concurrency;
  return { ok: true, schedule, summary };
}

function uniq(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function previewOf(times: readonly number[]): number[] {
  if (times.length <= PREVIEW_LIMIT) return [...times];
  return [...times.slice(0, PREVIEW_LIMIT / 2), ...times.slice(-(PREVIEW_LIMIT / 2))];
}

/** The unblock request and the collapsed notifications. Does not create anything. */
export function buildNeedsYouRequest(input: { automationId: string; backlogCount: number; preview: readonly number[]; cap: number; ownerId: string; sharedRecipientIds?: readonly string[] }): NeedsYouRequest {
  const dedupKey = scheduleRequestKey(input.automationId);
  const shared = uniq(input.sharedRecipientIds ?? []).filter((id) => id !== input.ownerId);
  const recipients = uniq([input.ownerId, ...shared]);
  const title = "Schedule backlog is over its cap";
  const summary = `${input.backlogCount} missed runs are waiting. This schedule is paused. You can run the first N, run the latest N, skip the backlog and resume, change the limits, or keep it paused.`;
  const why = `The backlog of ${input.backlogCount} is larger than the cap of ${input.cap}. No runs were started.`;
  const preview = previewOf(input.preview);
  return {
    dedupKey,
    handler: SCHEDULE_CHOICE_HANDLER,
    backlogCount: input.backlogCount,
    preview,
    choices: [...SCHEDULE_CHOICES],
    ownerId: input.ownerId,
    sharedRecipientIds: shared,
    task: {
      kind: "unblock",
      title,
      summary,
      why,
      assigned: { kind: "person", id: input.ownerId },
      source: { kind: "manual", id: dedupKey },
      idempotencyKey: dedupKey,
      blocks: [{
        type: "checklist",
        v: 1,
        data: { handler: SCHEDULE_CHOICE_HANDLER, dedupKey, automationId: input.automationId, backlogCount: input.backlogCount, preview, choices: [...SCHEDULE_CHOICES] },
      }],
    },
    followers: shared,
    notifications: recipients.map((to) => ({
      to,
      kind: "limit.hit" as const,
      collapseKey: dedupKey,
      title,
      body: why,
      data: { title, backlogCount: input.backlogCount },
    })),
  };
}

interface Collected { times: number[]; truncated: boolean }

function collect(spec: CronSpec, tz: string, after: number, until: number, startAt: number | undefined, limit: number): Collected {
  const times: number[] = [];
  let at = after;
  if (startAt !== undefined && startAt - 1 > at) at = startAt - 1;
  for (let i = 0; i < limit; i++) {
    const n = nextCron(spec, tz, at);
    if (n === undefined || n > until) return { times, truncated: false };
    at = n;
    if (startAt !== undefined && n < startAt) continue;
    times.push(n);
  }
  const more = nextCron(spec, tz, at);
  return { times, truncated: more !== undefined && more <= until };
}

function upcomingOf(schedule: AutomationSchedule, now: number): { upcoming: number[]; nextAt?: number } {
  const found = nextOccurrences(schedule.cron, schedule.timezone, now, 5, { startAt: schedule.startAt, endAt: schedule.endAt });
  if ("error" in found) return { upcoming: [] };
  const first = found.times[0];
  return first === undefined ? { upcoming: found.times } : { upcoming: found.times, nextAt: first };
}

function basePlan(schedule: AutomationSchedule, summary: string, cursor: number, now: number, extra: { ticks: TickPlan[]; backlog: number[]; paused: boolean; pausedReason?: string; deduped: boolean; skippedTickIds: string[]; request?: NeedsYouRequest }): SchedulePlan {
  const up = upcomingOf(schedule, now);
  const plan: SchedulePlan = {
    ticks: extra.ticks,
    backlog: extra.backlog,
    backlogCount: extra.backlog.length,
    paused: extra.paused,
    cursor,
    upcoming: up.upcoming,
    deduped: extra.deduped,
    skippedTickIds: extra.skippedTickIds,
    timezone: schedule.timezone,
    summary,
  };
  if (up.nextAt !== undefined) plan.nextAt = up.nextAt;
  if (extra.pausedReason !== undefined) plan.pausedReason = extra.pausedReason;
  if (extra.request !== undefined) plan.request = extra.request;
  return plan;
}

function startBudget(guards: Guardrails, ctx: PlanContext): number {
  const active = ctx.activeRunCount ?? 0;
  if (guards.overlap === "skip_while_active" && active > 0) return 0;
  const spacingOk = guards.spacingMs <= 0 || ctx.lastStartedAt === undefined || ctx.now - ctx.lastStartedAt >= guards.spacingMs;
  if (!spacingOk) return 0;
  let room = Number.POSITIVE_INFINITY;
  if (guards.overlap === "bounded_concurrency") {
    room = guards.concurrency - active;
    if (room <= 0) return 0;
  }
  return guards.spacingMs > 0 ? Math.min(1, room) : room;
}

/** Decide which ticks would start. Does not start runs and does not write a task. */
export function planSchedule(schedule: AutomationSchedule, ctx: PlanContext): SchedulePlanResult {
  if (schedule.startAt !== undefined && schedule.endAt !== undefined && schedule.endAt < schedule.startAt) return fail("bad_bounds");
  if (!validTimeZone(schedule.timezone)) return fail("bad_timezone");
  const spec = parseCron(schedule.cron);
  if (!spec) return fail("bad_cron");
  const summary = summarizeCron(schedule.cron) ?? schedule.cron;
  if (schedule.missed !== "skip" && schedule.missed !== "run_once" && schedule.missed !== "backfill_each_tick") return fail("bad_policy");
  const started = ctx.startedTickIds ?? new Set<string>();
  const open = ctx.openRequestKeys ?? new Set<string>();
  const key = scheduleRequestKey(schedule.automationId);
  const deduped = open.has(key);
  const until = schedule.endAt !== undefined ? Math.min(ctx.now, schedule.endAt) : ctx.now;
  let scanAfter = ctx.cursor;
  let guards: Guardrails | undefined;
  if (schedule.missed === "backfill_each_tick") {
    const clamped = clampBackfill(schedule);
    if (!clamped.ok) return fail("missing_guardrails");
    guards = clamped.guards;
    const windowStart = ctx.now - guards.lookbackMs;
    if (windowStart - 1 > scanAfter) scanAfter = windowStart - 1;
  }
  const raw = collect(spec, schedule.timezone, scanAfter, until, schedule.startAt, MAX_SCAN);
  const eligible = raw.times.filter((t) => t > ctx.cursor && t <= ctx.now);
  const unstarted = eligible.filter((t) => !started.has(tickId(schedule.automationId, t)));

  if (schedule.missed === "backfill_each_tick" && guards) {
    const over = raw.truncated || unstarted.length > guards.cap;
    if (over) {
      const built = deduped ? undefined : buildNeedsYouRequest({
        automationId: schedule.automationId,
        backlogCount: unstarted.length,
        preview: unstarted,
        cap: guards.cap,
        ownerId: ctx.ownerId,
        ...(ctx.sharedRecipientIds === undefined ? {} : { sharedRecipientIds: ctx.sharedRecipientIds }),
      });
      return {
        ok: true,
        plan: basePlan(schedule, summary, ctx.cursor, ctx.now, {
          ticks: [],
          backlog: unstarted,
          paused: true,
          pausedReason: "backfill_over_cap",
          deduped,
          skippedTickIds: [],
          ...(built === undefined ? {} : { request: built }),
        }),
      };
    }
  }

  if (ctx.paused) {
    return { ok: true, plan: basePlan(schedule, summary, ctx.cursor, ctx.now, { ticks: [], backlog: unstarted, paused: true, deduped, skippedTickIds: [] }) };
  }

  if (schedule.missed === "skip" || schedule.missed === "run_once") {
    if (unstarted.length === 0 && eligible.length === 0) {
      return { ok: true, plan: basePlan(schedule, summary, ctx.cursor, ctx.now, { ticks: [], backlog: [], paused: false, deduped: false, skippedTickIds: [] }) };
    }
    const latest = eligible[eligible.length - 1];
    if (latest === undefined) {
      return { ok: true, plan: basePlan(schedule, summary, ctx.cursor, ctx.now, { ticks: [], backlog: [], paused: false, deduped: false, skippedTickIds: [] }) };
    }
    const onTime = ctx.now - latest <= (ctx.onTimeMs ?? DEFAULT_ON_TIME_MS);
    const latestId = tickId(schedule.automationId, latest);
    const startLatest = schedule.missed === "run_once" || onTime;
    const ticks: TickPlan[] = startLatest && !started.has(latestId) ? [{ automationId: schedule.automationId, tickId: latestId, fireAt: latest }] : [];
    const skipped = eligible.filter((t) => t !== latest || !startLatest).map((t) => tickId(schedule.automationId, t)).filter((id) => !started.has(id) && !ticks.some((tick) => tick.tickId === id));
    return { ok: true, plan: basePlan(schedule, summary, latest, ctx.now, { ticks, backlog: unstarted, paused: false, deduped: false, skippedTickIds: skipped }) };
  }

  if (!guards) return fail("missing_guardrails");
  const skipping = guards.overlap === "skip_while_active" && (ctx.activeRunCount ?? 0) > 0;
  let budget = startBudget(guards, ctx);
  let cursor = ctx.cursor;
  const ticks: TickPlan[] = [];
  const skipped: string[] = [];
  for (const ts of eligible) {
    const id = tickId(schedule.automationId, ts);
    if (started.has(id)) {
      cursor = ts;
      continue;
    }
    if (skipping) {
      skipped.push(id);
      cursor = ts;
      continue;
    }
    if (budget <= 0) break;
    ticks.push({ automationId: schedule.automationId, tickId: id, fireAt: ts });
    budget -= 1;
    cursor = ts;
  }
  return { ok: true, plan: basePlan(schedule, summary, cursor, ctx.now, { ticks, backlog: unstarted, paused: false, deduped: false, skippedTickIds: skipped }) };
}

export interface ChoiceLimits {
  lookbackMs?: number;
  cap?: number;
  spacingMs?: number;
  overlap?: OverlapPolicy;
  concurrency?: number;
}

export type ChoiceResult = {
  ok: true;
  paused: boolean;
  pausedReason?: string;
  clearRequest: boolean;
  ticks: TickPlan[];
  /** Set when the watermark should move. Absent means leave it. */
  cursor?: number;
  spec: AutomationSchedule;
  skippedTickIds: string[];
} | { ok: false; error: string };

function takeN(backlog: readonly number[], n: number, which: "first" | "latest"): number[] {
  const count = Math.min(n, backlog.length);
  const slice = which === "first" ? backlog.slice(0, count) : backlog.slice(backlog.length - count);
  return [...slice].sort((a, b) => a - b);
}

/**
 * Apply one recovery choice to a captured backlog. Does not start runs.
 * Run first N and run latest N start at most the cap, oldest first within that set, and skip the rest.
 * Skip backlog resumes without starts. Change limits stays paused and keeps the request open. Keep paused closes the request and stays paused.
 */
export function applyScheduleChoice(
  spec: AutomationSchedule,
  backlog: readonly number[],
  startedTickIds: ReadonlySet<string>,
  choice: ScheduleChoiceKey,
  opts: { n?: number; limits?: ChoiceLimits; now: number; cursor: number },
): ChoiceResult {
  const ordered = [...backlog].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const fresh = ordered.filter((t) => !startedTickIds.has(tickId(spec.automationId, t)));
  if (choice === "change_limits") {
    const next: AutomationSchedule = { ...spec };
    const limits = opts.limits ?? {};
    if (limits.lookbackMs !== undefined) next.lookbackMs = limits.lookbackMs;
    if (limits.cap !== undefined) next.cap = limits.cap;
    if (limits.spacingMs !== undefined) next.spacingMs = limits.spacingMs;
    if (limits.overlap !== undefined) next.overlap = limits.overlap;
    if (limits.concurrency !== undefined) next.concurrency = limits.concurrency;
    const clamped = clampBackfill(next);
    if (!clamped.ok) return { ok: false, error: "Backfill needs a lookback, a cap, spacing, and an overlap rule." };
    next.lookbackMs = clamped.guards.lookbackMs;
    next.cap = clamped.guards.cap;
    next.spacingMs = clamped.guards.spacingMs;
    next.overlap = clamped.guards.overlap;
    if (next.overlap === "bounded_concurrency") next.concurrency = clamped.guards.concurrency;
    return { ok: true, paused: true, pausedReason: "backfill_over_cap", clearRequest: false, ticks: [], spec: next, skippedTickIds: [] };
  }
  if (choice === "keep_paused") {
    return { ok: true, paused: true, pausedReason: "kept_paused", clearRequest: true, ticks: [], spec, skippedTickIds: [] };
  }
  const cap = Math.min(spec.cap ?? MAX_BACKFILL_CAP, MAX_BACKFILL_CAP);
  if (choice === "skip_backlog_and_resume") {
    return finishChoice(spec, fresh, [], opts.cursor);
  }
  if (choice !== "run_first_n" && choice !== "run_latest_n") return { ok: false, error: "That is not a schedule recovery choice." };
  const asked = opts.n ?? cap;
  if (!Number.isInteger(asked) || asked < 1) return { ok: false, error: "N must be a positive whole number." };
  const n = Math.min(asked, cap, fresh.length);
  const selected = new Set(takeN(fresh, n, choice === "run_first_n" ? "first" : "latest"));
  const ticks = [...selected].sort((a, b) => a - b).map((fireAt) => ({ automationId: spec.automationId, tickId: tickId(spec.automationId, fireAt), fireAt }));
  return finishChoice(spec, fresh.filter((t) => !selected.has(t)), ticks, opts.cursor, fresh[fresh.length - 1]);
}

function finishChoice(spec: AutomationSchedule, skipped: readonly number[], ticks: TickPlan[], cursor: number, end?: number): ChoiceResult {
  const skippedTickIds = skipped.map((t) => tickId(spec.automationId, t));
  const moved = end === undefined ? skipped[skipped.length - 1] : end;
  const done = { ok: true as const, paused: false, clearRequest: true, ticks, spec, skippedTickIds };
  return moved === undefined ? done : { ...done, cursor: Math.max(cursor, moved) };
}
