// Home sections A: the pure part. What each section shows, worked out from the capability answers (types from generated/types.ts) and a clock.
// No React and no I/O here, so every rule (top 3, groups by due date, the at-risk wording, the digest limits) is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";

export type NeedsItem = CapMap["tasks.needs_you"]["out"]["items"][number];
export type Task = CapMap["tasks.my_work"]["out"]["tasks"][number];
export type RiskProject = CapMap["home.at_risk"]["out"]["projects"][number];
export type Digest = NonNullable<CapMap["home.digest"]["out"]["digest"]>;
export type DigestItem = Digest["items"][number];
export type Routine = CapMap["home.routines_today"]["out"]["routines"][number];
export type Ref = Task["assigned"];

export const DAY_MS = 86_400_000;
export const NEEDS_LIMIT = 3;
export const MY_WORK_LIMIT = 6;
export const DIGEST_MAX_ITEMS = 7;

/** The clock every date rule reads. `offsetMin` is minutes east of UTC for the person's day. */
export interface Clock { now: number; offsetMin: number }

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** Days since 1970-01-01 in the person's day. */
export function dayNumber(ts: number, offsetMin: number): number {
  return Math.floor((ts + offsetMin * 60_000) / DAY_MS);
}

function parts(ts: number, offsetMin: number): { y: number; m: number; d: number; wd: number; h: number; min: number } {
  const x = new Date(ts + offsetMin * 60_000);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours(), min: x.getUTCMinutes() };
}

export const short = (s: string): string => s.slice(0, 3);

/** "Oct 24" */
export function monthDay(ts: number, offsetMin: number): string {
  const p = parts(ts, offsetMin);
  return `${short(MONTHS[p.m]!)} ${p.d}`;
}

