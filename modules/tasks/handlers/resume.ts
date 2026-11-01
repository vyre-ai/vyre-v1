// A Run that waits on a task goes on when the task reaches ANY terminal state (work baton, item 6). tasks.act resumed the Run for approve, answer and resolved only; a task finished by
// tasks.transition, by a baton tool (the last approval, a submit with no reviewer), canceled, or sent to Done by a hook left the Run parked. This consumer closes that gap for every path:
// it listens to task.transitioned, and when the task is Done or Canceled and came from a Run that is waiting, it resumes that Run for the reason it waits for.
// tasks.act still resumes at once and marks the task (the note run.resumed), so the consumer never resumes a Run that already went on and is now waiting on something else.
import { allTasks, findTask, isOpen, saveTask } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";

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

// ---- the source decided ----

interface SourceEvent { name: string; payload: Record<string, unknown> }
type Close = { to: "done" | "canceled"; note: string };

/** Close what the source decided, as the host: the task of a question or plan someone answered in the chat (it need not be the person it was addressed to), and every approver's task of a request. */
async function closeAll(ctx: TasksCtx, tasks: readonly Task[], close: Close): Promise<string[]> {
  const closed: string[] = [];
  for (const t of tasks) {
    if (!isOpen(t.state) || !ctx.call) continue;
    await ctx.call("tasks.transition", { taskId: t.id, to: close.to, note: close.note });
    closed.push(t.id);
  }
  return closed;
}

const REQUEST_ENDS: Readonly<Record<string, Close>> = {
  "access.granted": { to: "done", note: "Approved" }, "access.declined": { to: "canceled", note: "Declined" },
  "vault.request_fulfilled": { to: "done", note: "Provided" }, "vault.request_declined": { to: "canceled", note: "Declined" }, "vault.request_canceled": { to: "canceled", note: "Withdrawn" },
};

/**
 * One decision settles the task, whichever door it came through. The block or the request is the source: tasks.act goes through it, and when someone decides at the source first (the card in the chat, the access
 * or key card, Settings) this closes the task behind it. It runs as the host, so it reaches tasks addressed to someone else: a second person in the chat who answered, the other approvers of a request.
 */
export async function settleFromSource(ctx: TasksCtx, event: SourceEvent): Promise<string[]> {
  const p = event.payload;
  const threadId = typeof p["threadId"] === "string" ? p["threadId"] : "";
  const end = REQUEST_ENDS[event.name];
  if (end) {
    const id = typeof p["requestId"] === "string" ? p["requestId"] : "";
    return id ? closeAll(ctx, allTasks(ctx.db, "m.source_kind = 'manual' AND m.source_id = ?", id), end) : [];
  }
  const asked = threadId ? allTasks(ctx.db, "m.source_kind = 'chat' AND m.source_id = ? AND c.state NOT IN ('done', 'canceled')", threadId) : [];
  if (event.name === "block.answered") {
    return closeAll(ctx, asked.filter((t) => t.kind === "answer" && t.workingNotes["chat.block"] === p["blockId"]), { to: "done", note: "Answered" });
  }
  const plan = asked.filter((t) => t.kind === "approve" && t.workingNotes["chat.plan"] === p["planId"]);
  return closeAll(ctx, plan, event.name === "plan.approved" ? { to: "done", note: "Approved" } : { to: "canceled", note: "Sent back" });
}
