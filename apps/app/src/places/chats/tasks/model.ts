// The Tasks page as plain data (no React): which section a task sits in, the flat list the virtual list draws, grouping, sorting, the quiet filters, and the words of a due date. Every function is pure and fast at
// 5,000 rows: one pass over the rows, no lookup that walks them again.
import type { CapMap } from "../../../../../../generated/types.ts";
import { dateIn, dayIn, partsIn, titleOf } from "../../../../../../lib/zones.ts";
import type { Zones } from "../../../../../../lib/zones.ts";
import type { TaskState } from "../../../../../../ui/src/TaskPage/model.ts";

export type IndexOut = CapMap["tasks.index"]["out"];
export type TaskRow = IndexOut["rows"][number];
export type NeedItem = CapMap["tasks.needs_you"]["out"]["items"][number];
export type TaskFull = CapMap["tasks.get"]["out"]["task"];
export type Who = TaskRow["assigned"];

export type ScopeKind = "mine" | "given" | "everyone";
export type ViewKind = "list" | "board" | "timeline" | "calendar";
export type GroupKey = "smart" | "status" | "person" | "project" | "label" | "priority" | "due";
export type SortKey = "smart" | "due" | "priority" | "updated" | "title";

export const GROUPS: ReadonlyArray<{ key: GroupKey; title: string }> = [
  { key: "smart", title: "Smart" }, { key: "status", title: "Status" }, { key: "person", title: "Person" }, { key: "project", title: "Project" }, { key: "label", title: "Label" }, { key: "priority", title: "Priority" }, { key: "due", title: "Due" },
];
export const SORTS: ReadonlyArray<{ key: SortKey; title: string }> = [
  { key: "smart", title: "For you" }, { key: "due", title: "Due date" }, { key: "priority", title: "Priority" }, { key: "updated", title: "Last changed" }, { key: "title", title: "Title" },
];
export const PRIORITIES: ReadonlyArray<{ key: NonNullable<TaskRow["priority"]>; title: string }> = [{ key: "urgent", title: "Urgent" }, { key: "high", title: "High" }, { key: "normal", title: "Normal" }, { key: "low", title: "Low" }];
export const BOARD_STATES: readonly TaskState[] = ["todo", "doing", "in_review", "awaiting_approval", "done"];
const PRI_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATE_RANK: Record<string, number> = { doing: 0, in_review: 1, awaiting_approval: 2, todo: 3, done: 4, canceled: 5 };

export const DAY = 86_400_000;
/** A task nobody has moved in this long folds into Assistant's line. */
export const QUIET_MS = 14 * DAY;

export const isOpenState = (s: TaskState): boolean => s !== "done" && s !== "canceled";
/** Whose move it is: the Assigned while the work is open, the Reviewer in review, the Approver in approval. */
export function holderOf(t: Pick<TaskRow, "state" | "assigned" | "reviewer" | "approver">): Who | undefined {
  if (t.state === "todo" || t.state === "doing") return t.assigned;
  if (t.state === "in_review") return t.reviewer ?? t.assigned;
  if (t.state === "awaiting_approval") return t.approver ?? t.assigned;
  return undefined;
}

const dayStart = (ms: number, offsetMin: number): number => { const local = ms + offsetMin * 60_000; return local - (local % DAY) - offsetMin * 60_000; };

export interface Sections { now: TaskRow[]; next: TaskRow[]; quiet: TaskRow[]; waiting: TaskRow[] }

