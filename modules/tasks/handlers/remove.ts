// tasks.delete and tasks.restore: a task goes away with Undo. The row stays, marked, so Undo is one write. A held act and a task a Run waits on keep their state machine: they are canceled, never deleted.
import { emitTask, findTask, getTask, isOpen, out, raise, touch } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";
import { mayLetGo } from "./state.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

function check(ctx: TasksCtx, t: Task): void {
  if (!mayLetGo(ctx, t)) raise(ctx, "validation.precondition_failed", "Only someone on this task can delete it.", { reason: "wrong_actor" });
  if (t.source?.kind === "gate" || t.payloadHash !== undefined) raise(ctx, "validation.precondition_failed", "This is a held act. Reject it instead.", { reason: "held_act" });
  if (t.source?.kind === "run" && isOpen(t.state)) raise(ctx, "validation.precondition_failed", "A Run is waiting on this task. Cancel it instead.", { reason: "run_waits" });
}

export async function remove(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  check(ctx, t);
  touch(ctx, ctx.db, t);
  ctx.db.run("UPDATE tasks_meta SET deleted_at = ? WHERE id = ?", ctx.now(), t.id);
  emitTask(ctx, ctx.db, "task.deleted", t, { title: t.title }, { type: "deleted", by: ctx.principal.id });
  return { deleted: true };
}

export async function restore(ctx: TasksCtx, input: In): Promise<unknown> {
  ctx.db.run("UPDATE tasks_meta SET deleted_at = NULL WHERE id = ?", input.taskId);
  const t = findTask(ctx.db, input.taskId);
  if (!t) raise(ctx, "permission.not_found", "That task is not available.");
  if (!mayLetGo(ctx, t)) { ctx.db.run("UPDATE tasks_meta SET deleted_at = ? WHERE id = ?", ctx.now(), t.id); raise(ctx, "validation.precondition_failed", "Only someone on this task can bring it back.", { reason: "wrong_actor" }); }
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.restored", t, {}, { type: "restored", by: ctx.principal.id });
  return { task: out(ctx, t) };
}
