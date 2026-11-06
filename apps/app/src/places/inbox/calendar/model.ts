// Calendar model: the pure part (spec 3.3, 2.18). Days and weeks in the person's day, the grid geometry (52 px an hour), snapping to 15 minutes for drag, move and resize, overlapping events laid
// out in equal columns per overlap group with long Block and Focus events as a quiet band behind them, busy stripes from availability, the Find a time panel's lines, and the rules for what an event's menu offers. No React, no clock of its own.
import type { CapMap } from "../../../../../../generated/types.ts";
import { dayOf } from "../sidebar/model.ts";

export type EventRow = CapMap["calendar.list_events"]["out"]["events"][number];
export type CalendarRow = CapMap["calendar.list_calendars"]["out"]["calendars"][number];
export type Busy = CapMap["calendar.availability"]["out"]["busy"][number];
export type Slot = CapMap["calendar.find_time"]["out"]["slots"][number];
export type Attendee = EventRow["attendees"][number];

export type Mode = "day" | "week" | "month";

export const MIN = 60_000;
/** A zone's offset from UTC, in minutes, as milliseconds: the one place the calendar turns an offset into a shift. */
const shiftMs = (offsetMin: number): number => offsetMin * MIN;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** Pixels an hour on the Day and Week grids; a 15 minute step is a quarter of it (16 px). A 30 minute event is 31 px: two lines of title. */
export const HH = 64;
export const STEP_MIN = 15;
export const STEP = STEP_MIN * MIN;

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const FULLWEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const FULLMONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

// ---------------------------------------------------------------- days

/** The start (midnight in the person's day) of the day an instant falls on. */
export function startOfDay(at: number, offsetMin: number): number {
  return dayOf(at, offsetMin) * DAY - shiftMs(offsetMin);
}

/** Calendar days stepped by whole days: a day is 24 hours here because the person's offset is fixed for the view. */
export const addDays = (day: number, n: number): number => day + n * DAY;

/** A local date from a day start. */
function parts(day: number, offsetMin: number): { y: number; m: number; d: number; wd: number } {
  const x = new Date(day + shiftMs(offsetMin));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay() };
}

/** Monday of the week the day is in. */
export function weekStart(day: number, offsetMin: number): number {
  const wd = parts(day, offsetMin).wd;
  return addDays(day, -((wd + 6) % 7));
}

