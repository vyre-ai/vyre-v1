// Needs you, with no renderer (spec 3.2 flow 7, 2.8): one list in the queue's order as the prototype lists it (ruling 45), a quiet kind filter, and the request on the right with what, why,
// source, one primary action and Send back. The rules live here so the tests drive them directly.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Item = CapMap["tasks.needs_you"]["out"]["items"][number];
export type Task = Item["task"];
export type Action = Task["actions"][number];
export type Kind = Task["kind"];
export type Reason = Item["reason"];

export interface Clock { now: number; offsetMin: number }
const DAY = 86_400_000;
const two = (n: number): string => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const local = (ts: number, c: Clock): Date => new Date(ts + c.offsetMin * 60_000);
const dayNo = (ts: number, c: Clock): number => Math.floor((ts + c.offsetMin * 60_000) / DAY);

/** "just now", "5 min ago", "3 h ago", "Yesterday", else "12 Oct". */
export function agoLabel(ts: number, c: Clock): string {
  const mins = Math.floor((c.now - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const gap = dayNo(c.now, c) - dayNo(ts, c);
  if (gap <= 0) return `${Math.floor(mins / 60)} h ago`;
  if (gap === 1) return "Yesterday";
  const d = local(ts, c);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Today 17:00", "Tomorrow 09:00", "Mon 09:00", else "12 Nov". */
export function dueLabel(ts: number, c: Clock): string {
  const d = local(ts, c);
  const hm = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  const gap = dayNo(ts, c) - dayNo(c.now, c);
  if (gap < 0) return `${-gap === 1 ? "Yesterday" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`} ${hm}`;
  if (gap === 0) return `Today ${hm}`;
  if (gap === 1) return `Tomorrow ${hm}`;
  if (gap < 7) return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${hm}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/* ---------- the filter ---------- */

export type KindFilter = "all" | "approve" | "review" | "answer" | "unblock";
export const FILTERS: readonly { key: KindFilter; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "approve", label: "To approve" },
  { key: "review", label: "To review" },
  { key: "answer", label: "To answer" },
  { key: "unblock", label: "Blocked" },
];

export function matchesFilter(t: Task, f: KindFilter): boolean {
  // A withdrawn request is not something to do, so no filter (not even Everything) counts it; it has its own section.
  if (t.state === "canceled") return false;
  return f === "all" || t.kind === f;
}

/** Counts per filter over the whole list, for the filter menu's right-hand column. */
export function filterCounts(items: readonly Item[]): Record<KindFilter, number> {
  const out: Record<KindFilter, number> = { all: items.filter((i) => i.task.state !== "canceled").length, approve: 0, review: 0, answer: 0, unblock: 0 };
  for (const i of items) {
    if (i.task.state === "canceled") continue;
    if (i.task.kind === "approve" || i.task.kind === "review" || i.task.kind === "answer" || i.task.kind === "unblock") out[i.task.kind]++;
  }
  return out;
}

/* ---------- order ---------- */

/**
 * One list, in the order the queue gives it (the prototype's list is the queue in the order requests arrived; ruling 45: the prototype wins). Urgency is carried by the
 * row's own words (Blocked, Due today) rather than by moving rows. Withdrawn requests go last. No groups.
 */
export function sortItems(items: readonly Item[]): Item[] {
  return [...items.filter((i) => i.task.state !== "canceled"), ...items.filter((i) => i.task.state === "canceled")];
}

/** The id to select after `id` leaves the list: the next row, else the one before, else none. */
export function nextSelection(list: readonly Item[], id: string): string | null {
  const i = list.findIndex((x) => x.task.id === id);
  if (i < 0) return list[0]?.task.id ?? null;
  return list[i + 1]?.task.id ?? list[i - 1]?.task.id ?? null;
}

export function stepSelection(list: readonly Item[], id: string | null, step: 1 | -1): string | null {
  if (list.length === 0) return null;
  const i = id === null ? -1 : list.findIndex((x) => x.task.id === id);
  if (i < 0) return list[step === 1 ? 0 : list.length - 1]?.task.id ?? null;
  return list[Math.min(list.length - 1, Math.max(0, i + step))]?.task.id ?? null;
}

/* ---------- words ---------- */

export function kindWord(t: Task): string {
  if (t.blocked && t.kind === "unblock") return "Blocked";
  switch (t.kind) {
    case "approve": return "Approve";
    case "review": return "Review";
    case "answer": return "Answer";
    case "unblock": return "Blocked";
    case "signature": return "Sign";
    case "work": return "Task";
  }
}

/** The heading above a request's title. */
export function needsLine(t: Task): string {
  switch (t.kind) {
    case "approve": return "Needs your approval";
    case "review": return "Needs your review";
    case "answer": return "Needs your answer";
    case "unblock": return "Needs unblocking";
    case "signature": return "Waiting on a signature";
    case "work": return "Needs your attention";
  }
}

export function stateWord(s: Task["state"]): string {
  switch (s) {
    case "todo": return "To do";
    case "doing": return "Doing";
    case "in_review": return "In review";
    case "awaiting_approval": return "Awaiting approval";
    case "done": return "Done";
    case "canceled": return "Canceled";
  }
}

export function reasonWord(r: Reason, due: number | undefined, c: Clock): string {
  switch (r) {
    case "blocking": return "Blocking other work";
    case "overdue": return due !== undefined ? `Overdue since ${dueLabel(due, c)}` : "Overdue";
    case "due_today": return due !== undefined ? `Due ${dueLabel(due, c)}` : "Due today";
    case "ready": return "";
  }
}

/** The second line of a row, as the prototype writes it: the verb you act with (Approve, Review, Unblock), who made it, then what it is (its summary, else why it is urgent). */
export function rowNote(i: Item, who: string, c: Clock): string {
  const t = i.task;
  const verb = t.kind === "unblock" ? "Unblock" : kindWord(t);
  const tail = t.summary || reasonWord(i.reason, t.due, c);
  return [verb, who, tail].filter((x) => x !== "").join(" · ");
}

/** The time a request arrived, as the prototype shows it: the clock time today ("9:12"), "Yesterday", else the date. */
export function arrivedLabel(ts: number, c: Clock): string {
  const gap = dayNo(c.now, c) - dayNo(ts, c);
  if (gap <= 0) { const d = local(ts, c); return `${d.getUTCHours()}:${two(d.getUTCMinutes())}`; }
  return agoLabel(ts, c);
}

/** The role you act in on this task, for the meta line. */
export function roleWord(t: Task): string {
  if (t.kind === "approve") return "Approver";
  if (t.kind === "review") return "Reviewer";
  if (t.kind === "answer") return "Answer";
  if (t.kind === "unblock") return "Unblock";
  return "Assigned";
}

/* ---------- actions ---------- */

export const SEND_BACK = "send_back";

export function isSendBack(a: Action): boolean {
  return a.key === SEND_BACK || a.label.toLowerCase() === "send back";
}

export interface Actions {
  /** the one filled button: the first action that is not Send back */
  primary: Action | null;
  sendBack: Action | null;
  /** everything else, in the ... menu */
  more: Action[];
}

export function splitActions(t: Task): Actions {
  const sendBack = t.actions.find(isSendBack) ?? null;
  const rest = t.actions.filter((a) => !isSendBack(a));
  return { primary: rest[0] ?? null, sendBack, more: rest.slice(1) };
}

/** Whether pressing an action asks for a note first. */
export function needsNote(a: Action): boolean {
  return a.note === "required" || isSendBack(a);
}

/** The placeholder in the note field. */
export function notePrompt(a: Action, who: string): string {
  return isSendBack(a) ? `Tell ${who} what to change…` : a.note === "required" ? "Add a note…" : "Add a note (optional)…";
}

/** The line shown after acting: the source continues at once. */
export function doneLine(t: Task, a: Action, who: string): string {
  if (isSendBack(a)) return `Sent back to ${who} with your note`;
  if (t.kind === "approve") return "Approved. It continues now.";
  if (t.kind === "review") return "Marked reviewed.";
  if (t.kind === "answer") return `Sent your answer to ${who}`;
  if (t.kind === "unblock") return `${who} carries on`;
  return `${a.label}. Done.`;
}

/** Who can act now: a role or group request is taken by the first person, and others see who has it. */
export interface Holder { kind: "free" | "taken" | "handled"; by?: string }
export function holder(i: Item, me: string): Holder {
  if (i.handledBy !== undefined) return { kind: "handled", by: i.handledBy };
  const t = i.task;
  if (t.takenBy !== undefined && t.takenBy !== me) return { kind: "taken", by: t.takenBy };
  return { kind: "free" };
}

/** A request addressed to a group or role needs "Take" before it can be acted on, unless already taken by you. */
export function needsTake(t: Task, me: string): boolean {
  return (t.assigned.kind === "group" || t.assigned.kind === "role") && t.takenBy !== me;
}

export interface SnoozeChoice { key: "later" | "tomorrow" | "week"; label: string }
export const SNOOZES: readonly SnoozeChoice[] = [
  { key: "later", label: "Later today" },
  { key: "tomorrow", label: "Tomorrow morning" },
  { key: "week", label: "Next week" },
];

/** When a snooze returns: later today = 4 hours on, tomorrow = 09:00 the next day, next week = 09:00 seven days on (the person's clock). */
export function snoozeUntil(key: SnoozeChoice["key"], c: Clock): number {
  if (key === "later") return c.now + 4 * 3_600_000;
  const startOfDay = (Math.floor((c.now + c.offsetMin * 60_000) / DAY)) * DAY - c.offsetMin * 60_000;
  return startOfDay + (key === "tomorrow" ? 1 : 7) * DAY + 9 * 3_600_000;
}

/* ---------- blocks ---------- */

export type BlockView =
  | { type: "table"; columns: string[]; rows: string[][]; more?: number; tags?: string[] }
  | { type: "pairs"; pairs: [string, string][] }
  | { type: "quote"; lines: string[]; source?: string }
  | { type: "line"; text: string };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

/** A task's content block as something the detail can draw. Tables, key/values and excerpts get their own look; anything else is one quiet line with its type. */
export function blockView(b: Task["blocks"][number]): BlockView {
  const d = b.data;
  if (b.type === "table" && isRec(d) && Array.isArray(d.columns) && Array.isArray(d.rows)) {
    const more = typeof d.more === "number" ? d.more : undefined;
    // `tags` is one short tag per row ("new rate"), drawn in amber beside the first cell; an empty string means none.
    const tags = Array.isArray(d.tags) ? strs(d.tags) : [];
    return { type: "table", columns: strs(d.columns), rows: d.rows.map((r) => strs(r)), ...(more !== undefined && more > 0 ? { more } : {}), ...(tags.some((t) => t !== "") ? { tags } : {}) };
  }
  if ((b.type === "checklist" || b.type === "form") && isRec(d) && Array.isArray(d.items)) {
    return { type: "pairs", pairs: d.items.map((x): [string, string] => (isRec(x) ? [str(x.label ?? x.name), str(x.value ?? (x.done === true ? "Done" : "To do"))] : [str(x), ""])) };
  }
  if (b.type === "pairs" && isRec(d) && Array.isArray(d.pairs)) {
    return { type: "pairs", pairs: d.pairs.map((x): [string, string] => (Array.isArray(x) ? [str(x[0]), str(x[1])] : ["", ""])) };
  }
  if ((b.type === "document" || b.type === "excerpt") && isRec(d)) {
    const lines = strs(d.lines);
    const source = str(d.file ?? d.name);
    return { type: "quote", lines: lines.length > 0 ? lines : [str(d.text)].filter((x) => x !== ""), ...(source ? { source } : {}) };
  }
  const label = isRec(d) ? str(d.title ?? d.name ?? d.caption) : "";
  return { type: "line", text: label ? `${b.type.replaceAll("_", " ")}: ${label}` : b.type.replaceAll("_", " ") };
}

export function sourceWord(s: NonNullable<Task["source"]>): string {
  switch (s.kind) {
    case "chat": return "a chat";
    case "run": return "a run";
    case "gate": return "a gate";
    case "journey": return "a Journey";
    case "manual": return "a person";
  }
}

/* ---------- withdrawn requests ---------- */

/** A request its source took back (the fee changed, the draft is being redone): nothing to do, kept in its own section until dismissed. */
export function isWithdrawn(i: Item): boolean {
  return i.task.state === "canceled";
}

/** The live list, then the withdrawn ones. Withdrawn requests never count toward Needs you and never take the selection first. */
export function splitWithdrawn(items: readonly Item[]): { live: Item[]; withdrawn: Item[] } {
  return { live: items.filter((i) => !isWithdrawn(i)), withdrawn: items.filter(isWithdrawn) };
}

/* ---------- participants ---------- */

export interface Participant { id: string; kind: string; role: string }

/** Who is on a request: its requester, the person or agent it is assigned to, the reviewer and approver, and whoever follows it. Each appears once with the roles they hold. */
export function participants(t: Task, kindOf: (id: string) => string): Participant[] {
  const order: string[] = [];
  const roles = new Map<string, { kind: string; roles: string[] }>();
  const add = (id: string, kind: string, role: string): void => {
    const cur = roles.get(id);
    if (cur) { if (!cur.roles.includes(role)) cur.roles.push(role); return; }
    order.push(id);
    roles.set(id, { kind, roles: [role] });
  };
  add(t.createdBy, kindOf(t.createdBy), "Requester");
  add(t.assigned.id, t.assigned.kind, "Assigned");
  if (t.reviewer) add(t.reviewer.id, t.reviewer.kind, "Reviewer");
  if (t.approver) add(t.approver.id, t.approver.kind, "Approver");
  for (const f of t.followers) add(f, kindOf(f), "Follows");
  return order.map((id) => ({ id, kind: roles.get(id)!.kind, role: roles.get(id)!.roles.join(", ") }));
}

/** How many people (not agents) are on the request: the number on the participants button. */
export function peopleCount(list: readonly Participant[]): number {
  return list.filter((p) => p.kind === "person").length;
}
