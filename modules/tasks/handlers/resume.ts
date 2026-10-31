// A Run that waits on a task goes on when the task reaches ANY terminal state (work baton, item 6). tasks.act resumed the Run for approve, answer and resolved only; a task finished by
// tasks.transition, by a baton tool (the last approval, a submit with no reviewer), canceled, or sent to Done by a hook left the Run parked. This consumer closes that gap for every path:
// it listens to task.transitioned, and when the task is Done or Canceled and came from a Run that is waiting, it resumes that Run for the reason it waits for.
// tasks.act still resumes at once and marks the task (the note run.resumed), so the consumer never resumes a Run that already went on and is now waiting on something else.
import { findTask, saveTask } from "../projections.ts";
import type { TasksCtx } from "../projections.ts";

export const RESUMED_NOTE = "run.resumed";

interface TransitionEvent { name: string; payload: { taskId?: unknown; to?: unknown } }

/** Resume the Run a finished task came from. Returns the Run it resumed, or undefined when there was nothing to do. */
export async function resumeRunOf(ctx: TasksCtx, event: TransitionEvent): Promise<string | undefined> {
  const to = event.payload.to;
  if (to !== "done" && to !== "canceled") return undefined;
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : "";
  const t = taskId ? findTask(ctx.db, taskId) : undefined;
  if (!t || t.source?.kind !== "run" || t.workingNotes[RESUMED_NOTE] === "1" || !ctx.call) return undefined;
  const runId = t.source.id;
  const run = ((await ctx.call("runs.get", { runId }).catch(() => null)) as { run?: { status?: string; waitReason?: string } } | null)?.run;
  if (run?.status !== "waiting") return undefined;
  const reason = run.waitReason === "approval" || run.waitReason === "background" || run.waitReason === "key" ? run.waitReason : "approval";
  try { await ctx.call("runs.resume", { runId, reason }); } catch { return undefined; }   // it went on by itself between the read and the call
  t.workingNotes = { ...t.workingNotes, [RESUMED_NOTE]: "1" };
  saveTask(ctx.db, t);
  return runId;
}

/** The run engine moved on by itself (tasks.act did it inline): remember that, so the consumer leaves the Run alone. */
export function markResumed(ctx: TasksCtx, taskId: string): void {
  const t = findTask(ctx.db, taskId);
  if (!t) return;
  t.workingNotes = { ...t.workingNotes, [RESUMED_NOTE]: "1" };
  saveTask(ctx.db, t);
}
