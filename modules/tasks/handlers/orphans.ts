// Orphans close as a class (lane r42-alive, living tasks): an ask whose source is gone is gone. A chat closed or erased takes the questions and plans it asked with it; a finished parent takes its Unblock with it.
// (A Run that stopped, an agent that was deleted and a held act that was dropped are handled where they already are: schedule.ts, the agent consumer and the Gate.)
// The ask is put away, never deleted: Put back restores it. Every event here can arrive twice: an archived or closed task is left alone, so a second delivery changes nothing.
import { allTasks, isOpen, isRequest, openIndex, readPolicy } from "../projections.ts";
import { putAway } from "./archive.ts";
import type { Task, TasksCtx } from "../projections.ts";

type Ev = {
  name: string;
  payload: { threadId?: unknown; taskId?: unknown; to?: unknown; goalId?: unknown; outcome?: unknown };
};

/** Nothing else may wait on the ask, no held act or Run hangs on it, and it is still open and not yet put away. */
function orphanable(ctx: TasksCtx, t: Task, waiters: ReadonlyMap<string, string[]>): boolean {
  if (!isOpen(t.state) || t.archived !== undefined) return false;
  if (ctx.db.all("SELECT 1 FROM tasks_putback WHERE task_id = ?", t.id).length > 0) return false; // put back by a person: it stays
  if (t.source?.kind === "gate" || t.payloadHash !== undefined || t.source?.kind === "run") return false;
  return (waiters.get(t.id) ?? []).length === 0;
}

/** The goal a request came from ended (done, missed or stopped): the questions, holds and notices it left open are put away. */
export function onGoalEnded(ctx: TasksCtx, event: Ev): string[] {
  if (!readPolicy(ctx.db).tidy) return [];
  const goalId = typeof event.payload.goalId === "string" ? event.payload.goalId : "";
  const outcome = typeof event.payload.outcome === "string" ? event.payload.outcome : "over";
  if (goalId === "") return [];
  const idx = openIndex(ctx.db);
  const out: string[] = [];
  for (const t of allTasks(
    ctx.db,
    "c.state NOT IN ('done', 'canceled') AND m.source_kind = 'goal' AND m.source_id = ?",
    goalId,
  )) {
    if (!isRequest(t.kind) || !orphanable(ctx, t, idx.waiters)) continue;
    putAway(ctx, t, { code: "gone", why: `The goal it was part of ended (${outcome}).` });
    out.push(t.id);
  }
  return out;
}

/** The chat a task was asked in is closed or gone: the open questions and plans of that chat are put away. */
export function onChatGone(ctx: TasksCtx, event: Ev): string[] {
  if (!readPolicy(ctx.db).tidy) return [];
  const threadId = typeof event.payload.threadId === "string" ? event.payload.threadId : "";
  if (threadId === "") return [];
  const idx = openIndex(ctx.db);
  const out: string[] = [];
  for (const t of allTasks(
    ctx.db,
    "c.state NOT IN ('done', 'canceled') AND m.source_kind = 'chat' AND m.source_id = ?",
    threadId,
  )) {
    if (!isRequest(t.kind) || !orphanable(ctx, t, idx.waiters)) continue;
    putAway(ctx, t, {
      code: "gone",
      why:
        event.name === "thread.closed" ? "The chat it was asked in was closed." : "The chat it was asked in is gone.",
    });
    out.push(t.id);
  }
  return out;
}

/** A parent finished: the Unblock it opened is moot. */
export function onParentFinished(ctx: TasksCtx, event: Ev): string[] {
  if (!readPolicy(ctx.db).tidy) return [];
  const to = event.payload.to;
  const parent = typeof event.payload.taskId === "string" ? event.payload.taskId : "";
  if ((to !== "done" && to !== "canceled") || parent === "") return [];
  const idx = openIndex(ctx.db);
  const out: string[] = [];
  for (const t of allTasks(
    ctx.db,
    "c.state NOT IN ('done', 'canceled') AND m.parent_task = ? AND m.kind = 'unblock'",
    parent,
  )) {
    if (!orphanable(ctx, t, idx.waiters)) continue;
    putAway(ctx, t, { code: "gone", why: "The task it was blocking is finished." });
    out.push(t.id);
  }
  return out;
}