export function monthStart(day: number, offsetMin: number): number {
  const p = parts(day, offsetMin);
  return Date.UTC(p.y, p.m, 1) - shiftMs(offsetMin);
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
  return Date.UTC(p.y, p.m + dir, 1) - shiftMs(offsetMin);
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
  const d = new Date(at + shiftMs(offsetMin));
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** 9:30 to 10:00 AM (the meridiem is named once when both ends share it). */
export function range(a: number, b: number, offsetMin: number): string {
  const s = clock(a, offsetMin), e = clock(b, offsetMin);
  const sm = s.slice(-2), em = e.slice(-2);
  return sm === em ? `${s.slice(0, -3)} to ${e}` : `${s} to ${e}`;
}

/** 11:30 to 12:00 (a list's time column): AM or PM only when it changes, else 11:30 AM to 1:00 PM. */
export function rangeShort(a: number, b: number, offsetMin: number): string {
  const s = clock(a, offsetMin), e = clock(b, offsetMin);
  return s.slice(-2) === e.slice(-2) ? `${s.slice(0, -3)} to ${e.slice(0, -3)}` : `${s} to ${e}`;
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
  const local = at + shiftMs(offsetMin);
  return Math.round(local / STEP) * STEP - shiftMs(offsetMin);
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

export interface Laid {
  e: EventRow;
  /** Side by side: events that start together (within 15 minutes) share the width; this is the place among them and `lanes` how many. */
  lane: number;
  lanes: number;
  /** Cascade level: a later start is drawn on top of the card below, 12 px further in (0 to 3). */
  level: number;
  /** A long background block (Block, Focus): drawn as a tinted band behind the day, taking no column. */
  band: boolean;
  /** Stacking order within the overlap group by start time (0 first): a later start sits above every earlier card, side by side or not. */
  rank?: number;
  /** Pixels of this card left above the next card drawn over it (unset when nothing covers it): a title or time line that would sit under that card is not drawn. */
  room?: number;
  /** Past three events in a group the first two show and this tile lists the rest. */
  more?: EventRow[];
}

/** Pixels each cascade level is drawn further in. */
export const CASCADE = 12;
const TOGETHER = 15 * MIN;

/** A long "Block", "Focus", "Busy" or "Hold" (two hours or more), or any event of seven hours or more, is a background band, not a column. */
export function isBand(e: EventRow): boolean {
  if (e.allDay) return false;
  const len = e.endsAt - e.startsAt;
  return len >= 7 * HOUR || (len >= 2 * HOUR && /^(block|focus|busy|hold|do not book)\b/i.test(e.title));
}

/** Overlapping events like a good calendar: events that start together share the width; a later start sits on top of the card below, a little further in, so every title keeps most of the column. Bands come first, behind. */
export function lanesOf(list: readonly EventRow[]): Laid[] {
  const out: Laid[] = list.filter(isBand).map((e) => ({ e, lane: 0, lanes: 1, level: 0, band: true }));
  const sorted = list.filter((e) => !isBand(e)).sort((a, b) => a.startsAt - b.startsAt || b.endsAt - a.endsAt);
  let group: EventRow[] = [];
  let end = 0;
  const flush = (): void => {
    const from = out.length;
    const keep = group.slice(0, group.length > 3 ? 2 : group.length), more = group.slice(keep.length);
    const subs: { at: number; end: number; es: EventRow[] }[] = [];
    for (const e of keep) {
      let g = subs.find((x) => Math.abs(e.startsAt - x.at) < TOGETHER);
      if (!g) { g = { at: e.startsAt, end: 0, es: [] }; subs.push(g); }
      g.es.push(e);
      g.end = Math.max(g.end, e.endsAt);
    }
    subs.forEach((g, i) => {
      const level = Math.min(3, subs.slice(0, i).filter((x) => x.end > g.at).length);
      g.es.forEach((e, k) => out.push({ e, lane: k, lanes: g.es.length, level, band: false }));
    });
    const mine = out.slice(from);
    [...mine].sort((a, b) => a.e.startsAt - b.e.startsAt || a.lane - b.lane).forEach((a, i) => { a.rank = i; });
    for (const a of mine) {
      const over = mine.filter((b) => b !== a && b.e.startsAt > a.e.startsAt && b.e.startsAt < a.e.endsAt).map((b) => offsetToY(b.e.startsAt - a.e.startsAt));
      if (over.length > 0) a.room = Math.min(...over);
    }
    if (more.length > 0) out.push({ e: more[0] as EventRow, lane: 0, lanes: 1, level: 0, band: false, more });
    group = [];
  };
  for (const e of sorted) {
    if (group.length > 0 && e.startsAt >= end) { flush(); end = 0; }
    group.push(e);
    end = Math.max(end, e.endsAt);
  }
  if (group.length > 0) flush();
  return out;
}

/** Padding above a card's text and the height of one line of it. */
export const TEXT_TOP = 1;
export const LINE = 14;

export interface Block {
  top: number; height: number; left: string; width: string; z: number;
  /** The height the text may take when a card is drawn over this one (clip there); unset when nothing covers it. */
  clip: number | undefined;
  /** Under 40 px. */
  one: boolean;
  /** How many lines the title may take before it is cut: one in a block under 30 px, else two. */
  lines: 1 | 2;
  /** The time line: none, the start only (a narrow column or a one-line block) or the whole range on its own line (45 minutes and up, alone in its width). */
  time: "none" | "start" | "range";
}

/** Where an event is drawn in its day's column. Titles wrap to two lines before they are cut; the time gets its own line only when there is room. */
export function blockOf(l: Laid, day: number): Block {
  const top = offsetToY(Math.max(0, l.e.startsAt - day));
  const height = Math.max(20, offsetToY(Math.min(l.e.endsAt, day + DAY) - Math.max(l.e.startsAt, day)) - 1);
  // a narrow lane (events that start together) shows its title on one line with an ellipsis and no time line, so no word is ever split
  const narrow = l.lanes > 1;
  // a covered card shows only the text that fits above the top of the card over it: lines that would be cut are not drawn
  const seen = Math.min(height, l.room ?? Infinity);
  const fit = Math.max(1, Math.floor((seen - TEXT_TOP) / LINE));
  const lines = narrow || height < 30 ? 1 : Math.min(2, fit);
  const time = narrow ? "none" : seen >= 44 ? "range" : height < 30 && l.room === undefined ? "start" : "none";
  const off = l.level * CASCADE;
  const clip = l.room === undefined ? undefined : Math.max(TEXT_TOP + LINE, l.room);
  return { top, height, clip, left: `calc(${off}px + ${l.lane} * (100% - ${off}px) / ${l.lanes} + 2px)`, width: `calc((100% - ${off}px) / ${l.lanes} - 4px)`, z: 2 + (l.rank ?? l.level), one: height < 40, lines, time };
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
  /** The video call Vyre makes with the event (Meet, Teams or Zoom through the connection), or none. */
  video?: "meet" | "teams" | "zoom" | "none";
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
    calendarId: d.calendarId, title: d.title.trim() || "New event", startsAt: d.startsAt, endsAt: d.endsAt, ...(attendees.length ? { attendees } : {}), ...(d.video && d.video !== "none" ? { video: d.video } : {}), idempotencyKey: key,
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

export interface AllDaySeg { e: EventRow; /** First and last day index it covers in the view. */ a: number; b: number; /** Its row in the lane. */ row: number }
export interface AllDayLane { segs: AllDaySeg[]; /** Per day index: how many are folded into the "+N". */ hidden: Record<number, number>; /** Rows to draw, the "+N" row included. */ rows: number }

/**
 * A provider's all-day event is a date, not an instant: the server keeps it as midnight UTC of that date to midnight UTC of the day after. The grid's days start at midnight in the
 * viewer's zone, so the same numbers would sit across two grid days anywhere but UTC (a Sunday event drawn as a Saturday to Sunday bar). This puts the event on its own date:
 * midnight in the viewer's zone. Timed events pass through. `allDayToWire` is the way back for a write.
 */
export function allDayLocal<T extends Pick<EventRow, "allDay" | "startsAt" | "endsAt">>(e: T, offsetMin: number): T {
  return e.allDay && offsetMin !== 0 ? { ...e, startsAt: e.startsAt - shiftMs(offsetMin), endsAt: e.endsAt - shiftMs(offsetMin) } : e;
}
export function allDayToWire<T extends Pick<EventRow, "allDay" | "startsAt" | "endsAt">>(e: T, offsetMin: number): T {
  return e.allDay && offsetMin !== 0 ? { ...e, startsAt: e.startsAt + shiftMs(offsetMin), endsAt: e.endsAt + shiftMs(offsetMin) } : e;
}

/** The all-day lane: one chip per event per day (a copy of the same title on the same days is one), a multi-day event is one bar across its days, and rows past `cap` fold into "+N" per day. */
export function allDayLane(events: readonly EventRow[], days: readonly number[], cap = 2): AllDayLane {
  const first = days[0] as number, last = (days[days.length - 1] as number) + DAY;
  const seen = new Set<string>(), segs: AllDaySeg[] = [];
  const list = events.filter((e) => e.status !== "canceled" && e.allDay && e.startsAt < last && e.endsAt > first).sort((x, y) => x.startsAt - y.startsAt || y.endsAt - x.endsAt);
  for (const e of list) {
    const ix: number[] = [];
    days.forEach((d, i) => { if (e.startsAt < d + DAY && e.endsAt > d) ix.push(i); });
    if (ix.length === 0) continue;
    const a = ix[0] as number, b = ix[ix.length - 1] as number, key = `${e.calendarId}|${e.title}|${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segs.push({ e, a, b, row: 0 });
  }
  const rows: AllDaySeg[][] = [];
  for (const sg of segs) {
    let r = 0;
    while (rows[r]?.some((x) => x.a <= sg.b && x.b >= sg.a)) r++;
    (rows[r] ??= []).push(sg);
    sg.row = r;
  }
  const over = rows.length > cap, hidden: Record<number, number> = {};
  if (over) for (const sg of segs) if (sg.row >= cap) for (let i = sg.a; i <= sg.b; i++) hidden[i] = (hidden[i] ?? 0) + 1;
  return { segs: segs.filter((x) => x.row < cap || !over), hidden, rows: over ? cap + 1 : rows.length };
}

/** A month cell shows this many events and then "+N more". */
export const MONTH_CAP = 3;

/** The events one month cell lists: all-day ones first (one per title), then the timed ones in order; background bands are left out. */
export function monthCell(events: readonly EventRow[], day: number): EventRow[] {
  return [...allDayLane(events, [day], 99).segs.map((x) => x.e), ...eventsOn(events, day, false).filter((e) => !isBand(e))];
}

/** The all-day events of each day, in the order of the days. */
export function allDayRows(events: readonly EventRow[], days: readonly number[]): EventRow[][] {
  return days.map((d) => eventsOn(events, d, true));
}

/** "Maya Chen, Omar Haddad" for a stripe's tooltip. */
export function whoLabel(who: readonly string[], names: ReadonlyMap<string, string>): string {
  return who.map((w) => names.get(w) ?? w).join(", ");
}

/** The hour the grid opens at: one hour above the current time when today is in the view (an early event never pulls it up to midnight); another week at 7:30, but not below its earliest timed event (half an hour of margin). */
export function openHour(todayInView: boolean, nowHour: number, firstHours: readonly number[]): number {
  if (todayInView) return Math.max(0, nowHour - 1);
  return Math.max(0, Math.min(7.5, (firstHours.length ? Math.min(...firstHours) : 24) - 0.5));
}
