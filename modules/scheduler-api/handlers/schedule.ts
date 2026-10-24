// Schedules (spec 2.12 "if missed", 3.7; ARCH 6.8, 7.7): a capability call at a time or on a cron, run as a principal.
// DECISION: the host tick lists what is due (`dueSchedules`, exported through `tick`) and calls scheduler.fire for each with the schedule's principal as the caller; a person who is not that
//   principal cannot fire, cancel or pause it, and a service caller (the host) can. The call a schedule makes carries the key sch:<id>:<scheduledFor>, so a retried fire never repeats the call.
// DECISION: catch_up is for the time the server was down. A schedule that was due while the server was down is handled once: run_once fires the latest missed time if it is no older than the
//   missed window (setting scheduler.missed_window_minutes, 60), otherwise it is skipped with a note the owner digest shows; skip never fires. The schedule then moves on past now.
// DECISION: a one-shot (`at`) schedule ends after its fire or its skip: active false, no next time.
// DECISION: nextAt of a cron is the next wall-clock match in the schedule's zone; a local time that does not exist (clocks forward) is skipped that day, one that happens twice fires at its first pass.
import {
  CAP, MINUTE, allSchedules, clean, dueSchedules, emitSched, findSchedule, fireRow, idemFind, idemSave, isService, mayManage, me, missedSince, newId, nextFire, page, parseCron, raise,
  nextCron, openWaits, readPolicy, saveFire, saveMissed, saveSchedule, scheduleOut, validTimeZone,
} from "../projections.ts";
import type { IfMissed, MissedRow, SchedCtx, Schedule, When } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** A schedule that runs late by more than this is reported as late on its schedule.fired event. */
const LATE_MS = MINUTE;
/** A tick that is more than this behind is degraded, more than DOWN_LAG_MS down. */
const DEGRADED_LAG_MS = 2 * MINUTE;
const DOWN_LAG_MS = 30 * MINUTE;
const MAX_MISSED_STEPS = 100_000;

function checkWhen(ctx: SchedCtx, w: In): When {
  if (typeof w.cron === "string") {
    if (!parseCron(w.cron)) raise(ctx, "validation.bad_input", "That is not a cron the scheduler can read. Use five fields: minute hour day month weekday.", { reason: "bad_cron", cron: w.cron });
    const tz = typeof w.tz === "string" && w.tz ? w.tz : "UTC";
    if (!validTimeZone(tz)) raise(ctx, "validation.bad_input", "That time zone is not known.", { reason: "bad_tz", tz });
    return { cron: w.cron.trim(), tz };
  }
  return { at: w.at as number };
}

function seeSchedule(ctx: SchedCtx, id: string): Schedule {
  const s = findSchedule(ctx.db, id);
  if (!s) raise(ctx, "validation.not_found", "That schedule does not exist.", { reason: "no_such_schedule" });
  return s;
}
function manageSchedule(ctx: SchedCtx, id: string): Schedule {
  const s = seeSchedule(ctx, id);
  if (!mayManage(ctx, s)) raise(ctx, "permission.not_found", "That schedule is not available.");
  return s;
}

export async function schedule(ctx: SchedCtx, input: In): Promise<unknown> {
  const key = input.idempotencyKey as string | undefined;
  if (key) {
    const have = idemFind(ctx.db, key);
    const row = have ? findSchedule(ctx.db, have) : undefined;
    if (row) return clean({ scheduleId: row.id, nextAt: row.nextAt });
  }
  if (!CAP.test(input.cap)) raise(ctx, "validation.bad_input", "That is not a capability name.", { reason: "bad_cap", cap: input.cap });
  const when = checkWhen(ctx, input.when);
  const principal = (input.principal as string | undefined) ?? me(ctx);
  if (!isService(ctx) && principal !== ctx.principal.id && principal !== ctx.actingFor) raise(ctx, "permission.not_found", "A schedule can only run as you or as someone you act for.");
  const now = ctx.now();
  const nextAt = nextFire(when, now, true);
  if (nextAt === undefined) raise(ctx, "validation.bad_input", "That schedule never fires.", { reason: "never_fires" });
  const s: Schedule = {
    id: newId("sch", now), owner: input.owner, principal, cap: input.cap, input: input.input ?? {}, when, ifMissed: (input.ifMissed as IfMissed | undefined) ?? "run_once", active: true,
    nextAt, createdBy: ctx.principal.id, createdAt: now,
  };
  saveSchedule(ctx.db, s);
  if (key) idemSave(ctx.db, key, s.id);
  emitSched(ctx, "schedule.created", s.id, { owner: s.owner, nextAt: s.nextAt });
  return clean({ scheduleId: s.id, nextAt: s.nextAt });
}

export async function reschedule(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  if (input.when) {
    s.when = checkWhen(ctx, input.when);
    if (s.active) {
      const nextAt = nextFire(s.when, ctx.now(), true);
      if (nextAt === undefined) raise(ctx, "validation.bad_input", "That schedule never fires.", { reason: "never_fires" });
      s.nextAt = nextAt;
    }
  }
  if (input.ifMissed) s.ifMissed = input.ifMissed;
  saveSchedule(ctx.db, s);
  return { schedule: scheduleOut(s) };
}

