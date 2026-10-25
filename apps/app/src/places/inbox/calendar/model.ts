// Calendar model: the pure part (spec 3.3, 2.18). Days and weeks in the person's day, the grid geometry (52 px an hour), snapping to 15 minutes for drag, move and resize, overlapping events laid
// out in lanes, busy stripes from availability, the Find a time panel's lines, and the rules for what an event's menu offers. No React, no clock of its own.
import type { CapMap } from "../../../../../../generated/types.ts";
import { dayOf } from "../sidebar/model.ts";

export type EventRow = CapMap["calendar.list_events"]["out"]["events"][number];
export type CalendarRow = CapMap["calendar.list_calendars"]["out"]["calendars"][number];
export type Busy = CapMap["calendar.availability"]["out"]["busy"][number];
export type Slot = CapMap["calendar.find_time"]["out"]["slots"][number];
export type Attendee = EventRow["attendees"][number];

export type Mode = "day" | "week" | "month";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** Pixels an hour on the Day and Week grids; a 15 minute step is a quarter of it. */
export const HH = 52;
export const STEP_MIN = 15;
export const STEP = STEP_MIN * MIN;

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const FULLWEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const FULLMONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

// ---------------------------------------------------------------- days

/** The start (midnight in the person's day) of the day an instant falls on. */
export function startOfDay(at: number, offsetMin: number): number {
  return dayOf(at, offsetMin) * DAY - offsetMin * MIN;
}

/** Calendar days stepped by whole days: a day is 24 hours here because the person's offset is fixed for the view. */
export const addDays = (day: number, n: number): number => day + n * DAY;

/** A local date from a day start. */
function parts(day: number, offsetMin: number): { y: number; m: number; d: number; wd: number } {
  const x = new Date(day + offsetMin * MIN);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay() };
}

/** Monday of the week the day is in. */
export function weekStart(day: number, offsetMin: number): number {
  const wd = parts(day, offsetMin).wd;
  return addDays(day, -((wd + 6) % 7));
}

export function monthStart(day: number, offsetMin: number): number {
  const p = parts(day, offsetMin);
  return Date.UTC(p.y, p.m, 1) - offsetMin * MIN;
}

/** The days the view draws: one for Day, seven for Week (Monday first), whole weeks covering the month for Month. */
export function viewDays(mode: Mode, day: number, offsetMin: number): number[] {
  if (mode === "day") return [day];
  if (mode === "week") { const w = weekStart(day, offsetMin); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(w, i)); }
  const first = monthStart(day, offsetMin);
  const p = parts(first, offsetMin);
  const len = new Date(Date.UTC(p.y, p.m + 1, 0)).getUTCDate();
  const lead = (p.wd + 6) % 7;
  const rows = Math.ceil((lead + len) / 7);
  const start = addDays(first, -lead);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
}

/** What the queries read: from the first day's start to the day after the last. */
export function viewRange(mode: Mode, day: number, offsetMin: number): { from: number; to: number } {
  const days = viewDays(mode, day, offsetMin);
  return { from: days[0] as number, to: addDays(days[days.length - 1] as number, 1) };
}

/** Previous or next view: a day, a week or a month. */
export function stepView(mode: Mode, day: number, dir: 1 | -1, offsetMin: number): number {
  if (mode === "day") return addDays(day, dir);
  if (mode === "week") return addDays(day, 7 * dir);
  const p = parts(day, offsetMin);
  return Date.UTC(p.y, p.m + dir, 1) - offsetMin * MIN;
}

export function viewTitle(mode: Mode, day: number, offsetMin: number): string {
  const p = parts(day, offsetMin);
  if (mode === "month") return `${FULLMONTH[p.m]} ${p.y}`;
  if (mode === "day") return `${FULLWEEK[p.wd]}, ${MONTH[p.m]} ${p.d}, ${p.y}`;
  const days = viewDays("week", day, offsetMin);
  const a = parts(days[0] as number, offsetMin), b = parts(days[6] as number, offsetMin);
  return a.m === b.m ? `${MONTH[a.m]} ${a.d} to ${b.d}, ${b.y}` : `${MONTH[a.m]} ${a.d} to ${MONTH[b.m]} ${b.d}, ${b.y}`;
}