/** Mine, in the order that helps: what is late or due today or under way, then the rest. Quiet tasks fold into one line; what someone else holds waits underneath. Needs you is read apart (tasks.needs_you). */
export function sectionsOf(rows: readonly TaskRow[], me: string, now: number, offsetMin: number, needIds: ReadonlySet<string>): Sections {
  const out: Sections = { now: [], next: [], quiet: [], waiting: [] };
  const end = dayStart(now, offsetMin) + DAY;
  for (const t of rows) {
    if (needIds.has(t.id)) continue;
    if (!isOpenState(t.state)) continue;
    // a group or role task is mine once I took it, or while it is offered to me (the server says whose turn it is)
    const h = holderOf(t);
    const mine = h?.id === me || t.takenBy === me || t.yourTurn === true;
    if (!mine) { out.waiting.push(t); continue; }
    if (t.due === undefined && t.state !== "doing" && now - t.updatedAt > QUIET_MS) { out.quiet.push(t); continue; }
    if ((t.due !== undefined && t.due < end) || t.state === "doing") out.now.push(t);
    else out.next.push(t);
  }
  out.now = byDue(out.now); out.next = byDue(out.next); out.waiting = byDue(out.waiting);
  return out;
}

/** Soonest first, then priority, then last changed. The keys are read once per row and the sort moves numbers: a comparison reads no row, so it costs the same at 5,000 tasks as at 50. */
function byDue(list: readonly TaskRow[]): TaskRow[] {
  const n = list.length;
  const due = new Float64Array(n), pri = new Uint8Array(n), changed = new Float64Array(n), at = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const t = list[i]!; due[i] = t.due ?? Infinity; pri[i] = PRI_RANK[t.priority ?? "normal"]!; changed[i] = t.updatedAt; at[i] = i; }
  at.sort((a, b) => {
    const da = due[a]!, db = due[b]!;
    if (da !== db) return da < db ? -1 : 1;
    const pa = pri[a]!, pb = pri[b]!;
    if (pa !== pb) return pa - pb;
    const ca = changed[a]!, cb = changed[b]!;
    return ca !== cb ? (ca > cb ? -1 : 1) : a - b;
  });
  const out = new Array<TaskRow>(n);
  for (let i = 0; i < n; i++) out[i] = list[at[i]!]!;
  return out;
}

/** found: the ids the server's search matched for the query (words in the brief, notes and summary), when it answered. */
export interface Filter { query: string; label: string | null; person: string | null; priority: string | null; states: readonly TaskState[] | null; waiting: boolean; found?: ReadonlySet<string> | undefined }
export const NO_FILTER: Filter = { query: "", label: null, person: null, priority: null, states: null, waiting: false };
export const isFiltered = (f: Filter): boolean => f.query !== "" || f.label !== null || f.person !== null || f.priority !== null || f.states !== null || f.waiting;

export function filterRows(rows: readonly TaskRow[], f: Filter): readonly TaskRow[] {
  if (!isFiltered(f)) return rows;
  const q = f.query.trim().toLowerCase();
  return rows.filter((t) => {
    if (q !== "" && f.found === undefined && !t.title.toLowerCase().includes(q) && !(t.key ?? "").toLowerCase().includes(q)) return false;
    if (q !== "" && f.found !== undefined && !f.found.has(t.id) && !t.title.toLowerCase().includes(q) && !(t.key ?? "").toLowerCase().includes(q)) return false;
    if (f.label !== null && !t.labels.includes(f.label)) return false;
    if (f.person !== null && holderOf(t)?.id !== f.person && t.assigned.id !== f.person) return false;
    if (f.priority !== null && (t.priority ?? "normal") !== f.priority) return false;
    if (f.states !== null && !f.states.includes(t.state)) return false;
    if (f.waiting && !t.blocked) return false;
    return true;
  });
}

export function sortRows(rows: readonly TaskRow[], key: SortKey): readonly TaskRow[] {
  if (key === "smart") return rows;
  const copy = rows.slice();
  if (key === "due") copy.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  else if (key === "priority") copy.sort((a, b) => PRI_RANK[a.priority ?? "normal"]! - PRI_RANK[b.priority ?? "normal"]!);
  else if (key === "updated") copy.sort((a, b) => b.updatedAt - a.updatedAt);
  else copy.sort((a, b) => a.title.localeCompare(b.title));
  return copy;
}