export async function cancel(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  s.active = false;
  s.canceledAt = ctx.now();
  delete s.nextAt;
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.canceled", s.id, { owner: s.owner, by: ctx.principal.id });
  return { canceled: true };
}

export async function pause(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  if (!s.active && s.pausedReason !== undefined) return { schedule: scheduleOut(s) };   // already paused
  s.active = false;
  s.pausedReason = input.reason;
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.paused", s.id, { owner: s.owner, reason: input.reason });
  return { schedule: scheduleOut(s) };
}

export async function resume(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  if (s.pausedReason === undefined) return { schedule: scheduleOut(s) };   // not paused
  delete s.pausedReason;
  s.active = true;
  // time that passed while it was paused is not made up: a cron goes on from now, a one-shot keeps its time
  const nextAt = nextFire(s.when, ctx.now(), "at" in s.when);
  if (nextAt === undefined) { s.active = false; delete s.nextAt; } else s.nextAt = nextAt;
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.resumed", s.id, { owner: s.owner });
  return { schedule: scheduleOut(s) };
}

export async function list(ctx: SchedCtx, input: In): Promise<unknown> {
  let rows = allSchedules(ctx.db);
  if (!isService(ctx)) rows = rows.filter((s) => mayManage(ctx, s));
  if (input.owner) rows = rows.filter((s) => s.owner.kind === input.owner.kind && s.owner.id === input.owner.id);
  if (typeof input.active === "boolean") rows = rows.filter((s) => s.active === input.active);
  const p = page(rows, input.cursor, input.limit);
  return clean({ schedules: p.rows.map(scheduleOut), next: p.next, total: p.total });
}

export async function get(ctx: SchedCtx, input: In): Promise<unknown> {
  return { schedule: scheduleOut(manageSchedule(ctx, input.scheduleId)) };
}

export async function nextTimes(ctx: SchedCtx, input: In): Promise<unknown> {
  const spec = parseCron(input.cron);
  if (!spec) raise(ctx, "validation.bad_input", "That is not a cron the scheduler can read. Use five fields: minute hour day month weekday.", { reason: "bad_cron", cron: input.cron });
  if (!validTimeZone(input.tz)) raise(ctx, "validation.bad_input", "That time zone is not known.", { reason: "bad_tz", tz: input.tz });
  const times: number[] = [];
  let at = ctx.now();
  for (let i = 0; i < (input.count ?? 5); i++) {
    const n = nextCron(spec, input.tz, at);
    if (n === undefined) break;
    times.push(n);
    at = n;
  }
  return { times };
}

/** Make the call of a schedule once, for scheduledFor, and write it down. Shared by fire, catch_up and the tick. */
async function callIt(ctx: SchedCtx, s: Schedule, scheduledFor: number, key: string): Promise<string | undefined> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "The scheduler cannot make calls right now.");
  const out = (await ctx.call(s.cap, s.input ?? {}, { idempotencyKey: key })) as { runId?: unknown } | null;
  const id = out && typeof out === "object" ? out.runId : undefined;
  return typeof id === "string" && id.startsWith("run_") ? id : undefined;
}

export async function fire(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  const scheduledFor = input.scheduledFor as number;
  const done = fireRow(ctx.db, s.id, scheduledFor);
  if (done) return clean({ runId: done.runId });   // the same time never fires twice
  if (!s.active) return {};                         // paused schedules do not fire
  const now = ctx.now();
  const runId = await callIt(ctx, s, scheduledFor, `sch:${s.id}:${scheduledFor}`);
  saveFire(ctx.db, s.id, scheduledFor, runId, now);
  s.lastFiredAt = now;
  advance(s, scheduledFor);
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.fired", s.id, { owner: s.owner, runId, scheduledFor, late: now - scheduledFor > LATE_MS });
  return clean({ runId });
}

/** After a fire of `after`: a cron takes its next match, a one-shot ends. */
function advance(s: Schedule, after: number): void {
  const next = "at" in s.when ? undefined : nextFire(s.when, after);
  if (next === undefined) { s.active = false; delete s.nextAt; } else s.nextAt = next;
}

export async function runNow(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  const now = ctx.now();
  const runId = (await callIt(ctx, s, now, `sch-now:${s.id}:${ctx.trace.traceId}`)) ?? ctx.run;
  if (!runId) raise(ctx, "validation.precondition_failed", "That schedule's call does not start a run.", { reason: "no_run" });
  s.lastFiredAt = now;   // nextAt stays: the cron is not changed
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.fired", s.id, { owner: s.owner, runId, scheduledFor: now, late: false });
  return { runId };
}

