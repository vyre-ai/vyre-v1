// tasks.plan: one piece of work broken into tasks in one step (agent tool task_plan). A parent, new or existing, and its children with their briefs, what done means, who does each and which others each waits on.
// Atomic: every check runs before the first write, and the events land in one commit. Idempotent: a child is known by its key under its parent, a new parent by its title and maker while it is open, so a retry adds
// nothing. It makes no thread (the baton makes one when the work starts) and it shares nothing: a task an agent made holds no permissions of its own.
import { allTasks, clean, emitTask, ensurePrefix, findTask, getTask, isOpen, newTaskId, out, raise, readPolicy, saveTask, touch } from "../projections.ts";
import type { Assignee, Priority, Task, TasksCtx } from "../projections.ts";
import { INITIAL_STATE, checkSlots, responsibleFor } from "./state.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Child { key: string; title: string; brief?: string; doneMeans?: string[]; assigned: Assignee; reviewer?: Assignee; approver?: Assignee; dependsOn?: string[]; due?: number; priority?: Priority; worker?: "thread" | "crew"; projectId?: string }

export const PLAN_KEY = "plan.key";
/** A parent is held by whoever planned it, who is already at work: it wakes them when its children need them, not when it is made. */
export const PLAN_PARENT = "plan.parent";
/** How a child runs when it is not in its own task thread: `crew` starts a teammate on its branch, and the note says which project. */
export const WORKER_NOTE = "worker.kind";
export const CREW_PROJECT_NOTE = "worker.project";

/** The first key on a loop in what the children wait on, or null. Only keys of this plan can loop: a task that exists already waits on nothing new. */
export function loopIn(children: ReadonlyArray<{ key: string; dependsOn?: readonly string[] | undefined }>): string | null {
  const next = new Map(children.map((c) => [c.key, (c.dependsOn ?? []).filter((d) => children.some((o) => o.key === d))] as const));
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): string | null => {
    if (state.get(k) === 2) return null;
    if (state.get(k) === 1) return k;
    state.set(k, 1);
    for (const d of next.get(k) ?? []) { const hit = visit(d); if (hit !== null) return hit; }
    state.set(k, 2);
    return null;
  };
  for (const k of next.keys()) { const hit = visit(k); if (hit !== null) return hit; }
  return null;
}

const notesOf = (brief: string | undefined, doneMeans: readonly string[] | undefined): Record<string, string> => ({ ...(brief?.trim() ? { brief: brief.trim() } : {}), ...(doneMeans?.length ? { done_means: JSON.stringify(doneMeans) } : {}) });

function fresh(ctx: TasksCtx, title: string, assigned: Assignee, notes: Record<string, string>): Task {
  const now = ctx.now();
  return {
    id: newTaskId(), kind: "work", title, state: INITIAL_STATE.work, blocks: [], actions: [], assigned, fileIds: [], dependsOn: [], followers: [], workingNotes: notes, labels: [], fields: {}, reviewLoops: 0,
    createdBy: ctx.principal.id, createdAt: now, updatedAt: now, version: 0, ...(ctx.thread ? { source: { kind: "chat" as const, id: ctx.thread } } : ctx.run ? { source: { kind: "run" as const, id: ctx.run } } : {}),
  };
}

function announce(ctx: TasksCtx, t: Task): void {
  const by = ctx.principal.id;
  emitTask(ctx, ctx.db, "task.created", t, { kind: t.kind, title: t.title, assigned: t.assigned, recordId: t.recordId, source: t.source }, { type: "created", by });
  emitTask(ctx, ctx.db, "task.assigned", t, { slot: "assigned", to: t.assigned, from: null }, { type: "assigned", by });
  if (t.reviewer) emitTask(ctx, ctx.db, "task.assigned", t, { slot: "reviewer", to: t.reviewer, from: null }, { type: "assigned", by });
  if (t.approver) emitTask(ctx, ctx.db, "task.assigned", t, { slot: "approver", to: t.approver, from: null }, { type: "assigned", by });
}

