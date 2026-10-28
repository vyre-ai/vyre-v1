// ProjectPage (spec 3.4, 2.12): the pure mapping between the Projects capabilities and the shared Plan, and the words the page uses. A project's tasks come as epoch times and the Plan reads ISO
// days; statuses and people are renamed here once. Nothing in this file calls a capability.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PlanStage, PlanStatus, PlanTask, PlanWho } from "../../../../../../ui/src/Plan/index.tsx";

export type Overview = CapMap["projects.overview"]["out"];
export type PlanOut = CapMap["projects.plan"]["out"];
export type PlanRow = PlanOut["tasks"][number];
export type Member = CapMap["projects.members.list"]["out"]["members"][number];

export const TABS = [{ key: "overview", title: "Overview" }, { key: "plan", title: "Plan" }, { key: "files", title: "Files" }, { key: "chat", title: "Chat" }] as const;
export type TabKey = (typeof TABS)[number]["key"];
export const TAB_SPECS: readonly { key: string; title: string }[] = [{ key: "overview", title: "Overview" }, { key: "plan", title: "Plan" }, { key: "files", title: "Files" }, { key: "chat", title: "Chat" }];

const DAY = 86_400_000;
/** An epoch time as the ISO day the Plan draws (UTC, so every machine agrees). */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const fromIso = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

const STATUS: Readonly<Record<PlanRow["status"], PlanStatus>> = { todo: "todo", doing: "doing", in_review: "review", awaiting_approval: "approval", done: "done", canceled: "todo" };
const BACK: Readonly<Record<PlanStatus, PlanRow["status"]>> = { todo: "todo", doing: "doing", blocked: "doing", review: "in_review", approval: "awaiting_approval", done: "done" };
export const statusBack = (s: PlanStatus): PlanRow["status"] => BACK[s];

/** People are principals; an id starting agt_ is an agent, grp_ a group, rol_ a role, anything else a person. */
export function whoOf(id: string | undefined, name: (id: string) => string): PlanWho | null {
  if (!id) return null;
  return { name: name(id), kind: id.startsWith("agt_") ? "agent" : id.startsWith("grp_") ? "group" : id.startsWith("rol_") ? "role" : "person" };
}

export function planTasks(plan: PlanOut, name: (id: string) => string): PlanTask[] {
  const waits = new Map<string, string[]>();
  for (const l of plan.links) waits.set(l.to, [...(waits.get(l.to) ?? []), l.from]);
  const out: PlanTask[] = [];
  for (const t of plan.tasks) {
    const start = t.start ?? t.due ?? plan.today;
    out.push({
      id: t.taskId, stage: t.stage ?? plan.stages[0]?.key ?? "", kind: t.milestone ? "milestone" : "task", title: t.title, start: isoDay(start), ...(t.milestone ? {} : { end: isoDay(t.due ?? start) }),
      assigned: whoOf(t.assigned, name), reviewer: whoOf(t.reviewer, name), approver: whoOf(t.approver, name), status: STATUS[t.status], deps: waits.get(t.taskId) ?? [],
    });
  }
  return out;
}
export const planStages = (plan: PlanOut): PlanStage[] => plan.stages.map((s) => ({ id: s.key, name: s.title }));

/** What an edit on the Plan changed, task by task: the dates, the stage or the status. */
export interface TaskEdit { taskId: string; start?: number; due?: number; stage?: string; status?: PlanRow["status"] }
export function editsBetween(before: readonly PlanTask[], after: readonly PlanTask[]): TaskEdit[] {
  const was = new Map(before.map((t) => [t.id, t]));
  const out: TaskEdit[] = [];
  for (const t of after) {
    const b = was.get(t.id);
    if (!b) continue;
    const e: TaskEdit = { taskId: t.id };
    if (b.start !== t.start) e.start = fromIso(t.start);
    if ((b.end ?? b.start) !== (t.end ?? t.start)) e.due = fromIso(t.end ?? t.start);
    if (b.stage !== t.stage) e.stage = t.stage;
    if (b.status !== t.status && t.status) e.status = statusBack(t.status);
    if (Object.keys(e).length > 1) out.push(e);
  }
  return out;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Due in 5 days", "Due today", "3 days late". */
export function dueWords(due: number | undefined, now: number): string {
  if (due === undefined) return "No due date";
  const d = Math.round((Date.parse(`${isoDay(due)}T00:00:00Z`) - Date.parse(`${isoDay(now)}T00:00:00Z`)) / DAY);
  return d === 0 ? "Due today" : d > 0 ? `Due in ${plural(d, "day")}` : `${plural(-d, "day")} late`;
}

export const dateWords = (ms: number | undefined): string => (ms === undefined ? "" : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));

export function ago(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / 1440)} d ago`;
}

export const ROLE_WORDS: Readonly<Record<Member["role"], string>> = { lead: "Lead", member: "Member", reviewer: "Reviewer", guest: "Guest" };

/** The words a cascade proposal gets from the server: "3 later tasks move, the Tuesday consult still holds". */
export function cascadeWords(c: { moves: readonly unknown[]; holds: readonly { reason: string }[]; summary: string }): string {
  return c.summary || `${plural(c.moves.length, "later task")} move${c.moves.length === 1 ? "s" : ""}${c.holds.length ? `, ${c.holds.length} still hold${c.holds.length === 1 ? "s" : ""}` : ""}`;
}