/** Every fire time of a schedule from its stored next time up to now: how many, and the latest. */
function missedTimes(s: Schedule, now: number, since: number): { latest: number; count: number } | undefined {
  let at = s.nextAt;
  if (at === undefined || at > now) return undefined;
  if ("at" in s.when) return at > since ? { latest: at, count: 1 } : undefined;
  let latest: number | undefined;
  let count = 0;
  for (let i = 0; i < MAX_MISSED_STEPS && at !== undefined && at <= now; i++) {
    if (at > since) { latest = at; count += 1; }
    at = nextFire(s.when, at);
  }
  return latest === undefined ? undefined : { latest, count };
}

export async function catchUp(ctx: SchedCtx, input: In): Promise<unknown> {
  const now = ctx.now();
  const window = readPolicy(ctx.db).missedWindowMs;
  let ranOnce = 0;
  let skipped = 0;
  for (const s of dueSchedules(ctx.db, now)) {
    const miss = missedTimes(s, now, input.since as number);
    const moveOn = (): void => { if ("at" in s.when) { s.active = false; delete s.nextAt; } else { const n = nextFire(s.when, now); if (n === undefined) { s.active = false; delete s.nextAt; } else s.nextAt = n; } };
    if (!miss) { moveOn(); saveSchedule(ctx.db, s); continue; }
    const late = now - miss.latest;
    const earlier = miss.count > 1 ? ` ${miss.count - 1} earlier time${miss.count === 2 ? "" : "s"} were skipped too.` : "";
    const row: MissedRow = { scheduleId: s.id, owner: s.owner, scheduledFor: miss.latest, handling: "skipped", handledAt: now };
    if (s.ifMissed === "run_once" && late <= window && !fireRow(ctx.db, s.id, miss.latest)) {
      const runId = await callIt(ctx, s, miss.latest, `sch:${s.id}:${miss.latest}`);
      saveFire(ctx.db, s.id, miss.latest, runId, now);
      s.lastFiredAt = now;
      row.handling = "ran_once";
      if (runId) row.runId = runId;
      if (earlier) row.note = earlier.trim();
      ranOnce += 1;
      moveOn();
      saveSchedule(ctx.db, s);
      saveMissed(ctx.db, row);
      emitSched(ctx, "schedule.missed", s.id, clean({ owner: s.owner, scheduledFor: miss.latest, handling: "ran_once", note: row.note }));
      emitSched(ctx, "schedule.fired", s.id, { owner: s.owner, runId, scheduledFor: miss.latest, late: true });
    } else {
      row.note = s.ifMissed === "skip"
        ? `Skipped by its if-missed rule; it was due ${Math.round(late / MINUTE)} minutes ago.${earlier}`
        : `Skipped: it was due ${Math.round(late / MINUTE)} minutes ago, longer than the ${Math.round(window / MINUTE)} minute window.${earlier}`;
      skipped += 1;
      moveOn();
      saveSchedule(ctx.db, s);
      saveMissed(ctx.db, row);
      emitSched(ctx, "schedule.missed", s.id, { owner: s.owner, scheduledFor: miss.latest, handling: "skipped", note: row.note });
    }
  }
  return { ranOnce, skipped };
}

export async function missed(ctx: SchedCtx, input: In): Promise<unknown> {
  const rows = missedSince(ctx.db, input.since).filter((m) => isService(ctx) || m.owner.id === me(ctx) || findSchedule(ctx.db, m.scheduleId)?.principal === me(ctx));
  return { missed: rows.map((m) => clean({ scheduleId: m.scheduleId, owner: m.owner, scheduledFor: m.scheduledFor, handling: m.handling, runId: m.runId })) };
}

export async function status(ctx: SchedCtx): Promise<unknown> {
  const now = ctx.now();
  const due = dueSchedules(ctx.db, now);
  const lag = due.length ? now - due[0]!.nextAt! : 0;
  const state = lag > DOWN_LAG_MS ? "down" : lag > DEGRADED_LAG_MS ? "degraded" : "healthy";
  return clean({
    state, tickLagMs: lag, dueNow: due.length, openWaits: openWaits(ctx.db).length,
    detail: due.length ? `${due.length} schedule${due.length === 1 ? " is" : "s are"} due; the oldest is ${Math.round(lag / 1000)} seconds late.` : undefined,
  });
}

/**
 * The host tick: fire every schedule that is due, oldest first, one by one. A failing call is counted and left for the next tick (the schedule keeps its time);
 * it never stops the others. The daemon calls this as the schedule's principal through scheduler.fire; this form is for a service ctx that may act for all.
 */
export async function tick(ctx: SchedCtx): Promise<{ fired: string[]; failed: { scheduleId: string; error: string }[] }> {
  const out = { fired: [] as string[], failed: [] as { scheduleId: string; error: string }[] };
  for (const s of dueSchedules(ctx.db, ctx.now())) {
    try {
      await fire(ctx, { scheduleId: s.id, scheduledFor: s.nextAt! });
      out.fired.push(s.id);
    } catch (e) {
      out.failed.push({ scheduleId: s.id, error: (e as { message?: string } | null)?.message ?? "failed" });
    }
  }
  return out;
}
