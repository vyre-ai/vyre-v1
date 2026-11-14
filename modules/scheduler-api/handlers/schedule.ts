// Schedules (spec 2.12 "if missed", 3.7; ARCH 6.8, 7.7): a capability call at a time or on a cron, run as a principal.
// DECISION: the host tick lists what is due (`dueSchedules`, exported through `tick`) and calls scheduler.fire for each with the schedule's principal as the caller; a person who is not that
//   principal cannot fire, cancel or pause it, and a service caller (the host) can. The call a schedule makes carries the key sch:<id>:<scheduledFor>, so a retried fire never repeats the call.
// DECISION: catch_up is for the time the server was down. A schedule that was due while the server was down is handled once: run_once fires the latest missed time if it is no older than the
//   missed window (setting scheduler.missed_window_minutes, 60), otherwise it is skipped with a note the owner digest shows; skip never fires. The schedule then moves on past now.
// DECISION: a one-shot (`at`) schedule ends after its fire or its skip: active false, no next time.
// DECISION: nextAt of a cron is the next wall-clock match in the schedule's zone; a local time that does not exist (clocks forward) is skipped that day, one that happens twice fires at its first pass.
import {
  CAP,
  MINUTE,
  allSchedules,
  clean,
  dueSchedules,
  emitSched,
  findSchedule,
  fireRow,
  idemFind,
  claimFire,
  closeFire,
  dropOpenFires,
  noteFire,
  createFire,
  LEASE_MS,
  WAKE_CAP,
  dueFires,
  mayMakeWake,
  openRunFires,
  fireIdOf,
  fireState,
  idemSave,
  isService,
  mayManage,
  me,
  missedSince,
  newId,
  nextFire,
  page,
  parseCron,
  raise,
  nextCron,
  openWaits,
  pruneFires,
  readPolicy,
  reportFire,
  saveFire,
  saveMissed,
  saveSchedule,
  scheduleOut,
  splitFireId,
  wakeOf,
  validTimeZone,
} from "../projections.ts";
import type { IfMissed, MissedRow, SchedCtx, Schedule, When } from "../projections.ts";
import { isTrustedService } from "../../../lib/trust.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A schedule that runs late by more than this is reported as late on its schedule.fired event. */
const LATE_MS = MINUTE;
/** A tick that is more than this behind is degraded, more than DOWN_LAG_MS down. */
const DEGRADED_LAG_MS = 2 * MINUTE;
const DOWN_LAG_MS = 30 * MINUTE;
const MAX_MISSED_STEPS = 100_000;

function checkWhen(ctx: SchedCtx, w: In): When {
  if (typeof w.cron === "string") {
    if (!parseCron(w.cron))
      raise(
        ctx,
        "validation.bad_input",
        "That is not a cron the scheduler can read. Use five fields: minute hour day month weekday.",
        { reason: "bad_cron", cron: w.cron },
      );
    const tz = typeof w.tz === "string" && w.tz ? w.tz : "UTC";
    if (!validTimeZone(tz))
      raise(ctx, "validation.bad_input", "That time zone is not known.", { reason: "bad_tz", tz });
    return { cron: w.cron.trim(), tz };
  }
  return { at: w.at as number };
}

function seeSchedule(ctx: SchedCtx, id: string): Schedule {
  const s = findSchedule(ctx.db, id);
  if (!s) raise(ctx, "validation.not_found", "That schedule does not exist.", { reason: "no_such_schedule" });
  return s;
}
/**
 * Who may see and change one schedule. A plain call: the person whose principal it is, or the server. A wake of another kind has no person's standing of its own (the routine row is where standing lives):
 * only the host, or a nested call from the agents module's own door, after that door has checked the person may edit THAT routine. So a routine handed to someone else is the new owner's through the door
 * at once, and the old owner has no way in, whatever principal the wake was made with.
 */
