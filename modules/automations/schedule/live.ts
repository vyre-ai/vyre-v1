// The clock. Once a minute the host runs runDueSchedules for every Automation that is on and has a schedule trigger.
// A tick starts through automations.fire, which pins the definition version. The same tick id is not started twice.
// A backlog over the cap starts nothing, pauses that Automation only, and opens one Needs You request.
import { deliverScheduleNeedsYou, loadOpenScheduleKeys, resolveScheduleRequest } from "../../../host/src/seams/automation-schedule.ts";
import type { ScheduleHostCall } from "../../../host/src/seams/automation-schedule.ts";
import { fire } from "../handlers/triggers.ts";
import { allAutomations, emitAuto, saveVersion, touch } from "../projections.ts";
import type { AutoCtx, Automation } from "../projections.ts";
import { applyScheduleChoice, planSchedule, scheduleRequestKey } from "./schedule.ts";
import type { AutomationSchedule, ChoiceLimits, MissedPolicy, OverlapPolicy, ScheduleChoiceKey, SchedulePlan } from "./schedule.ts";
import { armState, claimStarted, claimedTickIds, lastClaimedAt, readState, saveCursor, savePaused, saveRequestOpen } from "./state.ts";

export const SCHEDULE_EVERY_MS = 60_000;
const PAUSE_REASON = "Schedule backlog is over its cap";

export interface TickRun {
  automationId: string;
  tickId: string;
  runId: string;
}

