// Projects: the cascade (spec 3.4). When something slips, the plan proposes which later tasks move and which dates still hold ("3 later tasks move, the Tuesday consult still holds"),
// and a person applies the proposal or keeps the dates. Nothing moves until a person says apply (an agent proposes the same, never applies).
import {
  call, clean, emitP, ensure, isPerson, keyed, linksOf, loadTasks, me, newId, plansOf, proposalBy, raise, remember, savePlan, saveProposal, visible,
} from "../projections.ts";
import type { Hold, In, Link, Move, Project, ProjectsCtx, Proposal, TaskState, TaskView } from "../projections.ts";

export interface Dated { taskId: string; title: string; state: TaskState; start?: number | undefined; due?: number | undefined }
export interface Change { taskId: string; start?: number | undefined; due?: number | undefined }
export interface CascadePlan { moves: Move[]; holds: Hold[]; summary: string }

/**
 * The cascade of one change. The changed task takes its new dates; every task that depends on it, directly or through others, is looked at in dependency order. One that would start before the
 * task it waits on is due moves by exactly the gap (its length is kept); one that already starts after it holds. Done and canceled tasks hold, and so do tasks with no dates.
 * Pure: the same tasks, arrows and change give the same plan.
 */
export function planCascade(tasks: readonly Dated[], links: readonly Link[], change: Change): CascadePlan {
  const by = new Map<string, Dated>(tasks.map((t) => [t.taskId, { ...t }]));
  const root = by.get(change.taskId);
  if (!root) return { moves: [], holds: [], summary: "No later tasks move" };
  if (change.start !== undefined) root.start = change.start;
  if (change.due !== undefined) root.due = change.due;
  const next = new Map<string, string[]>();
  const before = new Map<string, string[]>();
  for (const l of links) {
    if (!by.has(l.from) || !by.has(l.to)) continue;
    next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
    before.set(l.to, [...(before.get(l.to) ?? []), l.from]);
  }
  // everything that waits on the changed task, near or far
  const reach = new Set<string>();
  const stack = [...(next.get(root.taskId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reach.has(id) || id === root.taskId) continue;
    reach.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  // dependency order within the reached set: a task is handled once everything it waits on inside the set has been; ties by id so the plan is the same every time
  const handled = new Set<string>([root.taskId]);
  const pending = new Set(reach);
  const topo: string[] = [];
  while (pending.size > 0) {
    const batch = [...pending].filter((id) => (before.get(id) ?? []).every((p) => handled.has(p) || !reach.has(p))).sort();
    if (batch.length === 0) break;   // a loop (arrows refuse to close one, so this does not happen): stop rather than spin
    for (const id of batch) { pending.delete(id); handled.add(id); topo.push(id); }
  }

  const moves: Move[] = [];
  const holds: Hold[] = [];
  const clear: string[] = [];
  const moved = new Set<string>([root.taskId]);
  const endOf = (t: Dated): number | undefined => t.due ?? t.start;
  for (const id of topo) {
    const t = by.get(id) as Dated;
    if (t.state === "done" || t.state === "canceled") { holds.push({ taskId: id, reason: t.state === "done" ? "Already done" : "Canceled" }); continue; }
    const waits = (before.get(id) ?? []).filter((p) => moved.has(p)).map((p) => by.get(p) as Dated);
    const ends = waits.map(endOf).filter((e): e is number => e !== undefined);
    const begin = t.start ?? t.due;
    if (begin === undefined) { holds.push({ taskId: id, reason: "Has no dates yet" }); continue; }
    if (ends.length === 0) { holds.push({ taskId: id, reason: "The task it waits on has no dates yet" }); continue; }
    const required = Math.max(...ends);
    if (begin >= required) {
      const gate = waits.filter((w) => endOf(w) === required)[0];
      holds.push({ taskId: id, reason: `Starts after ${gate?.title ?? "the task it waits on"} ends` });
      clear.push(t.title);
      continue;
    }
    const shift = required - begin;
    moves.push(clean({
      taskId: id, fromStart: t.start, toStart: t.start === undefined ? undefined : t.start + shift, fromDue: t.due, toDue: t.due === undefined ? undefined : t.due + shift,
    }) as Move);
    if (t.start !== undefined) t.start += shift;
    if (t.due !== undefined) t.due += shift;
    moved.add(id);
  }
  const n = moves.length;
  const head = n === 0 ? "No later tasks move" : `${n} later ${n === 1 ? "task moves" : "tasks move"}`;
  const tail = n === 0 || clear.length === 0 ? "" : clear.length === 1 ? `, ${clear[0]} still holds` : `, ${clear.length} still hold`;
  return { moves, holds, summary: `${head}${tail}` };
}

/** The tasks of a project with their dates, as the planner reads them. */
export function dated(tasks: readonly TaskView[], starts: ReadonlyMap<string, { start?: number | undefined }>): Dated[] {
  return tasks.map((t) => ({ taskId: t.taskId, title: t.title, state: t.state, start: starts.get(t.taskId)?.start, due: t.due }));
}

/**
 * Plan the cascade of a change and keep it as an open proposal. Used by projects.cascade (always) and by projects.reschedule when a due date moves later (only when something would move,
 * so a person is never asked about nothing).
 */
export function propose(ctx: ProjectsCtx, p: Project, tasks: readonly TaskView[], change: Change, onlyIfMoves = false): Proposal | undefined {
  const plan = planCascade(dated(tasks, plansOf(ctx.db, p.projectId)), linksOf(ctx.db, p.projectId), change);
  if (onlyIfMoves && plan.moves.length === 0) return undefined;
  const proposal: Proposal = { proposalId: newId("csc", ctx.now()), projectId: p.projectId, taskId: change.taskId, by: me(ctx), createdAt: ctx.now(), state: "open", moves: plan.moves, holds: plan.holds, summary: plan.summary };
  saveProposal(ctx.db, proposal);
  emitP(ctx, "project.cascade_proposed", p.projectId, { proposalId: proposal.proposalId, moves: proposal.moves.length, by: proposal.by });
  return proposal;
}

// ---- projects.cascade ----

export async function cascade(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  if (input.start === undefined && input.due === undefined) raise(ctx, "validation.bad_input", "Say the new start or due date.");
  const tasks = await loadTasks(ctx, p);
  const t = tasks.find((x) => x.taskId === input.taskId);
  if (!t) raise(ctx, "validation.not_found", "That task is not in this project.");
  const start = input.start ?? plansOf(ctx.db, p.projectId).get(t.taskId)?.start;
  const due = input.due ?? t.due;
  if (start !== undefined && due !== undefined && start > due) raise(ctx, "validation.bad_input", "A task cannot start after it is due.");
  const proposal = propose(ctx, p, tasks, { taskId: t.taskId, start: input.start, due: input.due }) as Proposal;
  return { proposalId: proposal.proposalId, moves: proposal.moves, holds: proposal.holds, summary: proposal.summary };
}

// ---- projects.apply_cascade ----

export async function applyCascade(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const again = keyed<{ moved: number }>(ctx.db, input.idempotencyKey, "projects.apply_cascade");
  if (again) return again;
  const proposal = proposalBy(ctx.db, input.proposalId);
  if (!proposal || proposal.projectId !== p.projectId) raise(ctx, "validation.not_found", "That proposal does not exist.");
  if (proposal.state !== "open") raise(ctx, "validation.precondition_failed", "That proposal was already settled.", { reason: "already_resolved", state: proposal.state });
  if (input.decision === "keep") {
    saveProposal(ctx.db, { ...proposal, state: "kept" });
    emitP(ctx, "project.dates_kept", p.projectId, { proposalId: proposal.proposalId });
    const res = { moved: 0 };
    remember(ctx.db, input.idempotencyKey, "projects.apply_cascade", res);
    return res;
  }
  // only a person applies: the agent that proposed it, or an automation, waits for one
  if (!isPerson(ctx)) raise(ctx, "permission.no_grant", "A person applies a cascade; an agent only proposes it.", { reason: "person_applies" });
  const tasks = await loadTasks(ctx, p);
  const starts = plansOf(ctx.db, p.projectId);
  for (const m of proposal.moves) {
    const t = tasks.find((x) => x.taskId === m.taskId);
    if (!t || t.due !== m.fromDue || starts.get(m.taskId)?.start !== m.fromStart) {
      raise(ctx, "validation.precondition_failed", "The plan changed since this was proposed. Ask for a new proposal.", { reason: "stale_proposal", taskId: m.taskId });
    }
  }
  for (const m of proposal.moves) {
    if (m.toDue !== undefined) await call(ctx, "tasks.update", { taskId: m.taskId, due: m.toDue }, { idempotencyKey: `csc:${proposal.proposalId}:${m.taskId}` });
    if (m.toStart !== undefined) savePlan(ctx.db, p.projectId, m.taskId, { start: m.toStart });
  }
  saveProposal(ctx.db, { ...proposal, state: "applied" });
  emitP(ctx, "project.cascade_applied", p.projectId, { proposalId: proposal.proposalId, moved: proposal.moves.length });
  const res = { moved: proposal.moves.length };
  remember(ctx.db, input.idempotencyKey, "projects.apply_cascade", res);
  return res;
}
