// Projects at risk (spec 3.1 Rules; ARCH 7.1): overdue, blocked or slipped, with the counting rule the section menu shows.
// DECISION: the facts come from the projects and tasks modules the person can already see: projects.list (mine), tasks.list for the open tasks of the project record (overdue = due before
//   now, blocked = the task's blocked flag) and projects.plan for milestones (slipped = a milestone not done whose date has passed). A project that is done or paused is never listed.
// DECISION: the list is the most at-risk first: more reasons, then the earlier due date, then the title. Default 10, at most 100.
import { AT_RISK_RULE, OPEN_STATES, OUT_OF_PLAY, REASON_ORDER, clean, raise, reasonsOf } from "../projections.ts";
import type { HomeCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Project { projectId: string; recordId: string; type: string; title: string; status: string; lead?: string; due?: number }
interface PlanTask { milestone: boolean; due?: number; status: string }
interface OpenTask { due?: number; blocked: boolean }

export async function atRisk(ctx: HomeCtx, input: In): Promise<unknown> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Projects are not available right now.");
  const now = ctx.now();
  const projects: Project[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = (await ctx.call("projects.list", clean({ mine: true, limit: 100, cursor }))) as { projects?: Project[]; next?: string } | null;
    projects.push(...(r?.projects ?? []));
    cursor = r?.next;
    if (!cursor) break;
  }
  const rows: { p: Project; reasons: string[]; overdue: number; blocked: number }[] = [];
  for (const p of projects) {
    if (OUT_OF_PLAY.has(p.status)) continue;
    const tasks = (await ctx.call("tasks.list", { scope: "record", recordId: p.recordId, states: [...OPEN_STATES], limit: 500 })) as { tasks?: OpenTask[] } | null;
    const plan = (await ctx.call("projects.plan", { projectId: p.projectId })) as { tasks?: PlanTask[] } | null;
    const open = tasks?.tasks ?? [];
    const overdue = open.filter((t) => t.due !== undefined && t.due < now).length;
    const blocked = open.filter((t) => t.blocked).length;
    const late = (plan?.tasks ?? []).filter((t) => t.milestone && t.due !== undefined && t.due < now && t.status !== "done" && t.status !== "canceled").length;
    const reasons = reasonsOf({ ...(p.due !== undefined ? { projectDue: p.due } : {}), overdueTasks: overdue, blockedTasks: blocked, lateMilestones: late }, now);
    if (reasons.length) rows.push({ p, reasons, overdue, blocked });
  }
  rows.sort((a, b) => b.reasons.length - a.reasons.length || (a.p.due ?? Infinity) - (b.p.due ?? Infinity) || a.p.title.localeCompare(b.p.title));
  const limit = Math.min(100, Math.max(1, (input.limit as number | undefined) ?? 10));
  return {
    rule: AT_RISK_RULE,
    projects: rows.slice(0, limit).map(({ p, reasons, overdue, blocked }) => clean({
      recordId: p.recordId, type: p.type, title: p.title, reasons: REASON_ORDER.filter((r) => reasons.includes(r)), dueAt: p.due, lead: p.lead, blockedTasks: blocked, overdueTasks: overdue,
    })),
  };
}