export interface DueReport {
  armed: string[];
  started: TickRun[];
  paused: string[];
  errors: { automationId: string; message: string }[];
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function missedOf(value: unknown): MissedPolicy | undefined {
  return value === "skip" || value === "run_once" || value === "backfill_each_tick" ? value : undefined;
}

function overlapOf(value: unknown): OverlapPolicy | undefined {
  return value === "queue" || value === "skip_while_active" || value === "bounded_concurrency" ? value : undefined;
}

/** The stored trigger config, as the one schedule model. */
export function scheduleFrom(automation: Automation): AutomationSchedule | undefined {
  const trigger = automation.definition.triggers.find((item) => item.key === "schedule");
  const config = trigger?.config;
  if (!config) return undefined;
  const missed = missedOf(config["missed"]);
  const cron = typeof config["cron"] === "string" ? config["cron"] : "";
  const timezone = typeof config["timezone"] === "string" ? config["timezone"] : "";
  if (!missed || !cron || !timezone) return undefined;
  const schedule: AutomationSchedule = { automationId: automation.id, cron, timezone, missed };
  const lookbackMs = num(config["lookbackMs"]);
  const cap = num(config["cap"]);
  const spacingMs = num(config["spacingMs"]);
  const startAt = num(config["startAt"]);
  const endAt = num(config["endAt"]);
  const concurrency = num(config["concurrency"]);
  const overlap = overlapOf(config["overlap"]);
  if (lookbackMs !== undefined) schedule.lookbackMs = lookbackMs;
  if (cap !== undefined) schedule.cap = cap;
  if (spacingMs !== undefined) schedule.spacingMs = spacingMs;
  if (startAt !== undefined) schedule.startAt = startAt;
  if (endAt !== undefined) schedule.endAt = endAt;
  if (concurrency !== undefined) schedule.concurrency = concurrency;
  if (overlap !== undefined) schedule.overlap = overlap;
  return schedule;
}

function writeConfig(automation: Automation, schedule: AutomationSchedule): void {
  const trigger = automation.definition.triggers.find((item) => item.key === "schedule");
  if (!trigger) return;
  const config: Record<string, unknown> = { ...(trigger.config ?? {}), cron: schedule.cron, timezone: schedule.timezone, missed: schedule.missed };
  if (schedule.lookbackMs !== undefined) config["lookbackMs"] = schedule.lookbackMs;
  if (schedule.cap !== undefined) config["cap"] = schedule.cap;
  if (schedule.spacingMs !== undefined) config["spacingMs"] = schedule.spacingMs;
  if (schedule.overlap !== undefined) config["overlap"] = schedule.overlap;
  if (schedule.concurrency !== undefined) config["concurrency"] = schedule.concurrency;
  if (schedule.startAt !== undefined) config["startAt"] = schedule.startAt;
  if (schedule.endAt !== undefined) config["endAt"] = schedule.endAt;
  trigger.config = config;
}

function hostCall(ctx: AutoCtx): ScheduleHostCall {
  return (cap, input) => {
    if (!ctx.call) throw new Error("This host cannot call other capabilities.");
    return ctx.call(cap, input);
  };
}

async function activeCount(ctx: AutoCtx, automationId: string): Promise<number | "unknown"> {
  if (!ctx.call) return "unknown";
  try {
    const out = await ctx.call("runs.list", {
      scope: "subject",
      subject: { type: "automation", id: automationId },
      statuses: ["queued", "running", "waiting"],
      limit: 50,
    }) as { runs?: unknown };
    return Array.isArray(out?.runs) ? out.runs.length : 0;
  } catch {
    return "unknown";
  }
}

async function openKeys(ctx: AutoCtx): Promise<Set<string> | "unknown"> {
  if (!ctx.call) return new Set();
  try {
    return await loadOpenScheduleKeys(hostCall(ctx));
  } catch {
    return "unknown";
  }
}

function pauseAutomation(ctx: AutoCtx, automation: Automation): void {
  if (automation.status === "paused" && automation.pausedReason === PAUSE_REASON) return;
  automation.status = "paused";
  automation.pausedReason = PAUSE_REASON;
  touch(ctx, automation);
  emitAuto(ctx, "automation.disabled", automation.id, { reason: PAUSE_REASON });
}

function resumeAutomation(ctx: AutoCtx, automation: Automation): void {
  if (automation.status === "on") return;
  automation.status = "on";
  delete automation.pausedReason;
  touch(ctx, automation);
  emitAuto(ctx, "automation.enabled", automation.id, {});
}

async function fireTick(ctx: AutoCtx, automation: Automation, tick: { tickId: string; fireAt: number }, cron: string | undefined): Promise<string> {
  const payload: Record<string, unknown> = {
    firedAt: ctx.now(),
    scheduledFor: tick.fireAt,
    missed: ctx.now() - tick.fireAt > 60_000,
    tickId: tick.tickId,
  };
  if (cron !== undefined) payload["cron"] = cron;
  const out = await fire(ctx, {
    automationId: automation.id,
    trigger: "schedule",
    payload,
    depth: 0,
    origin: "schedule",
    idempotencyKey: tick.tickId,
  }) as { runId?: string; dropped?: string };
  if (!out.runId) throw new Error(out.dropped ? `The schedule tick was dropped (${out.dropped}).` : "The schedule tick did not start a run.");
  claimStarted(ctx.db, { tickId: tick.tickId, automationId: automation.id, fireAt: tick.fireAt, runId: out.runId, at: ctx.now() });
  saveCursor(ctx.db, automation.id, tick.fireAt, ctx.now());
  return out.runId;
}

async function deliverPause(ctx: AutoCtx, automation: Automation, plan: SchedulePlan, keys: Set<string> | "unknown"): Promise<void> {
  pauseAutomation(ctx, automation);
  savePaused(ctx.db, automation.id, true, "backfill_over_cap", ctx.now());
  const state = readState(ctx.db, automation.id);
  const already = state?.requestOpen === true || (keys !== "unknown" && keys.has(scheduleRequestKey(automation.id)));
  if (already) {
    saveRequestOpen(ctx.db, automation.id, true, ctx.now());
    return;
  }
  if (keys === "unknown" || !plan.request || !ctx.call) return;
  await deliverScheduleNeedsYou(hostCall(ctx), plan.request, keys);
  saveRequestOpen(ctx.db, automation.id, true, ctx.now());
}

/**
 * Plan and start the schedules that are due. Does not move a cursor past a tick that failed to start.
 * The first time a schedule is seen, the cursor is set to now and nothing starts.
 */
export async function runDueSchedules(ctx: AutoCtx): Promise<DueReport> {
  const report: DueReport = { armed: [], started: [], paused: [], errors: [] };
  const keys = await openKeys(ctx);
  for (const automation of allAutomations(ctx.db, "status IN ('on', 'paused')")) {
    const schedule = scheduleFrom(automation);
    if (!schedule) continue;
    const { state, armed } = armState(ctx.db, automation.id, ctx.now());
    if (armed) {
      report.armed.push(automation.id);
      continue;
    }
    if (automation.status !== "on") continue;
    if (state.paused) savePaused(ctx.db, automation.id, false, undefined, ctx.now());
    const active = await activeCount(ctx, automation.id);
    if (active === "unknown") {
      report.errors.push({ automationId: automation.id, message: "Runs could not be listed, so this schedule did not start." });
      continue;
    }
    const planned = planSchedule(schedule, {
      now: ctx.now(),
      cursor: state.cursor,
      startedTickIds: claimedTickIds(ctx.db, automation.id),
      ...(lastClaimedAt(ctx.db, automation.id) === undefined ? {} : { lastStartedAt: lastClaimedAt(ctx.db, automation.id) }),
      activeRunCount: active,
      openRequestKeys: keys === "unknown" ? new Set(state.requestOpen ? [scheduleRequestKey(automation.id)] : []) : keys,
      ownerId: automation.ownerId,
      sharedRecipientIds: automation.followers,
    });
    if (!planned.ok) {
      report.errors.push({ automationId: automation.id, message: planned.message });
      continue;
    }
    const plan = planned.plan;
    if (plan.paused && plan.pausedReason === "backfill_over_cap") {
      try {
        await deliverPause(ctx, automation, plan, keys);
        report.paused.push(automation.id);
      } catch (error) {
        report.errors.push({ automationId: automation.id, message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    let failed = false;
    for (const tick of plan.ticks) {
      try {
        const runId = await fireTick(ctx, automation, tick, schedule.cron);
        report.started.push({ automationId: automation.id, tickId: tick.tickId, runId });
      } catch (error) {
        failed = true;
        report.errors.push({ automationId: automation.id, message: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    if (!failed && plan.cursor > state.cursor) saveCursor(ctx.db, automation.id, plan.cursor, ctx.now());
  }
  return report;
}

export interface ChoiceInput {
  automationId: string;
  choice: ScheduleChoiceKey;
  n?: number;
  limits?: ChoiceLimits;
}

/**
 * Apply one recovery choice to the backlog still behind the cursor.
 * Run first N and run latest N start those ticks and resume. Skip backlog resumes without starts.
 * Change limits stays paused. Keep paused closes the request and stays paused.
 */
export async function chooseScheduleRecovery(ctx: AutoCtx, input: ChoiceInput): Promise<{ ok: true; started: TickRun[]; paused: boolean } | { ok: false; error: string }> {
  const rows = allAutomations(ctx.db, "id = ?", input.automationId);
  const automation = rows[0];
  if (!automation) return { ok: false, error: "That automation is not available." };
  const schedule = scheduleFrom(automation);
  if (!schedule) return { ok: false, error: "This automation has no schedule." };
  const state = readState(ctx.db, automation.id) ?? armState(ctx.db, automation.id, ctx.now()).state;
  const planned = planSchedule(schedule, {
    now: ctx.now(),
    cursor: state.cursor,
    startedTickIds: claimedTickIds(ctx.db, automation.id),
    activeRunCount: 0,
    openRequestKeys: state.requestOpen ? new Set([scheduleRequestKey(automation.id)]) : new Set(),
    paused: false,
    ownerId: automation.ownerId,
    sharedRecipientIds: automation.followers,
  });
  if (!planned.ok) return { ok: false, error: planned.message };
  const choice = applyScheduleChoice(schedule, planned.plan.backlog, claimedTickIds(ctx.db, automation.id), input.choice, {
    now: ctx.now(),
    cursor: state.cursor,
    ...(input.n === undefined ? {} : { n: input.n }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
  });
  if (!choice.ok) return { ok: false, error: choice.error };
  if (input.choice === "change_limits") {
    writeConfig(automation, choice.spec);
    automation.version += 1;
    touch(ctx, automation);
    saveVersion(ctx, automation, "Schedule limits changed");
    emitAuto(ctx, "automation.updated", automation.id, { version: automation.version, fields: ["definition"] });
    savePaused(ctx.db, automation.id, true, "backfill_over_cap", ctx.now());
    return { ok: true, started: [], paused: true };
  }
  if (choice.paused) {
    savePaused(ctx.db, automation.id, true, choice.pausedReason, ctx.now());
    if (choice.clearRequest) await clearRequest(ctx, automation.id);
    return { ok: true, started: [], paused: true };
  }
  resumeAutomation(ctx, automation);
  savePaused(ctx.db, automation.id, false, undefined, ctx.now());
  const started: TickRun[] = [];
  for (const tick of choice.ticks) {
    const runId = await fireTick(ctx, automation, tick, choice.spec.cron);
    started.push({ automationId: automation.id, tickId: tick.tickId, runId });
  }
  if (choice.cursor !== undefined) saveCursor(ctx.db, automation.id, choice.cursor, ctx.now());
  if (choice.clearRequest) await clearRequest(ctx, automation.id);
  return { ok: true, started, paused: false };
}

async function clearRequest(ctx: AutoCtx, automationId: string): Promise<void> {
  saveRequestOpen(ctx.db, automationId, false, ctx.now());
  if (!ctx.call) return;
  try {
    const keys = await loadOpenScheduleKeys(hostCall(ctx));
    if (!keys.has(scheduleRequestKey(automationId))) return;
    const listed = await ctx.call("tasks.list", {
      scope: "all",
      kinds: ["unblock"],
      states: ["todo", "doing", "in_review", "awaiting_approval"],
      limit: 200,
    }) as { tasks?: { id?: string; source?: { id?: string } }[] };
    const task = (listed.tasks ?? []).find((row) => row.source?.id === scheduleRequestKey(automationId) && typeof row.id === "string");
    if (task?.id) await resolveScheduleRequest(hostCall(ctx), task.id);
  } catch {
    /* The schedule is already resumed. A leftover request can be closed by hand. */
  }
}

