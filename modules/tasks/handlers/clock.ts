// The clock of tasks (lane l-tasks). Once a minute it moves what time alone moves, on each holder's own clock:
//   due      the day a task is due begins in its holder's time zone (task.due at 'day'), then its due time passes (task.due at 'time'). Each is said once per due date.
//   snooze   a snooze that ended clears, so the task is back in every list and the list's revision moves with it (task.snoozed with until null).
//   stuck    a step that sat with someone for a day (findStuck) reminds them once, or the person behind an agent (task.nudged). Said again only after the task moves and sits again.
// It only reads and emits; notifications turn task.due and task.nudged into a line for the person, and automations can start on task.due.
import { isTrustedService } from "../../../lib/trust.ts";
import { actionableSlot, allTasks, emitTask, findTask, raise, startOfDayIn, touch, tzOf, whoIs } from "../projections.ts";
import type { Assignee, Task, TasksCtx } from "../projections.ts";
import { findStuck } from "./act.ts";

type In = Record<string, unknown>;
const DAY = 86_400_000;
const MAX = 200;

const said = (ctx: TasksCtx, taskId: string, what: string): boolean => ctx.db.all("SELECT 1 FROM tasks_said WHERE task_id = ? AND what = ?", taskId, what).length > 0;
const say = (ctx: TasksCtx, taskId: string, what: string): void => { ctx.db.run("INSERT OR IGNORE INTO tasks_said (task_id, what, at) VALUES (?, ?, ?)", taskId, what, ctx.now()); };

/** Whose step it is now: the slot of the state, else the Assigned. */
export function stepHolder(t: Task): Assignee {
  const slot = actionableSlot(t.state);
  return (slot ? t[slot] : undefined) ?? t.assigned;
}

/** The due reminders that are owed now. Returns how many were said. */
export function sayDue(ctx: TasksCtx): number {
  const now = ctx.now();
  let n = 0;
  // the widest zone is 14 hours ahead, so a task due within a day and a half may already be due "today" somewhere
  for (const t of allTasks(ctx.db, "c.state NOT IN ('done', 'canceled') AND m.due IS NOT NULL AND m.due <= ? AND m.due > ?", now + DAY + 14 * 3_600_000, now - DAY).slice(0, MAX)) {
    if (t.due === undefined || (t.snoozedUntil !== undefined && t.snoozedUntil > now)) continue;
    const holder = stepHolder(t);
    const tz = holder.kind === "person" ? tzOf(ctx.db, holder.id) : "UTC";
    const dayStart = startOfDayIn(t.due, tz);
    const dayKey = `day:${t.due}`, timeKey = `time:${t.due}`;
    if (now >= t.due) {
      if (said(ctx, t.id, timeKey)) continue;
      say(ctx, t.id, timeKey); say(ctx, t.id, dayKey);
      emitTask(ctx, ctx.db, "task.due", t, { title: t.title, due: t.due, at: "time", holder }, { type: "due", by: ctx.principal.id, note: "time" });
      n += 1;
    } else if (now >= dayStart && !said(ctx, t.id, dayKey)) {
      say(ctx, t.id, dayKey);
      // a task made or given a date today already says when it is due: only one that was waiting when the day began is reminded
      if (t.createdAt >= dayStart) continue;
      emitTask(ctx, ctx.db, "task.due", t, { title: t.title, due: t.due, at: "day", holder }, { type: "due", by: ctx.principal.id, note: "day" });
      n += 1;
    }
  }
  return n;
}

/** Snoozes that ended: the task comes back by itself. */
export function wakeSnoozed(ctx: TasksCtx): number {
  let n = 0;
  for (const t of allTasks(ctx.db, "c.state NOT IN ('done', 'canceled') AND m.snoozed_until IS NOT NULL AND m.snoozed_until <= ?", ctx.now()).slice(0, MAX)) {
    delete t.snoozedUntil;
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.snoozed", t, { until: null }, { type: "woke", by: ctx.principal.id });
    n += 1;
  }
  return n;
}

/** Steps that sat too long: one reminder each, to the person whose step it is, else the person behind the agent or the one who asked. */
export function nudgeStuck(ctx: TasksCtx, o: { idleMs?: number } = {}): number {
  let n = 0;
  for (const s of findStuck(ctx, o).slice(0, MAX)) {
    const t = findTask(ctx.db, s.taskId);
    if (!t) continue;
    const key = `nudge:${s.why}:${s.since}`;
    if (said(ctx, t.id, key)) continue;
    say(ctx, t.id, key);
    let notify = s.notify;
    if (s.why === "waiting_on_decision") { const h = stepHolder(t); if (h.kind === "person") notify = h.id; }
    if (s.why === "unblock_waiting") {
      const ask = allTasks(ctx.db, "m.parent_task = ? AND m.kind = 'unblock' AND c.state NOT IN ('done', 'canceled')", t.id)[0];
      if (ask?.assigned.kind === "person") notify = ask.assigned.id;
    }
    emitTask(ctx, ctx.db, "task.nudged", t, { title: t.title, why: s.why, notify }, { type: "nudged", by: ctx.principal.id, note: s.why });
    n += 1;
  }
  return n;
}

/** One pass of the clock. */
export function tick(ctx: TasksCtx): { due: number; woke: number; nudged: number } {
  const woke = wakeSnoozed(ctx);
  return { due: sayDue(ctx), woke, nudged: nudgeStuck(ctx) };
}

/** tasks.clock: the same pass, for the server only (the periodic job runs it every minute). */
export async function clock(ctx: TasksCtx, _input: In): Promise<unknown> {
  if (!isTrustedService(whoIs(ctx))) raise(ctx, "permission.no_grant", "Only the server runs the clock.");
  return tick(ctx);
}
