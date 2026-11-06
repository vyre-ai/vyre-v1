// Goals, as the screens draw them: the words of a status, the note under a row, the steady bar, the chart, the budget line and the activity by day. Pure, so the sidebar, the goal page,
// the card in a chat and the phone read one source, and the tests read it without a screen.

import { countLabel } from "../../../../../../ui/src/tokens/calm.ts";
import { dateIn, dayIn, dueText, instantOf, localInput, whenText } from "../../../../../../lib/zones.ts";
import type { Zones } from "../../../../../../lib/zones.ts";
/** A dash (hyphen, en or em) left at the end of a line once the deadline is cut off. Built from code points so no dash character sits in the source (no-em-dash lint). */
const TRAILING_DASH = new RegExp(`\\s*[${String.fromCharCode(0x2014, 0x2013)}-]+\\s*$`);

export type Status = "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
export type Tone = "plain" | "need" | "stuck" | "ok" | "dim";
export interface Who { kind: string; id: string }
export interface Progress { value?: number; target?: number; start?: number; percent?: number; readAt?: number; error?: string; itemsDone?: number; items?: number; tasksDone: number; tasks: number }
export interface GoalLine {
  id: string; title: string; status: Status; statusReason?: string; owner: string; leadAgentId: string; threadId?: string; folderId?: string; deadline: number; nextCheckinAt?: number; progress: Progress; projectId?: string; updatedAt: number;
}
export interface Permission { act: string; target: string; label: string; granted?: boolean }
export interface Retro { summary: string; worked: string[]; didNot: string[]; playbook?: string }
export interface Goal extends GoalLine {
  outcome?: string;
  finish: { kind: "number" | "checklist" | "owner"; line: string; target?: number; direction?: "up" | "down"; unit?: string; source?: { kind: string; label?: string }; items?: Array<{ id: string; text: string; done?: boolean; taskId?: string }> };
  helpers: Who[]; recordIds: string[]; budget: { spendMicros?: number; turns?: number }; rhythm: { every: "day" | "hours" | "week"; at?: string; hours?: number; day?: number }; zone: string;
  quiet: { from: string; to: string } | null; permissions: Permission[]; rootTaskId?: string; folderId?: string; lastCheckinAt?: number; checkins: number; spentMicros: number; turns: number;
  stuckAfter: number; endedAt?: number; ended?: "done" | "missed" | "stopped"; summary?: string; retro?: Retro; createdBy: string; createdAt: number;
}
export interface TaskLine { taskId: string; key?: string; title: string; state: string; assigned?: Who; blocked: boolean }
export interface WaitLine { taskId: string; kind: string; title: string; assigned?: Who; since: number }
export interface ActivityLine { at: number; kind: string; text: string; tpl?: string; by?: string; ref?: string }
export interface Reading { at: number; value?: number; ok: boolean; error?: string }
/** One step of a drafted plan: what it is, why it should move the number, and who does it. */
export interface PlanStep { key: string; title: string; why: string; impact?: string; brief?: string; doneMeans?: string[]; assigned: Who; reviewer?: Who; approver?: Who; dependsOn?: string[]; due?: number }
export interface GoalPageData { goal: Goal; draftPlan?: PlanStep[]; tasks: TaskLine[]; waiting: WaitLine[]; activity: ActivityLine[]; readings: Reading[] }

export const LIVE: ReadonlySet<Status> = new Set<Status>(["planning", "active", "waiting", "stuck"]);
export const ENDED: ReadonlySet<Status> = new Set<Status>(["done", "missed", "stopped"]);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** The status in words and the colour it is drawn in. Only what changes what you do is coloured: waiting on you, stuck, done. */
export function statusOf(g: Pick<GoalLine, "status" | "statusReason" | "owner">, me?: string): { word: string; tone: Tone } {
  switch (g.status) {
    case "draft": return { word: "Draft", tone: "dim" };
    case "planning": return { word: "Planning", tone: "plain" };
    case "active": return { word: "On track", tone: "plain" };
    case "waiting": return { word: me !== undefined && me === g.owner ? "Waiting on you" : "Waiting", tone: "need" };
    case "stuck": return { word: "Stuck", tone: "stuck" };
    case "paused": return { word: "Paused", tone: "dim" };
    case "done": return { word: "Done", tone: "ok" };
    case "missed": return { word: "Missed", tone: "dim" };
    case "stopped": return { word: "Stopped", tone: "dim" };
  }
}