function manageSchedule(ctx: SchedCtx, id: string): Schedule {
  const s = seeSchedule(ctx, id);
  if (s.kind === "call") {
    if (!mayManage(ctx, s)) raise(ctx, "permission.not_found", "That schedule is not available.");
  } else if (!mayMakeWake(ctx)) raise(ctx, "permission.no_grant", "Only the server changes that kind of schedule.");
  return s;
}
/** A wake of another kind starts only from the tick path (a Run now goes through the agents door and makes a fire of its own): these capabilities refuse it, for everyone. */
function plainCallOnly(ctx: SchedCtx, s: Schedule): void {
  if (s.kind !== "call")
    raise(ctx, "permission.no_grant", "A routine runs from its schedule, or from Run now on the routine.");
}
export async function schedule(ctx: SchedCtx, input: In): Promise<unknown> {
  const key = input.idempotencyKey as string | undefined;
  if (!CAP.test(input.cap))
    raise(ctx, "validation.bad_input", "That is not a capability name.", { reason: "bad_cap", cap: input.cap });
  const kind = (input.kind as Schedule["kind"] | undefined) ?? "call";
  // a wake of another kind names only the capability its kind has in the fixed table, and only the host or the agents module's own doors make one
  if (kind !== "call") {
    if (WAKE_CAP[kind] !== input.cap)
      raise(ctx, "validation.bad_input", "That kind of wake cannot call that capability.", {
        reason: "bad_wake_cap",
        kind,
        cap: input.cap,
      });
    if (!mayMakeWake(ctx)) raise(ctx, "permission.no_grant", "Only the server makes that kind of schedule.");
  }
  if (input.nextAt !== undefined && !isTrustedService(ctx.principal))
    raise(ctx, "permission.no_grant", "Only the server sets a first time.");
  const principal = (input.principal as string | undefined) ?? me(ctx);
  if (!isService(ctx) && principal !== ctx.principal.id && principal !== ctx.actingFor)
    raise(ctx, "permission.not_found", "A schedule can only run as you or as someone you act for.");
  // after every permission check, so a caller who may not make this schedule cannot learn that a key exists
  if (key) {
    const have = idemFind(ctx.db, key);
    const row = have ? findSchedule(ctx.db, have) : undefined;
    if (row) return clean({ scheduleId: row.id, nextAt: row.nextAt });
  }
  // one wake of a kind per owner: a routine has one clock. A second one for the same routine is refused, whoever asks, so a door cannot be talked into making two.
  if (kind !== "call" && wakeOf(ctx.db, kind, input.owner))
    raise(ctx, "validation.precondition_failed", "That routine already has its schedule.", { reason: "wake_exists" });
  const when = checkWhen(ctx, input.when);
  if (!isService(ctx) && principal !== ctx.principal.id && principal !== ctx.actingFor)
    raise(ctx, "permission.not_found", "A schedule can only run as you or as someone you act for.");
  const now = ctx.now();
  const nextAt = (input.nextAt as number | undefined) ?? nextFire(when, now, true);
  if (nextAt === undefined) raise(ctx, "validation.bad_input", "That schedule never fires.", { reason: "never_fires" });
  const s: Schedule = {
    id: newId("sch", now),
    owner: input.owner,
    principal,
    cap: input.cap,
    input: input.input ?? {},
    when,
    ifMissed: (input.ifMissed as IfMissed | undefined) ?? "run_once",
    active: true,
    nextAt,
    createdBy: ctx.principal.id,
    createdAt: now,
    kind,
    scope: (input.scope as Schedule["scope"] | undefined) ?? "private",
    overlap: (input.overlap as Schedule["overlap"] | undefined) ?? "skip",
    // a routine's fire is retried (its key is the Run's key, so a retry never makes a second Run): three tries; a plain call keeps one
    maxAttempts: (input.maxAttempts as number | undefined) ?? (kind === "call" ? 1 : 3),
  };
  // the Wake columns that are only there when given
  if (typeof input.person === "string") s.person = input.person;
  if (typeof input.agentId === "string") s.agentId = input.agentId;
  if (typeof input.roomId === "string") s.roomId = input.roomId;
  if (typeof input.zone === "string") {
    if (!validTimeZone(input.zone))
      raise(ctx, "validation.bad_input", "That time zone is not known.", { reason: "bad_tz", tz: input.zone });
    s.zone = input.zone;
  }
  if (input.quiet) s.quiet = input.quiet as { from: string; to: string };
  if (typeof input.answerWithinMin === "number") s.answerWithinMin = input.answerWithinMin;
  if (s.scope !== "private" && s.roomId === undefined)
    raise(ctx, "validation.bad_input", "A shared or room wake names its room.", { reason: "no_room" });
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
      if (nextAt === undefined)
        raise(ctx, "validation.bad_input", "That schedule never fires.", { reason: "never_fires" });
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
  dropOpenFires(ctx.db, s.id, ctx.now()); // a fire nobody started will never start: closed, so the wake is not left with an open fire and retention can prune it
  emitSched(ctx, "schedule.canceled", s.id, { owner: s.owner, by: ctx.principal.id });
  return { canceled: true };
}

