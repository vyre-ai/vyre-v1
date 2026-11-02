// The scheduler (ticket system, C). Nothing polls: a task finishing is what moves things. A task whose dependencies are met says task.ready, and the baton starts it. A finished child rolls up: the parent's holder
// hears only when every child is finished, a child is blocked, or a child asks, and never on any other change. A repeating task comes back when it is Done. A Run that stopped takes its tasks with it.
// Every event here can be delivered twice: task.children_settled carries what happened, and the baton wakes once per reason and child.
import { allTasks, emitTask, findTask, isOpen, openIndex } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";
import { afterReview, applyMove, submitTarget, withdraw } from "./state.ts";

type Ev = { name: string; payload: { taskId?: unknown; to?: unknown; runId?: unknown; jobId?: unknown } };
const DAY = 86_400_000;
const MAX_WAITERS = 500;

/** The next date of a repeating task, the same time of day. */
export function nextDue(from: number, every: "day" | "week" | "month", n = 1): number {
  if (every === "day") return from + n * DAY;
  if (every === "week") return from + n * 7 * DAY;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
}

/** The tasks that just lost their last unmet dependency. */
function readyAfter(ctx: TasksCtx, finished: string): string[] {
  const idx = openIndex(ctx.db);
  const out: string[] = [];
  for (const waiter of allTasks(ctx.db, "c.state NOT IN ('done', 'canceled') AND m.depends_on LIKE ?", `%${finished}%`).slice(0, MAX_WAITERS)) {
    if (!waiter.dependsOn.includes(finished) || waiter.dependsOn.some((d) => idx.open.has(d)) || idx.unblockParents.has(waiter.id)) continue;
    emitTask(ctx, ctx.db, "task.ready", waiter, {}, { type: "ready", by: ctx.principal.id });
    out.push(waiter.id);
  }
  return out;
}

function settle(ctx: TasksCtx, parent: Task, reason: "finished" | "blocked" | "asked", childId?: string): void {
  emitTask(ctx, ctx.db, "task.children_settled", parent, { reason, ...(childId ? { childId } : {}) }, { type: "children_settled", by: ctx.principal.id, note: reason });
}

/** Should the parent hear about this? Only when all its children are finished, or when a child stopped for a person. */
function rollUp(ctx: TasksCtx, t: Task): void {
  // a question or a block on a child: the parent of that child hears who is stuck
  if ((t.kind === "answer" || t.kind === "unblock") && isOpen(t.state) && t.parentTaskId) {
    const child = findTask(ctx.db, t.parentTaskId);
    const parent = child?.parentTaskId ? findTask(ctx.db, child.parentTaskId) : undefined;
    if (child && parent && parent.kind === "work" && isOpen(parent.state)) settle(ctx, parent, t.kind === "answer" ? "asked" : "blocked", child.id);
    return;
  }
  if (t.kind !== "work" || isOpen(t.state) || !t.parentTaskId) return;
  const parent = findTask(ctx.db, t.parentTaskId);
  if (!parent || parent.kind !== "work" || !isOpen(parent.state)) return;
  const kids = allTasks(ctx.db, "m.parent_task = ? AND m.kind = 'work'", parent.id);
  if (kids.every((k) => !isOpen(k.state))) settle(ctx, parent, "finished");
}

async function comeBack(ctx: TasksCtx, t: Task): Promise<void> {
  if (!t.recur || t.state !== "done" || !ctx.call) return;
  const every = t.recur.every, n = t.recur.n ?? 1;
  const base = t.due ?? ctx.now();
  await ctx.call("tasks.create", {
    title: t.title, ...(t.summary ? { summary: t.summary } : {}), ...(t.why ? { why: t.why } : {}), assigned: t.assigned, ...(t.reviewer ? { reviewer: t.reviewer } : {}), ...(t.approver ? { approver: t.approver } : {}),
    due: nextDue(base, every, n), ...(t.start !== undefined ? { start: nextDue(t.start, every, n) } : {}), ...(t.effort !== undefined ? { effort: t.effort } : {}), ...(t.priority ? { priority: t.priority } : {}), labels: t.labels, fields: t.fields, recur: t.recur,
    ...(t.recordId ? { recordId: t.recordId } : {}), ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}), idempotencyKey: `recur:${t.id}`,
  });
}

/** One task event. Returns the tasks it moved, for the log and the tests. */
export async function onTaskChanged(ctx: TasksCtx, event: Ev): Promise<string[]> {
  const id = typeof event.payload.taskId === "string" ? event.payload.taskId : "";
  if (id === "") return [];
  if (event.name === "task.deleted") return readyAfter(ctx, id);
  const t = findTask(ctx.db, id);
  if (!t) return [];
  if (event.name === "task.created") { if (t.kind === "answer" || t.kind === "unblock") rollUp(ctx, t); return []; }
  if (isOpen(t.state)) return [];
  rollUp(ctx, t);
  await comeBack(ctx, t);
  return readyAfter(ctx, id);
}

/** A Run that was stopped or failed: nobody is waiting on what it asked for. A Run that finished leaves its tasks alone; a person may still want them. */
export async function onRunStopped(ctx: TasksCtx, event: Ev): Promise<string[]> {
  const runId = typeof event.payload.runId === "string" ? event.payload.runId : "";
  if (runId === "") return [];
  const note = event.name === "run.failed" ? "The automation that asked for this failed." : "The automation that asked for this was stopped.";
  // one task at a time: the withdraw of a whole source takes requests only, and this takes the Run's plain work too
  const out: string[] = [];
  for (const t of allTasks(ctx.db, "c.state NOT IN ('done', 'canceled') AND m.source_kind = 'run' AND m.source_id = ?", runId)) {
    await withdraw(ctx, { taskId: t.id, note });
    out.push(t.id);
  }
  return out;
}

/** A crew branch landed: the task it was doing moves on, through the same state table as any other move. */
export async function onCrewMerged(ctx: TasksCtx, event: Ev): Promise<string[]> {
  const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : "";
  if (jobId === "") return [];
  const out: string[] = [];
  for (const t of allTasks(ctx.db, "c.state NOT IN ('done', 'canceled') AND m.working_notes LIKE ?", `%${jobId}%`)) {
    if (t.workingNotes["crew.job"] !== jobId) continue;
    const to = t.state === "todo" || t.state === "doing" ? submitTarget(t) : t.state === "in_review" ? afterReview(t) : "done";
    if (t.state === "todo" && to === "done") applyMove(ctx, t, "doing");
    applyMove(ctx, t, to, { note: "The branch was merged." });
    out.push(t.id);
  }
  return out;
}
