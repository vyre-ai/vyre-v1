// tasks.archive and tasks.unarchive (lane r42-alive, living tasks): a task that no longer matters is put away with its reason, never deleted. Archived is a mark beside the task (tasks_archive), not a
// seventh state: the task keeps the state it had, so Put back is one write and the task is exactly where it was. A marked task leaves Needs you, My work, the long list, the counts and the clock;
// tasks.get, a search and the Archived list still show it, with who put it away, when and why.
// Archiving never strands whoever is waiting: a held act is rejected, a task a Run waits on is canceled, and a task another open task waits on is canceled, each through the path that tells the waiter.
import { isTrustedService } from "../../../lib/trust.ts";
import {
  clearArchived,
  emitTask,
  getTask,
  isOpen,
  markArchived,
  openIndex,
  out,
  raise,
  touch,
  visibleTo,
  whoIs,
} from "../projections.ts";
import type { ArchiveCode, Task, TasksCtx } from "../projections.ts";
import { mayLetGo } from "./state.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const WHY_MAX = 300;

function refuse(ctx: TasksCtx, message: string, reason: string): never {
  raise(ctx, "validation.precondition_failed", message, { reason });
}

/** Why this task cannot be archived, or null. The same three waiters tasks.delete protects, and one more: a task another open task waits on. */
export function cannotArchive(ctx: TasksCtx, t: Task): { message: string; reason: string } | null {
  if (!isOpen(t.state)) return { message: "This task is closed already.", reason: "closed" };
  if (t.source?.kind === "gate" || t.payloadHash !== undefined)
    return { message: "This is a held act. Reject it instead.", reason: "held_act" };
  if (t.source?.kind === "run")
    return { message: "A Run is waiting on this task. Cancel it instead.", reason: "run_waits" };
  if (openIndex(ctx.db).blocking.has(t.id))
    return { message: "Other work is waiting on this task. Cancel it instead.", reason: "others_wait" };
  return null;
}

/**
 * Put a task away with its reason. The one writer of the archive mark: tasks.archive calls it for a person or an agent (code hand), and the rules of the module call it with their own code and proof.
 * The caller has already decided the task may be archived (cannotArchive).
 */
export function putAway(ctx: TasksCtx, t: Task, a: { code: ArchiveCode; why: string; proof?: unknown }): Task {
  const why = a.why.replace(/\s+/g, " ").trim().slice(0, WHY_MAX);
  const by = ctx.principal.id;
  touch(ctx, ctx.db, t);
  markArchived(ctx.db, t, { at: ctx.now(), by, code: a.code, why }, a.proof);
  emitTask(
    ctx,
    ctx.db,
    "task.archived",
    t,
    { title: t.title, code: a.code, ...(why ? { why } : {}), by },
    { type: `archived:${a.code}`, by, ...(why ? { note: why } : {}) },
  );
  return t;
}

export async function archive(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const server = isTrustedService(whoIs(ctx));
  if (!server && !visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
  if (!server && !mayLetGo(ctx, t)) refuse(ctx, "Only someone on this task can archive it.", "wrong_actor");
  if (t.archived !== undefined) return { task: out(ctx, t) }; // archived already: the first reason stands
  const no = cannotArchive(ctx, t);
  if (no) refuse(ctx, no.message, no.reason);
  putAway(ctx, t, { code: "hand", why: String(input.why ?? "") });
  return { task: out(ctx, t) };
}

export async function unarchive(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const server = isTrustedService(whoIs(ctx));
  if (!server && !visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
  if (!server && !mayLetGo(ctx, t)) refuse(ctx, "Only someone on this task can put it back.", "wrong_actor");
  if (t.archived === undefined) return { task: out(ctx, t) };
  const was = t.archived;
  clearArchived(ctx.db, t);
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.unarchived", t, { code: was.code }, { type: "unarchived", by: ctx.principal.id });
  return { task: out(ctx, t) };
}