export async function pause(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  if (!s.active && s.pausedReason !== undefined) return { schedule: scheduleOut(s) }; // already paused
  s.active = false;
  s.pausedReason = input.reason;
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.paused", s.id, { owner: s.owner, reason: input.reason });
  return { schedule: scheduleOut(s) };
}

export async function resume(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  if (s.pausedReason === undefined) return { schedule: scheduleOut(s) }; // not paused
  delete s.pausedReason;
  s.active = true;
  // time that passed while it was paused is not made up: a cron goes on from now, a one-shot keeps its time
  const nextAt = nextFire(s.when, ctx.now(), "at" in s.when);
  if (nextAt === undefined) {
    s.active = false;
    delete s.nextAt;
  } else s.nextAt = nextAt;
  saveSchedule(ctx.db, s);
  emitSched(ctx, "schedule.resumed", s.id, { owner: s.owner });
  return { schedule: scheduleOut(s) };
}

export async function list(ctx: SchedCtx, input: In): Promise<unknown> {
  let rows = allSchedules(ctx.db);
  if (!isService(ctx)) rows = rows.filter((s) => (s.kind === "call" ? mayManage(ctx, s) : mayMakeWake(ctx)));
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
  if (!spec)
    raise(
      ctx,
      "validation.bad_input",
      "That is not a cron the scheduler can read. Use five fields: minute hour day month weekday.",
      { reason: "bad_cron", cron: input.cron },
    );
  if (!validTimeZone(input.tz))
    raise(ctx, "validation.bad_input", "That time zone is not known.", { reason: "bad_tz", tz: input.tz });
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
  // the pipeline reads the key of a keyed capability from the call's input: the one this firing owns goes there too, so a scheduled call of such a capability is accepted
  const given = s.input ?? {};
  const body =
    typeof given === "object" && given !== null && !Array.isArray(given) && !("idempotencyKey" in given)
      ? { ...(given as Record<string, unknown>), idempotencyKey: key }
      : given;
  // a schedule a person or an agent made stores a capability they chose: it runs with their own standing (asCaller), never as this module's code. One Vyre itself made is module code.
  const byVyre = s.createdBy.startsWith("svc_") && isTrustedService({ kind: "service", id: s.createdBy }); // the host or a system service; an automation's own svc_<id> is a tenant service and is not Vyre
  const out = (await ctx.call(
    s.cap,
    body,
    byVyre ? { idempotencyKey: key } : { idempotencyKey: key, asCaller: true },
  )) as { runId?: unknown } | null;
  const id = out && typeof out === "object" ? out.runId : undefined;
  return typeof id === "string" && id.startsWith("run_") ? id : undefined;
}