/** "8:10 am" */
export function clockTime(ts: number, offsetMin: number): string {
  const p = parts(ts, offsetMin);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.min).padStart(2, "0")} ${p.h < 12 ? "am" : "pm"}`;
}

/** "8:10 am" today, "Yesterday 4:10 pm", "Oct 22" before that. */
export function whenLabel(ts: number, c: Clock): string {
  const k = dayNumber(ts, c.offsetMin) - dayNumber(c.now, c.offsetMin);
  if (k === 0) return clockTime(ts, c.offsetMin);
  if (k === -1) return `Yesterday ${clockTime(ts, c.offsetMin)}`;
  return monthDay(ts, c.offsetMin);
}

export function greeting(c: Clock): string {
  const h = parts(c.now, c.offsetMin).h;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "Friday, October 24" */
export function dateLine(c: Clock): string {
  const p = parts(c.now, c.offsetMin);
  return `${WEEKDAYS[p.wd]}, ${MONTHS[p.m]} ${p.d}`;
}

export function plural(n: number, one: string, many?: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many ?? `${one}s`}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Today", "Tomorrow", "Yesterday", "Mon" within a week, "Wed Oct 22" when past, "Nov 12" later. */
export function dueLabel(due: number, c: Clock): string {
  const k = dayNumber(due, c.offsetMin) - dayNumber(c.now, c.offsetMin);
  const p = parts(due, c.offsetMin);
  const wd = short(WEEKDAYS[p.wd]!);
  if (k === 0) return "Today";
  if (k === 1) return "Tomorrow";
  if (k === -1) return "Yesterday";
  if (k < 0) return `${wd} ${monthDay(due, c.offsetMin)}`;
  if (k < 7) return wd;
  return monthDay(due, c.offsetMin);
}

// ---------------------------------------------------------------- Needs you

export const KIND_LABEL: Record<NeedsItem["task"]["kind"], string> = {
  approve: "Approve", review: "Review", answer: "Answer", unblock: "Blocked", signature: "Sign", work: "Work",
};

export interface NeedsRow {
  id: string;
  title: string;
  kind: string;
  /** warn for a task that is stuck (Unblock), accent otherwise */
  tone: "accent" | "warn";
  sub: string;
  actionKey: string;
  actionLabel: string;
  /** Approve acts in place; Review, Answer, Unblock and Sign open the item in Needs you, where the thing to look at is. */
  inline: boolean;
  requester: string;
  reason: NeedsItem["reason"];
}

/** The first three the capability returned, in its order. The capability owns the ordering (overdue, due today, blocking, ready); Home never re-sorts. */
export function topNeeds(items: readonly NeedsItem[]): NeedsItem[] {
  return items.slice(0, NEEDS_LIMIT);
}

export function needsRow(item: NeedsItem, nameOf: (id: string) => string): NeedsRow {
  const t = item.task;
  const first = t.actions[0];
  const kind = KIND_LABEL[t.kind];
  const handled = item.handledBy ? ` · Handled by ${nameOf(item.handledBy)}` : "";
  const sub = t.summary ?? "";
  return {
    id: t.id, title: t.title, kind, tone: t.kind === "unblock" || t.blocked ? "warn" : "accent",
    sub: `${sub}${handled}`,
    actionKey: first?.key ?? "open", actionLabel: first?.label ?? (t.kind === "unblock" ? "Unblock" : kind),
    inline: t.kind === "approve" && first !== undefined && first.note !== "required",
    requester: t.createdBy, reason: item.reason,
  };
}

// ---------------------------------------------------------------- My work

export const GROUPS = ["Overdue", "Today", "This week", "Later"] as const;
export type GroupName = (typeof GROUPS)[number];

export function groupOf(due: number | undefined, c: Clock): GroupName {
  if (due === undefined) return "Later";
  const k = dayNumber(due, c.offsetMin) - dayNumber(c.now, c.offsetMin);
  return k < 0 ? "Overdue" : k === 0 ? "Today" : k <= 7 ? "This week" : "Later";
}

/** Earliest due first, no due date last, then the most recently touched. Stable for equal keys. */
export function orderMyWork(tasks: readonly Task[]): Task[] {
  return tasks.map((t, i) => ({ t, i })).sort((a, b) => {
    const x = a.t.due ?? Infinity, y = b.t.due ?? Infinity;
    if (x !== y) return x < y ? -1 : 1;
    if (a.t.updatedAt !== b.t.updatedAt) return b.t.updatedAt - a.t.updatedAt;
    return a.i - b.i;
  }).map((e) => e.t);
}

export interface WorkGroup { name: GroupName; total: number; rows: Task[] }

/** The first `limit` open tasks, grouped. `total` counts every open task in the group, not only the shown ones. */
export function workGroups(open: readonly Task[], c: Clock, limit = MY_WORK_LIMIT): WorkGroup[] {
  const ordered = orderMyWork(open);
  const shown = ordered.slice(0, limit);
  const out: WorkGroup[] = [];
  for (const name of GROUPS) {
    const rows = shown.filter((t) => groupOf(t.due, c) === name);
    if (rows.length) out.push({ name, total: ordered.filter((t) => groupOf(t.due, c) === name).length, rows });
  }
  return out;
}

export function dueCount(open: readonly Task[], c: Clock): number {
  const today = dayNumber(c.now, c.offsetMin);
  return open.filter((t) => t.due !== undefined && dayNumber(t.due, c.offsetMin) <= today).length;
}

/** Review or Approve when the task waits on me in that seat and is not mine to do. */
export function seatLabel(t: Task, me: string): "Review" | "Approve" | null {
  if (t.assigned.id === me) return null;
  if (t.reviewer?.id === me) return "Review";
  if (t.approver?.id === me) return "Approve";
  return null;
}

export type StatusIcon = "todo" | "doing" | "review" | "blocked" | "done";
export function statusIcon(t: Pick<Task, "state" | "blocked"> & { kind?: Task["kind"] }): StatusIcon {
  if (t.state === "done") return "done";
  if (t.blocked) return "blocked";
  if (t.state === "doing") return "doing";
  // a task I am asked to review or approve wears the review mark whatever state it is in (the prototype's check-circle)
  if (t.state === "in_review" || t.state === "awaiting_approval" || t.kind === "review" || t.kind === "approve") return "review";
  return "todo";
}

export const STATE_LABEL: Record<Task["state"], string> = {
  todo: "To do", doing: "Doing", in_review: "Review", awaiting_approval: "Review", done: "Done", canceled: "Canceled",
};

/** The line under a task I handed to someone else. */
export function givenSub(t: Task, nameOf: (id: string) => string, kindOf: (ref: Ref) => string): string {
  const a = t.assigned;
  const k = kindOf(a);
  if (k !== "agent") return `In ${possessive(firstName(nameOf(a.id)))} My work now`;
  if (t.state === "doing") return "Working";
  if (t.state === "in_review") return "Done, waiting on review";
  if (t.state === "awaiting_approval") return "Paused, needs your approval to send";
  if (t.state === "done") return "Done";
  if (t.blocked) return "Blocked";
  return "Starts now";
}

export const possessive = (n: string): string => (n.endsWith("s") ? `${n}'` : `${n}'s`);

/** Who a face menu can assign to, in menu order: people, agents, groups, roles. */
export interface Assignee { ref: Ref; name: string }
export const ASSIGN_GROUPS: { kind: Ref["kind"]; head: string }[] = [
  { kind: "person", head: "People" }, { kind: "agent", head: "Agents" }, { kind: "group", head: "Groups" }, { kind: "role", head: "Roles" },
];

// ---------------------------------------------------------------- Projects at risk

export interface RiskRow {
  id: string;
  title: string;
  type: string;
  /** What is wrong, in words. */
  why: string;
  health: "risk" | "block";
  lead?: string;
  due?: string;
}

export function riskWhy(p: RiskProject): string {
  const bits: string[] = [];
  if (p.reasons.includes("overdue")) bits.push(p.overdueTasks > 0 ? `${plural(p.overdueTasks, "task")} overdue` : "Overdue");
  if (p.reasons.includes("blocked")) bits.push(p.blockedTasks > 0 ? `${plural(p.blockedTasks, "blocked task")}` : "Blocked");
  if (p.reasons.includes("slipped")) bits.push("Plan slipped");
  return bits.join(", ");
}

export function riskRow(p: RiskProject, c: Clock): RiskRow {
  return {
    id: p.recordId, title: p.title, type: recordTypeLabel(p.type), why: riskWhy(p), health: p.reasons.includes("blocked") ? "block" : "risk",
    ...(p.lead !== undefined ? { lead: p.lead } : {}), ...(p.dueAt !== undefined ? { due: monthDay(p.dueAt, c.offsetMin) } : {}),
  };
}

/** "atp" to "ATP", "project" to "Project", "hire_plan" to "Hire plan". */
export function recordTypeLabel(type: string): string {
  const s = type.replaceAll("_", " ");
  return s.length <= 3 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- While you were away

export function digestLimit(d: Digest | null): { show: boolean; headline: string[]; items: DigestItem[] } {
  if (!d || d.seenAt !== undefined) return { show: false, headline: [], items: [] };
  return { show: true, headline: d.headline.slice(0, 3), items: d.items.slice(0, DIGEST_MAX_ITEMS) };
}

export const DIGEST_KIND_LABEL: Record<DigestItem["kind"], string> = {
  decision: "Decided for you", finished: "Finished", record_change: "Changed", routine: "Routine", waiting: "Waiting on you",
};

// ---------------------------------------------------------------- Routines today

export interface RoutineRow { id: string; title: string; sub: string; tone: "plain" | "warn" | "live"; agentId: string; runId?: string }

export function routineSub(r: Routine, c: Clock): { sub: string; tone: RoutineRow["tone"] } {
  const when = clockTime(r.at, c.offsetMin);
  switch (r.state) {
    case "scheduled": return { sub: `Today ${when}`, tone: "plain" };
    case "running": return { sub: r.resultLine ? `Running since ${when} · ${r.resultLine}` : `Running since ${when}`, tone: "live" };
    case "done": return { sub: r.resultLine ? `Ran ${when} · ${r.resultLine}` : `Ran ${when}`, tone: "plain" };
    case "failed": return { sub: r.resultLine ? `Failed ${when} · ${r.resultLine}` : `Failed ${when}`, tone: "warn" };
  }
}

export function routineRows(rs: readonly Routine[], c: Clock): RoutineRow[] {
  return rs.slice().sort((a, b) => a.at - b.at).map((r) => ({
    id: r.routineId, title: r.title, agentId: r.agentId, ...routineSub(r, c), ...(r.runId !== undefined ? { runId: r.runId } : {}),
  }));
}

// ---------------------------------------------------------------- greeting line

export function summaryBits(needs: number, dueToday: number, overdue: number): string[] {
  return [
    needs ? `${plural(needs, "thing needs", "things need")} you` : "",
    dueToday ? `${plural(dueToday, "task")} due today` : "",
    overdue ? `${plural(overdue, "task")} overdue` : "",
  ].filter(Boolean);
}

// ---------------------------------------------------------------- helpers the components share (kept out of the .tsx files so no list there is built with map)

/** "need:tsk_1|need:tsk_2" style keys for the arrow-key order. */
export function rowKeys(prefix: string, ids: readonly (string | number)[]): string[] {
  return ids.map((id) => `${prefix}:${id}`);
}

/** Keys for a list: `prefix:` plus the id each item gives. */
export function rowKeysBy<T>(prefix: string, list: readonly T[], id: (item: T, index: number) => string | number): string[] {
  return list.map((x, i) => `${prefix}:${id(x, i)}`);
}

export function riskRows(ps: readonly RiskProject[], c: Clock): RiskRow[] {
  return ps.map((p) => riskRow(p, c));
}

export function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x] as const));
}