export const weekdayShort = (day: number, offsetMin: number): string => WEEK[parts(day, offsetMin).wd] as string;
export const dateOf = (day: number, offsetMin: number): number => parts(day, offsetMin).d;
export const monthOf = (day: number, offsetMin: number): number => parts(day, offsetMin).m;

/** 9:30 AM */
export function clock(at: number, offsetMin: number): string {
  const d = new Date(at + offsetMin * MIN);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** 9:30 to 10:00 AM (the meridiem is named once when both ends share it). */
export function range(a: number, b: number, offsetMin: number): string {
  const s = clock(a, offsetMin), e = clock(b, offsetMin);
  const sm = s.slice(-2), em = e.slice(-2);
  return sm === em ? `${s.slice(0, -3)} to ${e}` : `${s} to ${e}`;
}

/** Mon, Oct 27 */
export function dayText(at: number, offsetMin: number): string {
  const p = parts(startOfDay(at, offsetMin), offsetMin);
  return `${WEEK[p.wd]}, ${MONTH[p.m]} ${p.d}`;
}

export function slotText(s: Slot, offsetMin: number): string {
  return `${dayText(s.startsAt, offsetMin)} · ${range(s.startsAt, s.endsAt, offsetMin)}`;
}

export function lengthText(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const LENGTHS: readonly number[] = [15, 30, 45, 60, 90, 120];

// ---------------------------------------------------------------- the grid and snapping

/** Milliseconds from the day's start to a y on the grid, snapped to the nearest 15 minutes and kept inside the day. */
export function yToOffset(y: number): number {
  const raw = (y / HH) * HOUR;
  return Math.max(0, Math.min(DAY, Math.round(raw / STEP) * STEP));
}

export const offsetToY = (ms: number): number => (ms / HOUR) * HH;

/** Snap an instant to the nearest 15 minute step (clock time in the person's day). */
export function snap(at: number, offsetMin: number): number {
  const local = at + offsetMin * MIN;
  return Math.round(local / STEP) * STEP - offsetMin * MIN;
}

export interface Span { startsAt: number; endsAt: number }

/** A drag on an empty column from y0 to y1: start and end on 15 minute steps, at least one step long, either direction. */
export function dragCreate(day: number, y0: number, y1: number): Span {
  const a = yToOffset(Math.min(y0, y1)), b = yToOffset(Math.max(y0, y1));
  const end = Math.max(b, a + STEP);
  return { startsAt: day + a, endsAt: day + Math.min(DAY, end) };
}

/** A double click adds an hour at the clicked step. */
export function clickCreate(day: number, y: number): Span {
  const a = Math.min(yToOffset(y), DAY - HOUR);
  return { startsAt: day + a, endsAt: day + a + HOUR };
}

/** Move: the event keeps its length; its start follows the pointer by `dy` pixels and its day by `dDays`, on 15 minute steps. */
export function dragMove(e: Span, dy: number, dDays: number, offsetMin: number): Span {
  const len = e.endsAt - e.startsAt;
  const startsAt = snap(e.startsAt + (dy / HH) * HOUR, offsetMin) + dDays * DAY;
  return { startsAt, endsAt: startsAt + len };
}

/** Resize the bottom edge: the end follows the pointer, never before 15 minutes after the start. */
export function dragResize(e: Span, dy: number, offsetMin: number): Span {
  const end = snap(e.endsAt + (dy / HH) * HOUR, offsetMin);
  return { startsAt: e.startsAt, endsAt: Math.max(e.startsAt + STEP, end) };
}

export const minutes = (s: Span): number => Math.round((s.endsAt - s.startsAt) / MIN);

// ---------------------------------------------------------------- lanes

export interface Laid { e: EventRow; lane: number; lanes: number }

/** Overlapping events side by side: each gets a lane and the number of lanes in its cluster. */
export function lanesOf(list: readonly EventRow[]): Laid[] {
  const out: Laid[] = [];
  const sorted = [...list].sort((a, b) => a.startsAt - b.startsAt || b.endsAt - a.endsAt);
  let group: { e: EventRow; lane: number }[] = [];
  let end = 0;
  const flush = (): void => {
    const n = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) out.push({ e: g.e, lane: g.lane, lanes: n });
    group = [];
  };
  for (const e of sorted) {
    if (group.length > 0 && e.startsAt >= end) { flush(); end = 0; }
    let lane = 0;
    while (group.some((g) => g.lane === lane && g.e.endsAt > e.startsAt)) lane++;
    group.push({ e, lane });
    end = Math.max(end, e.endsAt);
  }
  if (group.length > 0) flush();
  return out;
}

export interface Block { top: number; height: number; left: string; width: string; one: boolean }

/** Where an event is drawn in its day's column. A block under 40 px is one line. */
export function blockOf(l: Laid, day: number): Block {
  const top = offsetToY(Math.max(0, l.e.startsAt - day));
  const height = Math.max(20, offsetToY(Math.min(l.e.endsAt, day + DAY) - Math.max(l.e.startsAt, day)) - 1);
  return { top, height, left: `calc(${(l.lane * 100) / l.lanes}% + 2px)`, width: `calc(${100 / l.lanes}% - 4px)`, one: height < 40 };
}

/** The events of one day: timed ones in order, all-day ones apart. */
export function eventsOn(events: readonly EventRow[], day: number, allDay: boolean): EventRow[] {
  return events.filter((e) => e.status !== "canceled" && e.allDay === allDay && e.startsAt < day + DAY && e.endsAt > day).sort((a, b) => a.startsAt - b.startsAt);
}

// ---------------------------------------------------------------- availability stripes

export interface Stripe { top: number; height: number; who: string[]; alpha: number }

/** Busy runs of one day for the chosen people: consecutive quarter hours with the same people busy become one stripe. Shade deepens with the number busy. */
export function stripesOf(busy: readonly Busy[], people: readonly string[], day: number): Stripe[] {
  const slots: string[][] = [];
  for (let i = 0; i < 96; i++) {
    const a = day + i * STEP, b = a + STEP;
    slots.push(people.filter((p) => busy.some((x) => x.who === p && x.startsAt < b && x.endsAt > a)));
  }
  const out: Stripe[] = [];
  let i = 0;
  while (i < 96) {
    const who = slots[i] as string[];
    if (who.length === 0) { i++; continue; }
    const key = who.join();
    let j = i;
    while (j + 1 < 96 && (slots[j + 1] as string[]).join() === key) j++;
    out.push({ top: (i * HH) / 4, height: ((j - i + 1) * HH) / 4, who, alpha: Math.min(14, 4 + who.length * 4) });
    i = j + 1;
  }
  return out;
}

/** The line under the header while people are chosen: who is shaded and the first time all are free. */
export function availabilityLine(people: readonly string[], names: ReadonlyMap<string, string>, first: Slot | undefined, minutes: number, offsetMin: number): { who: string; free: string } {
  const who = people.map((p) => (names.get(p) ?? p).split(/\s+/)[0] as string).join(", ");
  return { who: `${who} busy times shaded`, free: first ? `Everyone free ${slotText(first, offsetMin)}` : `No shared time for ${lengthText(minutes)} in two weeks` };
}

// ---------------------------------------------------------------- the draft (a new event)

export interface Draft {
  startsAt: number;
  endsAt: number;
  title: string;
  calendarId: string;
  people: string[];
  /** The event this draft was copied from (Duplicate), so its own busy time does not count against it. */
  from?: string;
}

export function newDraft(span: Span, calendarId: string, people: readonly string[] = [], title = ""): Draft {
  return { ...span, title, calendarId, people: [...people] };
}

export function setLength(d: Draft, minutes: number): Draft {
  return { ...d, endsAt: d.startsAt + minutes * MIN };
}

export function atSlot(d: Draft, s: Slot): Draft {
  return { ...d, startsAt: s.startsAt, endsAt: s.endsAt };
}

/** Who among the people on the draft is busy during it, and whether the person is. */
export function conflicts(d: Draft, busy: readonly Busy[], me: string): { busy: string[]; mine: boolean } {
  const hit = (who: string): boolean => busy.some((x) => x.who === who && x.startsAt < d.endsAt && x.endsAt > d.startsAt);
  return { busy: d.people.filter((p) => p !== me && hit(p)), mine: hit(me) };
}

/** The "free or busy" sentence of the new event card. */
export function freeLine(d: Draft, c: { busy: string[]; mine: boolean }, names: ReadonlyMap<string, string>, unknown: readonly string[], me: string): string {
  const others = d.people.filter((p) => p !== me);
  if (others.length === 0) return "Add people to see when they are free.";
  const first = (p: string): string => (names.get(p) ?? p).split(/\s+/)[0] as string;
  const parts: string[] = [];
  const known = others.filter((p) => !unknown.includes(p));
  if (known.length > 0) parts.push(c.busy.length > 0 ? `${c.busy.map(first).join(", ")} ${c.busy.length > 1 ? "are" : "is"} busy then.` : known.length > 1 ? "Everyone on the team is free." : `${first(known[0] as string)} is free.`);
  if (unknown.length > 0) parts.push(`${unknown.map(first).join(", ")} ${unknown.length > 1 ? "have" : "has"} not shared a calendar.`);
  if (c.mine) parts.push("You have something at this time.");
  return parts.join(" ");
}

export function createInput(d: Draft, key: string): CapMap["calendar.create_event"]["in"] {
  const attendees = d.people.map((email) => ({ email }));
  return {
    calendarId: d.calendarId, title: d.title.trim() || "New event", startsAt: d.startsAt, endsAt: d.endsAt, ...(attendees.length ? { attendees, joinProvider: "zoom" as const } : {}), idempotencyKey: key,
  };
}

// ---------------------------------------------------------------- the event's menu

export interface MenuFacts { joinUrl: boolean; record: boolean; conversation: boolean; calendars: readonly { id: string; title: string; current: boolean }[] }

export function menuFacts(e: EventRow, calendars: readonly CalendarRow[]): MenuFacts {
  return {
    joinUrl: e.joinUrl !== undefined && e.joinProvider !== "none",
    record: e.recordIds.length > 0,
    conversation: e.attendees.some((a) => a.contactId !== undefined),
    calendars: calendars.filter((c) => c.state !== "error").map((c) => ({ id: c.id, title: c.title, current: c.id === e.calendarId })),
  };
}

// ---------------------------------------------------------------- reading an event

export function eventLine(e: EventRow, offsetMin: number): string {
  return e.allDay ? "All day" : range(e.startsAt, e.endsAt, offsetMin);
}

export const isPast = (e: EventRow, now: number): boolean => e.endsAt < now;

/** The calendars the view shows: the sidebar hides some by id. */
export function visibleCalendarIds(calendars: readonly CalendarRow[], hidden: readonly string[]): string[] {
  return calendars.filter((c) => !hidden.includes(c.id)).map((c) => c.id);
}

export type Action =
  | { type: "mode"; mode: Mode }
  | { type: "go"; day: number }
  | { type: "step"; dir: 1 | -1; offsetMin: number }
  | { type: "today"; today: number }
  | { type: "people"; email: string }
  | { type: "clearPeople" }
  | { type: "select"; id: string | null }
  | { type: "draft"; draft: Draft | null };

export interface CalState { mode: Mode; day: number; people: readonly string[]; selected: string | null; draft: Draft | null }

export function initialCal(day: number, mode: Mode = "week"): CalState {
  return { mode, day, people: [], selected: null, draft: null };
}

export function calReduce(s: CalState, a: Action): CalState {
  switch (a.type) {
    case "mode": return { ...s, mode: a.mode, draft: null };
    case "go": return { ...s, day: a.day, draft: s.mode === "month" ? s.draft : null };
    case "step": return { ...s, day: stepView(s.mode, s.day, a.dir, a.offsetMin), draft: s.mode === "month" ? s.draft : null };
    case "today": return { ...s, day: a.today };
    case "people": return { ...s, people: s.people.includes(a.email) ? s.people.filter((p) => p !== a.email) : [...s.people, a.email] };
    case "clearPeople": return { ...s, people: [] };
    case "select": return { ...s, selected: a.id };
    case "draft": return { ...s, draft: a.draft };
  }
}

// ---------------------------------------------------------------- small helpers for the screen (kept here so the screen builds its lists with loops)

export function nameMap(team: readonly { email: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of team) out.set(t.email, t.name);
  return out;
}

export function directoryOf(team: readonly { email: string; name: string }[]): { name: string; email: string; kind: "team"; sub: string }[] {
  return team.map((t) => ({ name: t.name, email: t.email, kind: "team" as const, sub: "Team" }));
}

/** The all-day events of each day, in the order of the days. */
export function allDayRows(events: readonly EventRow[], days: readonly number[]): EventRow[][] {
  return days.map((d) => eventsOn(events, d, true));
}

/** "Maya Chen, Omar Haddad" for a stripe's tooltip. */
export function whoLabel(who: readonly string[], names: ReadonlyMap<string, string>): string {
  return who.map((w) => names.get(w) ?? w).join(", ");
}