export async function fire(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  plainCallOnly(ctx, s);
  const scheduledFor = input.scheduledFor as number;
  const done = fireRow(ctx.db, s.id, scheduledFor);
  if (done) return clean({ runId: done.runId }); // the same time never fires twice
  if (!s.active) return {}; // paused schedules do not fire
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
  if (next === undefined) {
    s.active = false;
    delete s.nextAt;
  } else s.nextAt = next;
}

export async function runNow(ctx: SchedCtx, input: In): Promise<unknown> {
  const s = manageSchedule(ctx, input.scheduleId);
  plainCallOnly(ctx, s);
  const now = ctx.now();
  const runId = (await callIt(ctx, s, now, `sch-now:${s.id}:${ctx.trace.traceId}`)) ?? ctx.run;
  if (!runId)
    raise(ctx, "validation.precondition_failed", "That schedule's call does not start a run.", { reason: "no_run" });
  s.lastFiredAt = now; // nextAt stays: the cron is not changed
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
    if (at > since) {
      latest = at;
      count += 1;
    }
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
    if (s.kind !== "call") continue; // a wake has its own rule for a stretch it missed (makeDue): never replayed through here
    const miss = missedTimes(s, now, input.since as number);
    const moveOn = (): void => {
      if ("at" in s.when) {
        s.active = false;
        delete s.nextAt;
      } else {
        const n = nextFire(s.when, now);
        if (n === undefined) {
          s.active = false;
          delete s.nextAt;
        } else s.nextAt = n;
      }
    };
    if (!miss) {
      moveOn();
      saveSchedule(ctx.db, s);
      continue;
    }
    const late = now - miss.latest;
    const earlier =
      miss.count > 1 ? ` ${miss.count - 1} earlier time${miss.count === 2 ? "" : "s"} were skipped too.` : "";
    const row: MissedRow = {
      scheduleId: s.id,
      owner: s.owner,
      scheduledFor: miss.latest,
      handling: "skipped",
      handledAt: now,
    };
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
      emitSched(
        ctx,
        "schedule.missed",
        s.id,
        clean({ owner: s.owner, scheduledFor: miss.latest, handling: "ran_once", note: row.note }),
      );
      emitSched(ctx, "schedule.fired", s.id, { owner: s.owner, runId, scheduledFor: miss.latest, late: true });
    } else {
      row.note =
        s.ifMissed === "skip"
          ? `Skipped by its if-missed rule; it was due ${Math.round(late / MINUTE)} minutes ago.${earlier}`
          : `Skipped: it was due ${Math.round(late / MINUTE)} minutes ago, longer than the ${Math.round(window / MINUTE)} minute window.${earlier}`;
      skipped += 1;
      moveOn();
      saveSchedule(ctx.db, s);
      saveMissed(ctx.db, row);
      emitSched(ctx, "schedule.missed", s.id, {
        owner: s.owner,
        scheduledFor: miss.latest,
        handling: "skipped",
        note: row.note,
      });
    }
  }
  return { ranOnce, skipped };
}

export async function missed(ctx: SchedCtx, input: In): Promise<unknown> {
  const rows = missedSince(ctx.db, input.since).filter(
    (m) => isService(ctx) || m.owner.id === me(ctx) || findSchedule(ctx.db, m.scheduleId)?.principal === me(ctx),
  );
  return {
    missed: rows.map((m) =>
      clean({
        scheduleId: m.scheduleId,
        owner: m.owner,
        scheduledFor: m.scheduledFor,
        handling: m.handling,
        runId: m.runId,
      }),
    ),
  };
}