/** 0 to 1, steady: the share of the way from the start to the target, else of the checklist, else of the plan. */
export function fractionOf(p: Progress): number {
  if (p.percent !== undefined) return Math.max(0, Math.min(1, p.percent / 100));
  if (p.items) return (p.itemsDone ?? 0) / p.items;
  return p.tasks > 0 ? p.tasksDone / p.tasks : 0;
}

/** "212 / 300", "3 of 5", or "2 of 4 tasks". A number that could not be read says so, never a guess. */
export function numberOf(p: Progress): string {
  if (p.target !== undefined) return p.value === undefined ? (p.error ? "Can't read" : "Not read yet") : `${fmt(p.value)} / ${fmt(p.target)}`;
  if (p.items !== undefined) return `${p.itemsDone ?? 0} of ${p.items}`;
  return `${p.tasksDone} of ${p.tasks} tasks`;
}
/** The quiet count in a sidebar row: "212/300", "3/5", "2/4". No bar, no words (the calm pass); a number that could not be read says nothing. */
export function countOf(p: Progress): string {
  if (p.target !== undefined) return p.value === undefined ? "" : countLabel(Math.round(p.value), Math.round(p.target));
  if (p.items !== undefined) return countLabel(p.itemsDone ?? 0, p.items);
  return countLabel(p.tasksDone, p.tasks);
}
export const fmt = (n: number): string => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/** A time as people say it, from now, in the Space's zone with the viewer's beside it when it differs: "9:00 AM (10:00 PM your time)", "Tomorrow 9:00 AM", "Thu 9:00 AM", "7 Nov". */
export function whenWords(at: number, now: number, z: Zones): string {
  return whenText(at, now, z);
}
/** The deadline as a date: "Fri 7 Nov, 6:00 PM", in the Space's zone with the viewer's time in brackets. The finish line's subtitle and the Due chip both say it from the one deadline. */
export function dueWords(at: number, z: Zones): string {
  return dueText(at, z);
}
/** The finish line in words, ending with the real deadline: a date the words carry ("by Friday") is replaced, so the line and the chip never disagree. A dash the agent left before its own date goes with it. */
export function lineWithDue(line: string, deadline: number, z: Zones): string {
  return `${stripDue(line)} by ${dueWords(deadline, z)}`;
}
/** "4 days left", "18 hours left", "Due now". */
export function leftWords(deadline: number, now: number): string {
  const d = deadline - now;
  if (d <= 0) return "Past the deadline";
  if (d < HOUR) return "Due within the hour";
  if (d < DAY) return `${Math.floor(d / HOUR)} hours left`;
  const days = Math.floor(d / DAY);
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** The second line of a goal's row: what changes what you do first, else when it next checks in. */
export function rowNote(g: GoalLine, now: number, z: Zones, me?: string): { lead?: string; tone?: Tone; text: string } {
  const s = statusOf(g, me);
  const num = numberOf(g.progress);
  if (g.status === "waiting" || g.status === "stuck") return { lead: s.word, tone: s.tone, text: num };
  if (ENDED.has(g.status) || g.status === "paused" || g.status === "draft") return { lead: s.word, tone: s.tone, text: num };
  return { text: g.nextCheckinAt ? `${num} · Check-in ${whenWords(g.nextCheckinAt, now, z)}` : num };
}

/** The Goals group: what needs you first, then live goals by their next check-in, then the rest, newest first. Ended goals leave after a week. */
export function sidebarGoals(goals: readonly GoalLine[], now: number): GoalLine[] {
  const rank = (g: GoalLine): number => (g.status === "waiting" || g.status === "stuck" ? 0 : LIVE.has(g.status) ? 1 : g.status === "draft" || g.status === "paused" ? 2 : 3);
  return goals
    .filter((g) => !ENDED.has(g.status) || now - g.updatedAt < 7 * DAY)
    .slice()
    // ties end on the deadline, the title and the id, so two loads of the same goals draw the same list (lane l-polish L5)
    .sort((a, b) => rank(a) - rank(b) || (a.nextCheckinAt ?? Infinity) - (b.nextCheckinAt ?? Infinity) || b.updatedAt - a.updatedAt || a.deadline - b.deadline || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** "$4.10 of $25 · 38 of 200 turns", and how much is used (0 to 1). */
export function budgetOf(g: Pick<Goal, "budget" | "spentMicros" | "turns">): { text: string; used: number; warn: boolean } {
  const money = (m: number): string => { const d = m / 1_000_000; return `$${d >= 100 || Number.isInteger(d) ? d.toFixed(0) : d.toFixed(2)}`; };
  const parts = [g.budget.spendMicros ? `${money(g.spentMicros)} of ${money(g.budget.spendMicros)}` : money(g.spentMicros), g.budget.turns ? `${g.turns} of ${g.budget.turns} turns` : `${g.turns} turns`];
  const used = Math.max(g.budget.spendMicros ? g.spentMicros / g.budget.spendMicros : 0, g.budget.turns ? g.turns / g.budget.turns : 0);
  return { text: parts.join(" · "), used: Math.min(1, used), warn: used >= 0.8 };
}

/** "Daily 9:00", "Every 6 hours", "Mondays 9:00", with quiet hours when there are any. */
export function rhythmWords(g: Pick<Goal, "rhythm" | "quiet">): string {
  const r = g.rhythm;
  const base = r.every === "hours" ? `Every ${r.hours ?? 24} hours` : r.every === "week" ? `${["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][r.day ?? 1]} ${r.at ?? "9:00"}` : `Daily ${(r.at ?? "09:00").replace(/^0/, "")}`;
  return g.quiet ? `${base}, quiet ${g.quiet.from.replace(/^0/, "")} to ${g.quiet.to.replace(/^0/, "")}` : base;
}

/** What the plan's row says of a task's state. */
export function taskWord(state: string, blocked: boolean): { word: string; tone: Tone } {
  if (blocked) return { word: "Blocked", tone: "stuck" };
  switch (state) {
    case "done": return { word: "Done", tone: "ok" };
    case "doing": return { word: "Doing", tone: "plain" };
    case "in_review": return { word: "In review", tone: "need" };
    case "awaiting_approval": return { word: "Awaiting approval", tone: "need" };
    case "canceled": return { word: "Canceled", tone: "dim" };
    default: return { word: "To do", tone: "dim" };
  }
}

export interface Chart { ticks: Array<{ y: number; value: number }>; line: string; area: string; targetY: number; pace: string; deadlineX: number; points: Array<{ x: number; y: number; at: number; value: number }>; max: number; min: number }
/**
 * The number over time, in a box of w by h: the readings as one line from the start, the target as a level line, the pace a straight line from the start to the target at the deadline,
 * and where the deadline falls. Unread readings are left out (the line never invents a point). Null with nothing to draw.
 */
export function chartOf(readings: readonly Reading[], g: Pick<Goal, "createdAt" | "deadline" | "finish"> & { progress: Progress }, w: number, h: number, now: number): Chart | null {
  const pts = readings.filter((r) => r.ok && r.value !== undefined).map((r) => ({ at: r.at, value: r.value! }));
  const target = g.finish.target;
  if (pts.length === 0 || target === undefined) return null;
  const t0 = Math.min(g.createdAt, pts[0]!.at), t1 = Math.max(g.deadline, now);
  const start = g.progress.start ?? pts[0]!.value;
  // the axis starts at 0 and ends on a round step past the target and the readings: 100, 200, 300
  const top = Math.max(start, target, ...pts.map((p) => p.value));
  const step = niceStep(top / 3);
  const lo = Math.min(0, start, ...pts.map((p) => p.value));
  const hi = Math.ceil(top / step) * step;
  const span = hi - lo || 1;
  const pad = 4;
  const x = (t: number): number => Math.round(((t - t0) / (t1 - t0 || 1)) * (w - 2 * pad) + pad);
  const y = (v: number): number => Math.round(h - pad - ((v - lo) / span) * (h - 2 * pad));
  const points = pts.map((p) => ({ x: x(p.at), y: y(p.value), at: p.at, value: p.value }));
  // a step line: the number holds until the next reading
  let line = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) line += ` H${points[i]!.x} V${points[i]!.y}`;
  const last = points[points.length - 1]!;
  const end = Math.min(x(now), w - pad);
  if (end > last.x) line += ` H${end}`;
  const area = `${line} V${h - pad} H${points[0]!.x} Z`;
  const ticks: Array<{ y: number; value: number }> = [];
  for (let v = step; v <= hi + 1e-9; v += step) ticks.push({ y: y(v), value: v });
  return { ticks, line, area, targetY: y(target), pace: `M${x(g.createdAt)} ${y(start)} L${x(g.deadline)} ${y(target)}`, deadlineX: x(g.deadline), points, max: hi, min: lo };
}

/** A round step near `raw`: 1, 2 or 5 times a power of ten. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** The activity, newest first, grouped by day in the Space's zone: "Today", "Yesterday", "Mon 3 Nov". */
export function byDay(items: readonly ActivityLine[], now: number, z: Zones): Array<{ day: string; items: ActivityLine[] }> {
  const out: Array<{ day: string; items: ActivityLine[] }> = [];
  for (const it of items) {
    const d = dayIn(it.at, z.space), n = dayIn(now, z.space);
    const label = d === n ? "Today" : d === n - 1 ? "Yesterday" : dateIn(it.at, z.space);
    const last = out[out.length - 1];
    if (last && last.day === label) last.items.push(it); else out.push({ day: label, items: [it] });
  }
  return out;
}

/** The goal a task belongs to, from its working notes: the "Part of" line under a task's title. */
export function partOf(notes: Readonly<Record<string, string>> | undefined): { goalId: string; title: string } | null {
  const id = notes?.["goal.id"], title = notes?.["goal.title"];
  return id && title && notes?.["goal.root"] !== "1" ? { goalId: id, title } : null;
}

/** The goal block a message carries (type "goal"): a draft to start, a check-in, a stuck notice or the end. */
export interface GoalBlock {
  goalId: string; threadId: string; kind: "draft" | "update" | "stuck" | "ended"; title: string; line: string; status: Status; value?: number; prev?: number; target?: number; unit?: string; deadline: number;
  summary?: string; done?: string[]; next?: string[]; needs?: string[]; plan?: string[]; permissions?: string[]; outcome?: "done" | "missed" | "stopped";
}
export function goalBlockOf(b: { type: string; data: unknown }): GoalBlock | null {
  if (b.type !== "goal" || typeof b.data !== "object" || b.data === null) return null;
  const d = b.data as Record<string, unknown>;
  return typeof d["goalId"] === "string" && typeof d["kind"] === "string" && typeof d["title"] === "string" ? (d as unknown as GoalBlock) : null;
}
/** "+18" for a check-in, nothing when there was no number before. */
export function delta(b: Pick<GoalBlock, "value" | "prev">): string | null {
  if (b.value === undefined || b.prev === undefined) return null;
  const d = b.value - b.prev;
  return d === 0 ? "no change" : `${d > 0 ? "+" : ""}${fmt(d)}`;
}

/** The agent's own closing date taken off a finish line ("... by Friday", "... by Wed 11 Nov, 4:16 PM PKT", "... - by Friday."), with the dash that led into it, so the one real deadline is the only date shown. */
export function stripDue(line: string): string {
  return line.replace(/\s+by\s+[^,.]*(,?\s*\d{1,2}:\d{2}(\s*[ap]m)?(\s+[A-Z]{2,5}\b)?)?\.?\s*$/i, "").replace(/\.\s*$/, "").replace(TRAILING_DASH, "").trim();
}
/** The finish line without a closing "by <date>": the deadline has its own place on the page, so the line never says it a second time. */
export function bareLine(line: string): string {
  return stripDue(line);
}
/** A time as a date-and-time field holds it ("2026-11-07T18:00"), in the Space's zone. */
export function toLocalInput(at: number, z: Zones): string {
  return localInput(at, z.space);
}
/** The time a date-and-time field holds, back to a moment in the Space's zone; null when the field is not a full date and time. */
export function fromLocalInput(v: string, z: Zones): number | null {
  return instantOf(v.trim(), z.space);
}
/** The list with the item at `from` moved to `to` (drag to reorder). */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}
/** "Aliza", "Aliza and Rubab", "Aliza, Rubab and Content". */
export function nameList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
/** Whether this person may edit the goal in place: its owner, until it ends. */
export const canEdit = (g: Pick<Goal, "owner" | "status">, me: string): boolean => g.owner === me && !ENDED.has(g.status);