export async function plan(ctx: TasksCtx, input: In): Promise<unknown> {
  const children = input.children as Child[];
  if ((input.parentTaskId === undefined) === (input.parent === undefined)) raise(ctx, "validation.bad_input", "Say which parent: parentTaskId for one that exists, or parent for a new one.", { errors: ["/parent: exactly one of parent or parentTaskId"] });
  // ---- every check first: nothing below this block fails
  const keys = new Set<string>();
  for (const c of children) {
    if (keys.has(c.key)) raise(ctx, "validation.precondition_failed", `Two children use the key ${c.key}.`, { reason: "duplicate_key", key: c.key });
    keys.add(c.key);
  }
  const loop = loopIn(children);
  if (loop !== null) raise(ctx, "validation.precondition_failed", `These tasks wait on each other in a circle, starting at ${loop}.`, { reason: "dependency_cycle", key: loop });
  const external = new Set<string>();
  for (const c of children) for (const d of c.dependsOn ?? []) {
    if (keys.has(d)) continue;
    if (!findTask(ctx.db, d)) raise(ctx, "validation.precondition_failed", `${c.key} waits on ${d}, which is neither a key in this plan nor a task.`, { reason: "dependency_missing", key: c.key, dependsOn: d });
    external.add(d);
  }
  const policy = readPolicy(ctx.db);
  for (const c of children) checkSlots(ctx, "work", c, policy);
  let parent: Task | undefined;
  if (input.parentTaskId !== undefined) {
    parent = getTask(ctx, input.parentTaskId);
    if (parent.kind !== "work" || !isOpen(parent.state)) raise(ctx, "validation.precondition_failed", "A plan goes under an open work task.", { reason: "parent_closed" });
  }
  await ensurePrefix(ctx);
  // ---- the parent
  const meAssignee: Assignee = { kind: ctx.principal.kind === "agent" ? "agent" : "person", id: ctx.principal.id };
  if (!parent) {
    const p = input.parent as { title: string; brief?: string; doneMeans?: string[]; assigned?: Assignee; recordId?: string; due?: number };
    const title = p.title.trim();
    if (title === "") raise(ctx, "validation.precondition_failed", "A task needs a title.", { reason: "title_required" });
    parent = allTasks(ctx.db, "c.created_by = ? AND c.title = ? AND c.state NOT IN ('done', 'canceled')", ctx.principal.id, title).find((t) => t.kind === "work");
    if (!parent) {
      const made = fresh(ctx, title, p.assigned ?? meAssignee, { ...notesOf(p.brief, p.doneMeans), [PLAN_PARENT]: "1" });
      if (p.recordId !== undefined) made.recordId = p.recordId;
      if (p.due !== undefined) made.due = p.due;
      // the chat the plan was made in is where the parent lives: its holder hears about the work there
      if (ctx.thread) made.threadId = ctx.thread;
      const resp = await responsibleFor(ctx, made.assigned);
      if (resp !== undefined) made.responsible = resp;
      touch(ctx, ctx.db, made);
      announce(ctx, made);
      parent = made;
    }
  }
  // ---- the children: a key already under this parent is that child
  const have = new Map(allTasks(ctx.db, "m.parent_task = ?", parent.id).map((t) => [t.workingNotes[PLAN_KEY] ?? "", t] as const));
  const ids = new Map<string, Task>();
  const made: Task[] = [];
  for (const c of children) {
    const old = have.get(c.key);
    if (old) { ids.set(c.key, old); continue; }
    const notes = notesOf(c.brief, c.doneMeans);
    notes[PLAN_KEY] = c.key;
    if (c.worker === "crew") { notes[WORKER_NOTE] = "crew"; if (c.projectId !== undefined) notes[CREW_PROJECT_NOTE] = c.projectId; }
    const t = fresh(ctx, c.title.trim(), c.assigned, notes);
    t.parentTaskId = parent.id;
    if (c.reviewer) t.reviewer = c.reviewer;
    if (c.approver) t.approver = c.approver;
    if (c.due !== undefined) t.due = c.due;
    if (c.priority !== undefined) t.priority = c.priority;
    if (parent.recordId !== undefined) t.recordId = parent.recordId;
    const resp = await responsibleFor(ctx, c.assigned);
    if (resp !== undefined) t.responsible = resp;
    ids.set(c.key, t);
    made.push(t);
  }
  for (const c of children) {
    const t = ids.get(c.key)!;
    if (!made.includes(t)) continue;
    t.dependsOn = [...new Set((c.dependsOn ?? []).map((d) => ids.get(d)?.id ?? d))];
    saveTask(ctx.db, t);
    touch(ctx, ctx.db, t);
    announce(ctx, t);
  }
  return clean({ parent: out(ctx, parent), children: children.map((c) => { const t = ids.get(c.key)!; return clean({ key: c.key, taskId: t.id, shortKey: t.key, created: made.includes(t) }); }) });
}
