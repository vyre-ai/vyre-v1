// Projects: the plan (spec 3.4). One payload for Timeline, Board, List and Calendar: the stages, the tasks with who is on them and the ring when review or approval waits, the dependency arrows
// and a today marker. Bars move and resize through reschedule (a slip carries a cascade proposal), arrows are made and removed through link_tasks, and a task gets its thread in the project
// channel when someone first speaks about it.
import { propose } from "./cascade.ts";
import {
  addLink, buildStages, call, clean, closesLoop, dropLink, emitP, ensure, linksOf, loadTasks, planOf, planTask, plansOf, raise, replaceStages, savePlan, sortPlan, stagesOf, tolerant, visible, writeRecord,
} from "../projections.ts";
import type { In, Project, ProjectsCtx, TaskView } from "../projections.ts";

/** A task of the project, or the same answer as for one that does not exist. */
async function taskOf(ctx: ProjectsCtx, p: Project, taskId: string): Promise<{ task: TaskView; all: TaskView[] }> {
  const all = await loadTasks(ctx, p);
  const task = all.find((t) => t.taskId === taskId);
  if (!task) raise(ctx, "validation.not_found", "That task is not in this project.");
  return { task, all };
}

// ---- projects.plan ----

export async function plan(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const plans = plansOf(ctx.db, p.projectId);
  const rows = (await loadTasks(ctx, p))
    .map((t) => planTask(t, plans.get(t.taskId)))
    .filter((t) => (input.stage === undefined || t.stage === input.stage) && (input.assigned === undefined || t.assigned === input.assigned));
  const ids = new Set(rows.map((t) => t.taskId));
  // an arrow is shown when both ends are in the view
  const links = linksOf(ctx.db, p.projectId).filter((l) => ids.has(l.from) && ids.has(l.to));
  return { stages: stagesOf(ctx.db, p.projectId), tasks: sortPlan(rows), links, today: ctx.now() };
}

// ---- projects.stages.set ----

export async function stagesSet(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const stages = buildStages(ctx, input.stages as Array<{ key?: string; title: string }>);
  const keep = new Set(stages.map((s) => s.key));
  const dropped = stagesOf(ctx.db, p.projectId).filter((s) => !keep.has(s.key));
  if (dropped.length > 0) {
    // a stage with tasks in it cannot be removed: they move first
    const plans = plansOf(ctx.db, p.projectId);
    const live = new Set((await loadTasks(ctx, p)).map((t) => t.taskId));
    for (const s of dropped) {
      const inside = [...plans.values()].filter((r) => r.stage === s.key && live.has(r.taskId)).length;
      if (inside > 0) raise(ctx, "validation.precondition_failed", `${inside} ${inside === 1 ? "task is" : "tasks are"} still in ${s.title}. Move them first.`, { reason: "stage_in_use", stage: s.key, tasks: inside });
    }
  }
  replaceStages(ctx.db, p.projectId, stages);
  await writeRecord(ctx, p, { stages: stages.map((s) => s.key) });
  emitP(ctx, "project.stages_changed", p.projectId, { stages: stages.map((s) => s.key) });
  return { stages };
}

// ---- projects.reschedule ----

export async function reschedule(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const { task, all } = await taskOf(ctx, p, input.taskId);
  const cur = planOf(ctx.db, p.projectId, task.taskId);
  if (input.stage !== undefined && !stagesOf(ctx.db, p.projectId).some((s) => s.key === input.stage)) raise(ctx, "validation.bad_input", `This plan has no stage called ${input.stage}.`, { stage: input.stage });
  const start: number | undefined = input.start ?? cur?.start;
  const due: number | undefined = input.due ?? task.due;
  if (start !== undefined && due !== undefined && start > due) raise(ctx, "validation.bad_input", "A task cannot start after it is due.");
  if (input.due !== undefined && input.due !== task.due) await call(ctx, "tasks.update", { taskId: task.taskId, due: input.due });
  if (input.start !== undefined || input.stage !== undefined) savePlan(ctx.db, p.projectId, task.taskId, { ...(input.start !== undefined ? { start: input.start } : {}), ...(input.stage !== undefined ? { stage: input.stage } : {}) });
  // it slipped when the due date moved later; the later tasks that wait on it are proposed a move, never moved
  const slipped = input.due !== undefined && task.due !== undefined && input.due > task.due;
  const proposal = slipped ? propose(ctx, p, all, { taskId: task.taskId, start: input.start, due: input.due }, true) : undefined;
  const proposalId = proposal?.proposalId;
  emitP(ctx, "project.task_rescheduled", p.projectId, { taskId: task.taskId, start, due, slipped });
  return clean({ taskId: task.taskId, start, due, proposalId });
}

// ---- projects.link_tasks, projects.unlink_tasks ----

export async function linkTasks(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const all = await loadTasks(ctx, p);
  for (const id of [input.fromTaskId, input.toTaskId]) if (!all.some((t) => t.taskId === id)) raise(ctx, "validation.not_found", "That task is not in this project.", { taskId: id });
  const l = { from: String(input.fromTaskId), to: String(input.toTaskId) };
  if (l.from === l.to) raise(ctx, "validation.precondition_failed", "A task cannot wait on itself.", { reason: "self_link" });
  const existing = linksOf(ctx.db, p.projectId);
  if (existing.some((k) => k.from === l.from && k.to === l.to)) return { ok: true };
  if (closesLoop(existing, l)) raise(ctx, "validation.precondition_failed", "That arrow would make two tasks wait on each other.", { reason: "loop" });
  await call(ctx, "tasks.dependencies.add", { taskId: l.to, dependsOnId: l.from });
  addLink(ctx.db, p.projectId, l);
  emitP(ctx, "project.tasks_linked", p.projectId, { fromTaskId: l.from, toTaskId: l.to });
  return { ok: true };
}

export async function unlinkTasks(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const l = { from: String(input.fromTaskId), to: String(input.toTaskId) };
  if (!dropLink(ctx.db, p.projectId, l)) return { ok: false };
  await tolerant(ctx, "tasks.dependencies.remove", { taskId: l.to, dependsOnId: l.from }, null);
  emitP(ctx, "project.tasks_unlinked", p.projectId, { fromTaskId: l.from, toTaskId: l.to });
  return { ok: true };
}

// ---- projects.open_task_thread ----

export async function openTaskThread(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const { task } = await taskOf(ctx, p, input.taskId);
  const known = task.threadId ?? planOf(ctx.db, p.projectId, task.taskId)?.threadId;
  if (known) return { threadId: known };
  if (!p.threadId) raise(ctx, "validation.bad_input", "This project has no channel to open the thread in.");
  // the thread hangs under a small task card in the project channel
  const posted = await call<{ message?: { messageId?: string } }>(ctx, "chat.post", { threadId: p.threadId, body: `Task: ${task.title}` }, { idempotencyKey: `prj-task-card:${p.projectId}:${task.taskId}` });
  const messageId = posted.message?.messageId;
  if (!messageId) raise(ctx, "internal.unexpected", "The task card was not posted.");
  const made = await call<{ thread?: { threadId?: string } }>(ctx, "chat.thread", { threadId: p.threadId, messageId });
  const threadId = made.thread?.threadId;
  if (!threadId) raise(ctx, "internal.unexpected", "The task thread was not opened.");
  savePlan(ctx.db, p.projectId, task.taskId, { threadId });
  emitP(ctx, "project.task_thread_opened", p.projectId, { taskId: task.taskId, threadId });
  return { threadId };
}