export async function status(ctx: SchedCtx): Promise<unknown> {
  const now = ctx.now();
  const due = dueSchedules(ctx.db, now);
  const lag = due.length ? now - due[0]!.nextAt! : 0;
  const state = lag > DOWN_LAG_MS ? "down" : lag > DEGRADED_LAG_MS ? "degraded" : "healthy";
  return clean({
    state,
    tickLagMs: lag,
    dueNow: due.length,
    openWaits: openWaits(ctx.db).length,
    detail: due.length
      ? `${due.length} schedule${due.length === 1 ? " is" : "s are"} due; the oldest is ${Math.round(lag / 1000)} seconds late.`
      : undefined,
  });
}

/**
 * The host tick: fire every schedule that is due, oldest first, one by one. A failing call is counted and left for the next tick (the schedule keeps its time);
 * it never stops the others. The daemon calls this as the schedule's principal through scheduler.fire; this form is for a service ctx that may act for all.
 */
export async function tick(
  ctx: SchedCtx,
): Promise<{ fired: string[]; failed: { scheduleId: string; error: string }[] }> {
  const out = { fired: [] as string[], failed: [] as { scheduleId: string; error: string }[] };
  for (const s of dueSchedules(ctx.db, ctx.now())) {
    try {
      if (s.kind === "call") await fire(ctx, { scheduleId: s.id, scheduledFor: s.nextAt! });
      else makeDue(ctx, s); // a wake of a routine, goal or baton: the engine claims the fire and starts its turn (scheduler.claim)
      out.fired.push(s.id);
    } catch (e) {
      out.failed.push({ scheduleId: s.id, error: (e as { message?: string } | null)?.message ?? "failed" });
    }
  }
  return out;
}

/**
 * A time of a wake has come: its fire is made `due` (INSERT OR IGNORE on (wake, due key), so two ticks and two computers make one), and the wake moves to its next time. The target's own event
 * (agent.routine_run_started, goal.woken) is the engine's to say when it claims the fire; here nothing has started yet.
 */
function makeDue(ctx: SchedCtx, s: Schedule): void {
  const now = ctx.now();
  const at = s.nextAt!;
  // A server that was off across several times makes ONE fire for the stretch, keyed on the first missed time (the key a routine's Run has always had), with the count noted: never a burst. The wake
  // goes on from now. An if-missed rule of `skip` makes that one fire `skipped` instead: nothing starts. This is what the routine tick always did, and Automations' missed-ticks rule says the same.
  let missed = 0;
  for (
    let t: number | undefined = at;
    t !== undefined && t <= now && missed < MAX_MISSED_STEPS;
    t = nextFire(s.when, t)
  )
    missed += 1;
  const stale = missed > 1;
  createFire(ctx.db, s.id, String(at), at, now, {
    ...(stale ? { reasons: { missed: missed - 1 } } : {}),
    ...(stale && s.ifMissed === "skip"
      ? {
          state: "skipped" as const,
          skipReason: `The server was off across ${missed} times; the if-missed rule is skip`,
        }
      : {}),
  });
  advance(s, Math.max(at, now));
  saveSchedule(ctx.db, s);
}

/**
 * The sweep (P1 "a fire stuck in running"): a fire that says running or waiting is asked of its Run. A Run that ended, failed, was stopped or is gone closes it; a Run that is still going keeps it open.
 * A fire with no Run at all that has said running for longer than two leases is closed as failed: the engine that held it is gone, and the wake must not be blocked for ever. Never starts anything: a second
 * Run for the same key cannot come from here.
 */
