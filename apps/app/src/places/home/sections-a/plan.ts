// Home My work in Plan mode: the open tasks as the shared Plan timeline's tasks, and what a change in the Plan means for the tasks (move, state, assignee).
// A task is a bar ending on its due day and lasting `effort` days (one day without it); a task without a due date is not on the timeline.
import { toDay, toIso } from "../../../../../../ui/src/Plan/logic.ts";
import type { PlanStage, PlanStatus, PlanTask, PlanWho } from "../../../../../../ui/src/Plan/types.ts";
import { DAY_MS, dayNumber } from "./model.ts";
import type { Clock, Ref, Task } from "./model.ts";

export const PERSONAL_STAGE = "personal";

export function planStatus(t: Pick<Task, "state" | "blocked" | "kind">): PlanStatus {
  if (t.state === "done") return "done";
  if (t.blocked) return "blocked";
  if (t.state === "doing") return "doing";
  if (t.state === "in_review" || (t.state === "todo" && t.kind === "review")) return "review";
  if (t.state === "awaiting_approval" || (t.state === "todo" && t.kind === "approve")) return "approval";
  return "todo";
}

/** The Task state a Plan status sets (the reverse of planStatus, for the states a person can choose). */
export function stateOf(s: PlanStatus): Task["state"] {
  return s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "in_review" : s === "approval" ? "awaiting_approval" : "todo";
}

export interface PlanContext {
  clock: Clock;
  recordTitle(id: string): string | undefined;
  name(id: string): string;
  kindOf(ref: Ref): string;
}

const whoOf = (r: Ref, c: PlanContext): PlanWho => ({ name: c.name(r.id), kind: c.kindOf(r) === "agent" ? "agent" : c.kindOf(r) === "group" ? "group" : c.kindOf(r) === "role" ? "role" : "person" });

export function planTasks(tasks: readonly Task[], c: PlanContext): PlanTask[] {
  const out: PlanTask[] = [];
  for (const t of tasks) {
    if (t.due === undefined) continue;
    const end = dayNumber(t.due, c.clock.offsetMin);
    const days = Math.max(1, Math.round(t.effort ?? 1));
    out.push({
      id: t.id, stage: t.recordId ?? PERSONAL_STAGE, kind: "task", title: t.title, start: toIso(end - (days - 1)), end: toIso(end), status: planStatus(t),
      ...(t.assigned ? { assigned: whoOf(t.assigned, c) } : {}), effort: `${days}d`, deps: t.dependsOn,
    });
  }
  return out;
}

export function planStages(tasks: readonly Task[], c: PlanContext): PlanStage[] {
  const seen: PlanStage[] = [];
  for (const t of tasks) {
    const id = t.recordId ?? PERSONAL_STAGE;
    if (t.due === undefined || seen.some((s) => s.id === id)) continue;
    seen.push({ id, name: t.recordId ? (c.recordTitle(t.recordId) ?? "Project") : "Personal" });
  }
  return seen;
}

export type PlanEdit =
  | { kind: "reschedule"; id: string; due: number; effort: number }
  | { kind: "state"; id: string; to: Task["state"] }
  | { kind: "assign"; id: string; to: Ref | null };

/** What changed between two versions of the Plan's tasks, as the writes Home makes. */
export function planEdits(prev: readonly PlanTask[], next: readonly PlanTask[], tasks: readonly Task[], c: PlanContext, people: readonly { id: string; name: string; kind: string }[]): PlanEdit[] {
  const out: PlanEdit[] = [];
  for (const n of next) {
    const p = prev.find((x) => x.id === n.id);
    const t = tasks.find((x) => x.id === n.id);
    if (!p || !t) continue;
    if (n.end !== p.end || n.start !== p.start) {
      const end = toDay(n.end ?? n.start), was = toDay(p.end ?? p.start);
      out.push({ kind: "reschedule", id: n.id, due: (t.due ?? 0) + (end - was) * DAY_MS, effort: end - toDay(n.start) + 1 });
    }
    if (n.status !== p.status && n.status !== undefined) out.push({ kind: "state", id: n.id, to: stateOf(n.status) });
    const a = n.assigned ?? null, b = p.assigned ?? null;
    if ((a?.name ?? null) !== (b?.name ?? null)) {
      const hit = a ? people.find((x) => x.name === a.name) : undefined;
      out.push({ kind: "assign", id: n.id, to: a ? (hit ? { kind: hit.kind as Ref["kind"], id: hit.id } : null) : null });
    }
  }
  return out;
}
