// Host seam for automation schedules. The tick math lives in modules/automations/schedule and is not imported here (the host does not import modules).
// A host turns a pure plan into runs by calling startScheduledTicks. That calls automations.fire. startRun stays in the frozen triggers module.
// The idempotency key is the tick id, and claim() is recorded before the run finishes, so a restart does not claim the same tick again.
// An over-cap backlog is delivered with deliverScheduleNeedsYou: tasks.create kind unblock (tasks.needs_you) and notifications.send with the same collapseKey.
// A second delivery while that key is open does not create another task.

/** Capability that starts one scheduled Automation run. */
export const SCHEDULE_FIRE_CAPABILITY = "automations.fire";
/** Needs You task. Kind unblock is what tasks.needs_you lists. */
export const NEEDS_YOU_TASK_CAPABILITY = "tasks.create";
/** Collapse repeats onto one notification row. */
export const NEEDS_YOU_NOTIFY_CAPABILITY = "notifications.send";
/** Close the request after the person chooses. */
export const NEEDS_YOU_RESOLVE_CAPABILITY = "tasks.act";
export const NEEDS_YOU_FOLLOW_CAPABILITY = "tasks.followers.add";

/** Keep in step with modules/automations/schedule scheduleRequestKey. */
export function scheduleRequestKey(automationId: string): string {
  return `automation-schedule:${automationId}`;
}

export interface ScheduledTickPlan {
  automationId: string;
  tickId: string;
  fireAt: number;
}

export type ScheduleHostCall = (cap: string, input: Record<string, unknown>) => Promise<unknown>;

/** Durable claim. Return false when this tick id was already claimed, even if that run never finished. */
export interface TickClaimStore {
  claim(tickId: string): boolean | Promise<boolean>;
}

export interface StartTicksOptions {
  now: number;
  cron?: string;
  /** A tick older than this is marked missed on the trigger payload. Default one minute. */
  onTimeMs?: number;
  claim: TickClaimStore;
}

export interface StartTicksResult {
  started: ScheduledTickPlan[];
  ignored: string[];
  failed?: { tickId: string; message: string };
}

function missedFlag(now: number, fireAt: number, onTimeMs: number): boolean {
  return now - fireAt > onTimeMs;
}

/**
 * Start the planned ticks, oldest first, through automations.fire.
 * Each call's idempotencyKey is the tick id. A tick the claim store already holds is ignored.
 */
export async function startScheduledTicks(call: ScheduleHostCall, ticks: readonly ScheduledTickPlan[], opts: StartTicksOptions): Promise<StartTicksResult> {
  const ordered = [...ticks].sort((a, b) => a.fireAt - b.fireAt || (a.tickId < b.tickId ? -1 : a.tickId > b.tickId ? 1 : 0));
  const started: ScheduledTickPlan[] = [];
  const ignored: string[] = [];
  const onTimeMs = opts.onTimeMs ?? 60_000;
  for (const tick of ordered) {
    const fresh = await opts.claim.claim(tick.tickId);
    if (!fresh) {
      ignored.push(tick.tickId);
      continue;
    }
    const payload: Record<string, unknown> = {
      firedAt: opts.now,
      scheduledFor: tick.fireAt,
      missed: missedFlag(opts.now, tick.fireAt, onTimeMs),
      tickId: tick.tickId,
    };
    if (opts.cron !== undefined) payload.cron = opts.cron;
    try {
      await call(SCHEDULE_FIRE_CAPABILITY, {
        automationId: tick.automationId,
        trigger: "schedule",
        payload,
        depth: 0,
        origin: "schedule",
        idempotencyKey: tick.tickId,
      });
    } catch (e) {
      return { started, ignored, failed: { tickId: tick.tickId, message: e instanceof Error ? e.message : String(e) } };
    }
    started.push(tick);
  }
  return { started, ignored };
}

export interface ScheduleNeedsYouDelivery {
  dedupKey: string;
  task: Record<string, unknown> & { idempotencyKey: string };
  followers: readonly string[];
  notifications: readonly { to: string; kind: string; collapseKey: string; title: string; body?: string; data?: Record<string, unknown> }[];
}

export interface DeliverNeedsYouResult {
  dedupKey: string;
  created: boolean;
  taskId?: string;
}

function taskIdOf(out: unknown): string | undefined {
  if (!out || typeof out !== "object") return undefined;
  const task = (out as { task?: { id?: unknown } }).task;
  return task && typeof task.id === "string" ? task.id : undefined;
}

/**
 * Create the one Needs You task and notify the owner and shared recipients.
 * When `openKeys` already contains the dedup key, this returns without calling tasks.create.
 */
export async function deliverScheduleNeedsYou(call: ScheduleHostCall, request: ScheduleNeedsYouDelivery, openKeys: ReadonlySet<string>): Promise<DeliverNeedsYouResult> {
  if (openKeys.has(request.dedupKey)) return { dedupKey: request.dedupKey, created: false };
  const created = await call(NEEDS_YOU_TASK_CAPABILITY, request.task);
  const taskId = taskIdOf(created);
  if (taskId !== undefined) {
    for (const follower of request.followers) {
      await call(NEEDS_YOU_FOLLOW_CAPABILITY, { taskId, follower });
    }
  }
  for (const note of request.notifications) {
    const input: Record<string, unknown> = { to: note.to, kind: note.kind, collapseKey: note.collapseKey, title: note.title };
    if (note.body !== undefined) input.body = note.body;
    if (note.data !== undefined) input.data = note.data;
    await call(NEEDS_YOU_NOTIFY_CAPABILITY, input);
  }
  return taskId === undefined ? { dedupKey: request.dedupKey, created: true } : { dedupKey: request.dedupKey, created: true, taskId };
}

/** Mark the unblock request done after applyScheduleChoice says to clear it. Call as the owner. */
export async function resolveScheduleRequest(call: ScheduleHostCall, taskId: string): Promise<void> {
  await call(NEEDS_YOU_RESOLVE_CAPABILITY, { taskId, action: "resolved" });
}

interface ListedTask { state?: unknown; source?: { id?: unknown } | null }

/** Open unblock tasks whose source id is an automation schedule key. Done and canceled tasks do not count. */
export function openScheduleKeysFromTasks(tasks: readonly unknown[]): string[] {
  const keys: string[] = [];
  for (const row of tasks) {
    if (!row || typeof row !== "object") continue;
    const task = row as ListedTask;
    if (task.state === "done" || task.state === "canceled") continue;
    const id = task.source?.id;
    if (typeof id !== "string" || !id.startsWith("automation-schedule:")) continue;
    keys.push(id);
  }
  return keys;
}

/** Read open schedule requests from tasks.list so a restart can see a request that is already open. */
export async function loadOpenScheduleKeys(call: ScheduleHostCall): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const input: Record<string, unknown> = {
      scope: "all",
      kinds: ["unblock"],
      states: ["todo", "doing", "in_review", "awaiting_approval"],
      limit: 200,
    };
    if (cursor !== undefined) input.cursor = cursor;
    const out = await call("tasks.list", input) as { tasks?: unknown; next?: unknown };
    const tasks = Array.isArray(out?.tasks) ? out.tasks : [];
    for (const key of openScheduleKeysFromTasks(tasks)) keys.add(key);
    cursor = typeof out?.next === "string" && out.next.length > 0 ? out.next : undefined;
    if (cursor === undefined) break;
  }
  return keys;
}