export async function sweepFires(ctx: SchedCtx): Promise<{ closed: number }> {
  if (!ctx.call || !isService(ctx)) return { closed: 0 }; // only the host sees every Run, so only for the host does "not there" mean gone
  const now = ctx.now();
  let closed = 0;
  // every open fire is visited, a slice at a time, oldest first, remembering where the slice stopped: long waits cannot fill a window and starve newer fires.
  // One runs.states call answers a whole slice (at 500 open fires: 3 calls a pass instead of 500).
  for (let after = 0; ; ) {
    const slice = openRunFires(ctx.db, after);
    if (slice.length === 0) break;
    after = slice[slice.length - 1]!.rowid;
    // a Run id that is not shaped like one cannot be asked (it would fail the whole slice) and cannot be a Run: its fire closes alone
    const shaped = (id: string): boolean => /^run_[a-z0-9]+$/.test(id);
    for (const f of slice)
      if (f.runId !== undefined && !shaped(f.runId) && closeFire(ctx.db, f, "failed", "Its Run id is not a Run", now))
        closed += 1;
    const ids = [...new Set(slice.flatMap((f) => (f.runId !== undefined && shaped(f.runId) ? [f.runId] : [])))];
    let states: Map<string, string> | undefined;
    if (ids.length > 0) {
      try {
        const got = (await ctx.call("runs.states", { runIds: ids })) as { states?: unknown } | null;
        // only an answer of the right shape counts; anything else (null, {}, a list that is not one) closes nothing
        if (Array.isArray(got?.states))
          states = new Map(
            (got.states as unknown[]).flatMap((x) => {
              const e = x as { runId?: unknown; status?: unknown } | null;
              return typeof e?.runId === "string" && typeof e.status === "string"
                ? [[e.runId, e.status] as [string, string]]
                : [];
            }),
          );
        else
          ctx.log?.warn("runs.states answered with something that is not a list of states: no fire was closed", {
            ids: ids.length,
          });
      } catch {
        states = undefined; // the runs module is down: leave every fire with a Run for the next pass
      }
    }
    for (const f of slice) {
      let status: string | undefined;
      if (f.runId !== undefined) {
        if (!shaped(f.runId)) continue; // closed above
        if (states === undefined) continue;
        status = states.get(f.runId); // the runs module says "gone" for a Run that is not there; an id it did not answer closes nothing
        if (status === undefined) {
          ctx.log?.warn("runs.states left out a Run it was asked about: its fire stays open", {
            scheduleId: f.scheduleId,
          });
          continue;
        }
      } else if (now > f.graceUntil) status = "gone";
      else continue;
      const end =
        status === "succeeded"
          ? "done"
          : status === "stopped"
            ? "stopped"
            : status === "failed" || status === "gone"
              ? "failed"
              : undefined;
      // compare-and-set: a report that landed since the read changes what this closes (nothing), and the next pass looks again
      if (end && closeFire(ctx.db, f, end, status === "gone" ? "Its Run is gone" : `Its Run ${status}`, now))
        closed += 1;
    }
  }
  return { closed };
}

/**
 * The periodic pass of the Wake table: every wake that is not a plain `call` and whose time has come gets its due fire (once, whichever computer or tick makes it), then one bounded retention pass. A `call`
 * schedule is still fired by `tick`, as before; nothing writes a wake of another kind until routines, goals and the baton move onto the table.
 */
export function tickWakes(ctx: SchedCtx): { made: number; pruned: number } {
  let made = 0;
  for (const s of dueSchedules(ctx.db, ctx.now())) {
    if (s.kind === "call") continue;
    makeDue(ctx, s);
    made += 1;
  }
  return { made, pruned: pruneFires(ctx.db, ctx.now()) };
}

/**
 * The tick path of a wake of another kind (until the engine consumer of step 7): each due fire is claimed, the capability of the wake's kind is called as module code with the fire's key, and the fire
 * is reported: running with its Run, or skipped when the target said it did not start (the routine was paused, gone or no longer agreed). A call that throws leaves the fire claimed: after the lease it
 * is claimed again, and the Run key makes that one Run.
 */