export interface Names { name(id: string): string; project(recordId: string): string | undefined }

/** Rows by the chosen key, each group in the order the key reads. A task with two labels sits under both. */
export function groupRows(rows: readonly TaskRow[], key: Exclude<GroupKey, "smart">, names: Names, now: number, offsetMin: number): Array<{ key: string; title: string; rows: TaskRow[] }> {
  const groups = new Map<string, { key: string; title: string; rows: TaskRow[]; rank: number }>();
  const put = (k: string, title: string, rank: number, t: TaskRow): void => { let g = groups.get(k); if (!g) { g = { key: k, title, rows: [], rank }; groups.set(k, g); } g.rows.push(t); };
  for (const t of rows) {
    switch (key) {
      case "status": put(t.state, STATE_TITLE[t.state] ?? t.state, STATE_RANK[t.state] ?? 9, t); break;
      case "person": { const h = holderOf(t) ?? t.assigned; put(h.id, names.name(h.id), 0, t); break; }
      case "project": { const p = t.recordId; const title = p ? names.project(p) ?? "A project" : "No project"; put(p ?? "", title, p ? 0 : 1, t); break; }
      case "label": if (t.labels.length === 0) put("", "No label", 1, t); else for (const l of t.labels) put(l, `#${l}`, 0, t); break;
      case "priority": { const p = t.priority ?? "normal"; put(p, PRIORITIES.find((x) => x.key === p)?.title ?? p, PRI_RANK[p] ?? 9, t); break; }
      case "due": { const b = dueBucket(t.due, now, offsetMin); put(b.key, b.title, b.rank, t); break; }
    }
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

const STATE_TITLE: Record<string, string> = { todo: "To do", doing: "Doing", in_review: "In review", awaiting_approval: "Awaiting approval", done: "Done", canceled: "Canceled" };

function dueBucket(due: number | undefined, now: number, offsetMin: number): { key: string; title: string; rank: number } {
  if (due === undefined) return { key: "none", title: "No date", rank: 5 };
  const start = dayStart(now, offsetMin);
  if (due < start) return { key: "late", title: "Overdue", rank: 0 };
  if (due < start + DAY) return { key: "today", title: "Today", rank: 1 };
  if (due < start + 7 * DAY) return { key: "week", title: "This week", rank: 2 };
  if (due < start + 30 * DAY) return { key: "month", title: "This month", rank: 3 };
  return { key: "later", title: "Later", rank: 4 };
}

/** One line of the list. Heights are known, so 5,000 rows lay out with no measuring. */
export type Entry =
  | { kind: "head"; key: string; title: string; count: number; quiet?: boolean }
  | { kind: "need"; key: string; item: NeedItem }
  | { kind: "task"; key: string; row: TaskRow }
  | { kind: "quiet"; key: string; rows: readonly TaskRow[] }
  | { kind: "add"; key: string }
  | { kind: "done"; key: string; count: number; open: boolean }
  | { kind: "empty"; key: string; text: string };

/** Children in the order they were made: a plan reads top to bottom. */
export const planOrder = (a: TaskRow, b: TaskRow): number => a.createdAt - b.createdAt || Number(a.key?.split("-")[1] ?? 0) - Number(b.key?.split("-")[1] ?? 0);

/** The lines a chat shows of the work under way in it, before they fold into a count. */
export const WORK_SHOWN = 6;
/** What is still open, with whatever is moving first, then in plan order. */
export function openWork(rows: readonly TaskRow[]): TaskRow[] {
  const moving = (t: TaskRow): number => (t.state === "doing" ? 0 : t.state === "todo" ? 2 : 1);
  return rows.filter((t) => t.kind === "work" && isOpenState(t.state)).sort((a, b) => moving(a) - moving(b) || planOrder(a, b));
}

/** The second half of a work line when no agent is writing: what the task is waiting for. */
export function workStep(t: Pick<TaskRow, "state" | "blocked" | "dependsOn" | "assigned" | "reviewer" | "approver">, keyOf: (id: string) => string | undefined, nameOf: (id: string) => string): string {
  const waits = t.blocked ? t.dependsOn.map(keyOf).filter((k): k is string => k !== undefined) : [];
  if (waits.length > 0) return `Waits on ${waits.slice(0, 3).join(", ")}`;
  if (t.blocked) return "Waiting";
  const who = holderOf(t);
  if (t.state === "in_review") return who ? `With ${nameOf(who.id)} for review` : "In review";
  if (t.state === "awaiting_approval") return who ? `With ${nameOf(who.id)} to approve` : "Awaiting approval";
  return t.state === "doing" ? "Doing" : "To do";
}

/** A board card's height, known before it draws: two lines of title past this many letters, and a line for its project or for an agent at work. */
const CARD_LINE = 22;
export function cardHeight(t: Pick<TaskRow, "title" | "state" | "assigned">, hasProject: boolean): number {
  const title = t.title.length > CARD_LINE ? 36 : 18;
  const second = hasProject || (t.state === "doing" && t.assigned.kind === "agent") ? 20 : 0;
  return 22 + title + second + 8 + 20 + 7;
}

export const HEIGHT: Record<Entry["kind"], number> = { head: 44, need: 54, task: 48, quiet: 76, add: 44, done: 40, empty: 80 };
export const heightOf = (e: Entry): number => HEIGHT[e.kind];

export interface BuildIn {
  rows: readonly TaskRow[]; needs: readonly NeedItem[]; me: string; now: number; offsetMin: number; scope: ScopeKind | "project" | "snoozed"; group: GroupKey; sort: SortKey; filter: Filter;
  doneRows: readonly TaskRow[] | null; doneCount: number; names: Names; quietOff: boolean;
}

/** The list the page draws, flat, so one virtual list holds it all. */
export function buildEntries(b: BuildIn): Entry[] {
  const out: Entry[] = [];
  const rows = sortRows(filterRows(b.rows, b.filter), b.sort);
  const taskLine = (t: TaskRow, prefix: string): Entry => ({ kind: "task", key: `${prefix}:${t.id}`, row: t });
  const push = (key: string, title: string, list: readonly TaskRow[], prefix = key): void => {
    if (list.length === 0) return;
    out.push({ kind: "head", key: `h:${key}`, title, count: list.length });
    for (const t of list) out.push(taskLine(t, prefix));
  };
  if (b.group !== "smart") {
    for (const g of groupRows(rows, b.group, b.names, b.now, b.offsetMin)) push(`g:${g.key}`, g.title, g.rows);
  } else if (b.scope === "mine") {
    // Needs you: every task whose next move is mine, each once, work handed to me included; the badge counts the same rows
    const needs = b.needs.filter((n) => n.handledBy === undefined && n.yourTurn === true);
    if (needs.length > 0 && !isFiltered(b.filter)) {
      out.push({ kind: "head", key: "h:needs", title: "Needs you", count: needs.length });
      for (const n of needs) out.push({ kind: "need", key: `n:${n.task.id}`, item: n });
    }
    const s = sectionsOf(rows, b.me, b.now, b.offsetMin, new Set(needs.map((n) => n.task.id)));
    push("now", "Now", s.now);
    push("next", "Next", s.next);
    if (s.quiet.length > 0 && !b.quietOff) out.push({ kind: "quiet", key: "quiet", rows: s.quiet });
    push("waiting", "Waiting on others", s.waiting);
  } else {
    const open = rows.filter((t) => isOpenState(t.state));
    push(b.scope, b.scope === "given" ? "Given by you" : b.scope === "project" ? "In this project" : b.scope === "snoozed" ? "Snoozed" : "Open", open);
  }
  if (rows.length === 0 && out.length === 0) out.push({ kind: "empty", key: "empty", text: isFiltered(b.filter) ? "No task matches." : b.scope === "mine" ? "Nothing on your list." : b.scope === "snoozed" ? "Nothing is snoozed." : "No tasks here yet." });
  out.push({ kind: "add", key: "add" });
  if (b.doneCount > 0 || b.doneRows !== null) {
    out.push({ kind: "done", key: "done", count: b.doneCount, open: b.doneRows !== null });
    if (b.doneRows) for (const t of filterRows(b.doneRows, b.filter)) out.push(taskLine(t, "d"));
  }
  return out;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A due date in the words a person uses, and whether it has passed. In a Space's zone with a person's own beside it when they differ (`title` carries both for hover); a plain number is a fixed offset (a private list, a test). */
export function dueLabel(due: number | undefined, now: number, z: number | Zones): { text: string; late: boolean; title?: string } {
  if (due === undefined) return { text: "", late: false };
  if (typeof z !== "number") {
    const days = dayIn(due, z.space) - dayIn(now, z.space);
    const text = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : days > 1 && days < 7 ? WEEKDAY[partsIn(due, z.space).dow]! : dateIn(due, z.space).replace(/^\w+ /, "");
    return { text, late: days < 0, title: titleOf(due, z) };
  }
  const start = dayStart(now, z);
  const days = Math.floor((dayStart(due, z) - start) / DAY);
  const d = new Date(due + z * 60_000);
  const text = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : days > 1 && days < 7 ? WEEKDAY[d.getUTCDay()]! : `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
  return { text, late: due < start };
}

export const KIND_TITLE: Record<string, string> = { work: "Work", approve: "Approve", review: "Review", answer: "Answer", unblock: "Unblock", signature: "Signature" };

/** How long ago, in one or two words: "12 min", "2 hours", "3 weeks". */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} ${d === 1 ? "day" : "days"}`;
  const w = Math.round(d / 7);
  return `${w} weeks`;
}

/** The people a board column or a task page shows for a task's baton: past, now, next. */
export function batonMarks(t: Pick<TaskRow, "state" | "reviewer" | "approver">): Array<"p" | "c" | ""> | null {
  if (!t.reviewer && !t.approver) return null;
  const steps = ["work", ...(t.reviewer ? ["review"] : []), ...(t.approver ? ["approve"] : []), "done"];
  const at = t.state === "in_review" ? steps.indexOf("review") : t.state === "awaiting_approval" ? steps.indexOf("approve") : t.state === "done" ? steps.length - 1 : 0;
  return steps.map((_, i) => (i < at ? "p" : i === at ? "c" : ""));
}

/** Timeline: the days a view shows and the place of a bar in them, as fractions of the width. */
export function barOf(t: Pick<TaskRow, "start" | "due" | "createdAt">, first: number, days: number): { left: number; width: number } | null {
  const end = t.due ?? t.start;
  if (end === undefined) return null;
  const start = Math.min(t.start ?? end, end);
  const a = Math.max(0, (start - first) / DAY), b = Math.min(days, (end - first) / DAY + 1);
  if (b <= 0 || a >= days) return null;
  return { left: a / days, width: Math.max(1 / days, (b - a) / days) };
}

/** Calendar: the six weeks around a month, Monday first, with what is due each day. */
export function monthCells(rows: readonly TaskRow[], month: { year: number; month: number }, offsetMin: number): Array<{ day: number; date: number; inMonth: boolean; rows: TaskRow[] }> {
  const first = Date.UTC(month.year, month.month, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => { const date = first + (i - lead) * DAY; const d = new Date(date); return { day: d.getUTCDate(), date, inMonth: d.getUTCMonth() === month.month, rows: [] as TaskRow[] }; });
  const start = cells[0]!.date;
  for (const t of rows) {
    if (t.due === undefined) continue;
    const at = Math.floor((t.due + offsetMin * 60_000 - start) / DAY);
    if (at >= 0 && at < 42) cells[at]!.rows.push(t);
  }
  return cells;
}