export async function fireWakes(
  ctx: SchedCtx,
  host = "tick",
): Promise<{ started: number; skipped: number; failed: number }> {
  const out = { started: 0, skipped: 0, failed: 0 };
  if (!ctx.call) return out;
  for (const f of dueFires(ctx.db, ctx.now())) {
    const s = findSchedule(ctx.db, f.scheduleId);
    if (!s || s.kind === "call") continue;
    const won = claimFire(ctx.db, f.scheduleId, f.dueKey, host, ctx.now());
    if (!won) continue;
    if (won.attempt > s.maxAttempts) {
      // a target that keeps failing is not asked for ever: after the limit the fire ends failed, with the last reason kept as its words (the owner is told by the target's own module)
      const last = (
        ctx.db.all(
          "SELECT skip_reason FROM scheduler_api_fires WHERE schedule_id = ? AND due_key = ?",
          f.scheduleId,
          f.dueKey,
        )[0] as { skip_reason?: string } | undefined
      )?.skip_reason;
      reportFire(
        ctx.db,
        f.scheduleId,
        f.dueKey,
        won.attempt,
        "failed",
        undefined,
        `Gave up after ${s.maxAttempts} ${s.maxAttempts === 1 ? "try" : "tries"}${last ? `: ${last}` : ""}`,
        ctx.now(),
      );
      out.failed += 1;
      continue;
    }
    try {
      const r = (await ctx.call(
        WAKE_CAP[s.kind]!,
        { routineId: s.owner.id, dueKey: f.dueKey },
        { idempotencyKey: `${s.kind}:${s.owner.id}:${f.dueKey}` },
      )) as {
        started?: boolean;
        runId?: string;
        why?: string;
      } | null;
      if (r?.started === true) {
        reportFire(ctx.db, f.scheduleId, f.dueKey, won.attempt, "running", r.runId, undefined, ctx.now());
        out.started += 1;
      } else {
        reportFire(
          ctx.db,
          f.scheduleId,
          f.dueKey,
          won.attempt,
          "skipped",
          undefined,
          r?.why ?? "Not started",
          ctx.now(),
        );
        out.skipped += 1;
      }
    } catch (e) {
      out.failed += 1;
      noteFire(
        ctx.db,
        f.scheduleId,
        f.dueKey,
        (e as { message?: string } | null)?.message?.slice(0, 200) ?? "It did not start",
      );
      ctx.log?.warn("a wake's capability did not run; its fire is tried again after the lease", {
        scheduleId: f.scheduleId,
        error: (e as { message?: string } | null)?.message,
      });
    }
  }
  return out;
}

/** One retention pass: bounded, and never a fire that is open (scheduler_api_fires, P1 "Retention"). */
export function prune(ctx: SchedCtx): { deleted: number } {
  return { deleted: pruneFires(ctx.db, ctx.now()) };
}

function mustBeSystem(ctx: SchedCtx): void {
  if (!isService(ctx)) raise(ctx, "permission.no_grant", "Only the server says that.");
}

/** The engine claims a due fire (the one claim rule). `claimed` is true for the single write that changed the row. */
export async function claim(ctx: SchedCtx, input: In): Promise<unknown> {
  mustBeSystem(ctx);
  const have = fireState(ctx.db, input.scheduleId, input.dueKey);
  if (have === undefined) raise(ctx, "validation.not_found", "That fire does not exist.", { reason: "no_such_fire" });
  const won = claimFire(ctx.db, input.scheduleId, input.dueKey, input.host, ctx.now());
  return won
    ? { claimed: true, fireId: fireIdOf(input.scheduleId, input.dueKey), attempt: won.attempt }
    : { claimed: false };
}

/** The engine says where a claimed fire is. A fire already over does not move. */
export async function report(ctx: SchedCtx, input: In): Promise<unknown> {
  mustBeSystem(ctx);
  const id = splitFireId(input.fireId);
  if (!id || fireState(ctx.db, id.scheduleId, id.dueKey) === undefined)
    raise(ctx, "validation.not_found", "That fire does not exist.", { reason: "no_such_fire" });
  return reportFire(ctx.db, id.scheduleId, id.dueKey, input.attempt, input.state, input.runId, input.note, ctx.now());
}
