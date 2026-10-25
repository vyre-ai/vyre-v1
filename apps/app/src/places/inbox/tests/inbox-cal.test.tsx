// Inbox > Calendar (spec 3.3, 2.18): Day, Week and Month; drag to create, move and resize on 15 minute steps; availability stripes; the new event card; Find a time; the event menu with Undo on delete.
// The drag arithmetic is pure (calendar/model.ts) and the writes go through the capabilities, so both are tested without a pointer; the screen is drawn from the sample Space.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { Calendar, CalendarLoading, ME, TEAM, availabilityLine, blockOf, busyOf, calReduce, clickCreate, conflicts, createCalendarSample, createEvent, deleteEvent, dragCreate, dragMove, dragResize, duplicateEvent } from "../calendar/index.ts";
import { calendarMenuEntries, dayMenuEntries, eventMenuEntries, findTime, initialCal, lanesOf, lengthMenuEntries, menuFacts, minutes, moveToCalendar, newDraft, peopleMenuEntries, restoreEvent, setTimes, slotText, snap, startOfDay, stepView, stripesOf, viewDays, viewRange, viewTitle, yToOffset } from "../calendar/index.ts";
import { DAY, HH, HOUR, MIN, freeLine } from "../calendar/model.ts";
import type { CalendarSample } from "../calendar/index.ts";
import type { CalendarRow, EventRow } from "../calendar/model.ts";
import { harbor, northwind, SAMPLE_NOW } from "../contactlist/sample.ts";
import type { SampleSpace } from "../contactlist/sample.ts";
import { InboxDataProvider, InboxStateProvider } from "../sidebar/index.ts";
import type { InboxState } from "../sidebar/index.ts";
import { isHead, isItem, isSeparator } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuItem } from "../../../../../../ui/src/Menu/props.ts";

const TODAY = startOfDay(SAMPLE_NOW, 0); // Friday 24 October 2025
const MON27 = TODAY + 3 * DAY;
const MAYA = "maya@northwind.example";
const OMAR = "omar@northwind.example";

const render = (s: CalendarSample, props: Partial<Parameters<typeof Calendar>[0]> = {}, state: Partial<InboxState> = {}): string =>
  renderToStaticMarkup(<InboxDataProvider value={s.data}><InboxStateProvider initial={state}><Calendar me={ME} team={TEAM} {...props} /></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
const cal = (props: Partial<Parameters<typeof Calendar>[0]> = {}, state: Partial<InboxState> = {}, space: SampleSpace = northwind, o: { online?: boolean } = {}): { out: string; s: CalendarSample } => {
  const s = createCalendarSample(space, o);
  return { s, out: render(s, props, state) };
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const events = (s: CalendarSample): EventRow[] => s.replica.run("calendar.list_events", { from: TODAY - 14 * DAY, to: TODAY + 21 * DAY })!.data.events;
const calendars = (s: CalendarSample): CalendarRow[] => s.replica.run("calendar.list_calendars", {})!.data.calendars;
const byId = (s: CalendarSample, id: string): EventRow => {
  const e = s.events().find((x) => x.id === id);
  assert.ok(e, id);
  return e;
};
const items = (e: readonly unknown[]): MenuItem[] => (e as Parameters<typeof isItem>[0][]).filter(isItem);

test("screen: Week is the default, Monday first, with the range in the title, today marked and the events in their columns", () => {
  const { out } = cal();
  assert.ok(has(out, 'data-testid="calendar"') && has(out, "Oct 20 to 26, 2025"));
  for (let i = 0; i < 7; i++) assert.ok(has(out, `data-testid="dayhead:${TODAY - 4 * DAY + i * DAY}"`), `day ${i}`);
  assert.ok(has(out, 'data-testid="cal-now"'), "the now line sits in today's column");
  for (const id of ["e_lease_call", "e_planning", "e_invoices", "e_intake", "standup_0", "e_dinner"]) assert.ok(has(out, `data-testid="event:${id}"`), id);
  assert.ok(has(out, 'data-testid="allday:e_ooo"'), "an all-day event sits in the header of its day");
  assert.ok(!has(out, 'data-testid="event:e_ooo"'), "and not in the hour grid");
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("screen: an event sits at its start time (52 px an hour) and overlapping events share the column", () => {
  const { out } = cal();
  const at = (id: string): string => { const i = out.indexOf(`data-testid="event:${id}"`); assert.ok(i >= 0, id); return out.slice(Math.max(0, i - 400), i + 40); };
  assert.ok(at("e_lease_call").includes("top:572px"), "11:00 is 11 hours down the grid");
  assert.ok(at("e_planning").includes("width:calc(50% - 4px)") && at("e_invoices").includes("width:calc(50% - 4px)"), "14:00 and 14:30 split the column");
  const lane = lanesOf(events(createCalendarSample()).filter((e) => e.id === "e_planning" || e.id === "e_invoices"));
  assert.deepEqual(lane.map((l) => [l.e.id, l.lane, l.lanes]), [["e_planning", 0, 2], ["e_invoices", 1, 2]]);
  assert.ok(has(out, "Lease call with Elena") && has(out, "11:00 to 11:45 AM"), "a taller event shows its time under the title");
});

test("screen: Day, Week and Month are a header choice with the current one selected, and titles read like the prototype's", () => {
  const w = cal().out;
  assert.ok(has(w, 'data-testid="cal-mode-week"') && has(w, 'aria-selected="true"'));
  const d = cal({ initial: { mode: "day" } }).out;
  assert.ok(has(d, "Friday, Oct 24, 2025") && !has(d, 'data-testid="dayhead:' + (TODAY - DAY) + '"'));
  const m = cal({ initial: { mode: "month" } }).out;
  assert.ok(has(m, "October 2025") && has(m, 'data-testid="cal-month"'));
  const cells = [...m.matchAll(/data-testid="cell:(\d+)"/g)];
  assert.equal(cells.length, 35, "five whole weeks cover October 2025");
  assert.ok(has(m, 'data-testid="more:' + TODAY + '"') && has(m, "2 more"), "Friday has five events: three show and the rest fold into a count");
});

test("screen: calendars hidden in the sidebar are not drawn", () => {
  const all = cal().out;
  const some = cal({}, { hiddenCalendars: ["cal_ms"] }).out;
  assert.ok(has(all, 'data-testid="event:e_invoices"') && has(all, 'data-testid="event:e_spring"'));
  assert.ok(!has(some, 'data-testid="event:e_invoices"') && !has(some, 'data-testid="event:e_spring"') && has(some, 'data-testid="event:e_planning"'));
});

test("screen: choosing people shades when they are busy, with the line under the header", () => {
  const { out } = cal({ initial: { people: [MAYA] } });
  assert.ok(has(out, 'data-testid="cal-avail-bar"') && has(out, "busy times shaded") && has(out, "Maya"));
  // Maya's standup (9:30) and her 10:00 block run on into one stripe from 9:30 to 11:00
  assert.ok(has(out, `data-testid="stripe:${TODAY}:${9.5 * HH}"`), "one stripe from 9:30");
  assert.ok(has(out, 'data-testid="cal-find"') && has(out, 'data-testid="cal-clear"'));
  assert.ok(!has(cal().out, 'data-testid="cal-avail-bar"'), "no people, no bar");
  assert.ok(has(cal().out, 'aria-label="Show when people are free"'));
});

test("screen: the new event card has the title, when, length, people, the free line, the calendar, Find a time, Cancel and Add", () => {
  const draft = newDraft({ startsAt: MON27 + 10 * HOUR, endsAt: MON27 + 10.5 * HOUR }, "cal_work", [MAYA]);
  const { out } = cal({ initial: { day: MON27, draft } });
  for (const id of ["cal-card", "cal-card-title", "cal-card-when", "cal-card-length", "cal-card-people", "cal-card-free", "cal-card-calendar", "cal-card-find", "cal-card-cancel", "cal-card-add"]) assert.ok(has(out, `data-testid="${id}"`) || has(out, `${id}`), id);
  assert.ok(has(out, "Mon, Oct 27 · 10:00 to 10:30 AM") && has(out, "30 min") && has(out, "Work Google"));
  assert.ok(has(out, 'data-testid="cal-ghost"'), "the event is outlined on the grid while the card is open");
  assert.ok(has(out, "Maya is busy then."), "the free line names who is busy at that time");
  const blank = cal({ initial: { day: MON27, draft: newDraft({ startsAt: MON27 + 9 * HOUR, endsAt: MON27 + 10 * HOUR }, "cal_work") } }).out;
  assert.ok(has(blank, "Add people to see when they are free."));
});

test("screen: offline the saved calendar still reads; the loading frame holds the header and an hour grid", () => {
  const { out } = cal({}, {}, northwind, { online: false });
  assert.ok(has(out, "Offline, showing your saved copy") && has(out, "Lease call with Elena"));
  const l = renderToStaticMarkup(<CalendarLoading />);
  assert.ok(has(l, 'data-testid="calendar-loading"') && has(l, 'aria-label="Loading"'));
  assert.ok(has(renderToStaticMarkup(<Calendar me={ME} team={TEAM} />), 'data-testid="calendar-loading"'), "before the shell gives the Inbox its data");
});

test("screen: the Harbor Studio space has its own events", () => {
  const { out } = cal({}, {}, harbor);
  assert.ok(has(out, "Logo review with Kai") && has(out, "Studio day") && !has(out, "Lease call with Elena"));
});

// ------------------------------------------------------------------ the drag arithmetic

test("snapping: y positions land on 15 minute steps (13 px is a quarter hour), clamped to the day", () => {
  assert.equal(yToOffset(0), 0);
  assert.equal(yToOffset(6), 0, "under half a step rounds down");
  assert.equal(yToOffset(7), 15 * MIN, "past half a step rounds up");
  assert.equal(yToOffset(13), 15 * MIN);
  assert.equal(yToOffset(20), 30 * MIN);
  assert.equal(yToOffset(HH * 24 + 50), DAY, "never past midnight");
  assert.equal(yToOffset(-30), 0);
  for (let y = 0; y < HH * 24; y += 3) assert.equal(yToOffset(y) % (15 * MIN), 0);
  const off = 330; // UTC+5:30
  const t = Date.UTC(2025, 9, 24, 10, 7);
  assert.equal(((snap(t, off) + off * MIN) % (15 * MIN)), 0, "steps follow the person's clock, not UTC");
});

test("drag to create: start and end on 15 minute steps, at least one step long, either direction, an hour on a double click", () => {
  const d = TODAY;
  assert.deepEqual(dragCreate(d, 130, 195), { startsAt: d + 150 * MIN, endsAt: d + 225 * MIN }, "2:30 to 3:45 AM");
  assert.deepEqual(dragCreate(d, 195, 130), dragCreate(d, 130, 195), "dragging up gives the same event");
  assert.equal(minutes(dragCreate(d, 100, 101)), 15, "a tiny drag is one step");
  assert.deepEqual(clickCreate(d, 9 * HH), { startsAt: d + 9 * HOUR, endsAt: d + 10 * HOUR });
  assert.equal(clickCreate(d, 23.9 * HH).endsAt, d + DAY, "an hour near midnight stays inside the day");
  for (const [a, b] of [[3, 777], [301, 305], [999, 1100]] as const) { const r = dragCreate(d, a, b); assert.equal((r.startsAt - d) % (15 * MIN), 0); assert.equal((r.endsAt - d) % (15 * MIN), 0); }
});

test("drag to move and resize: only the times change, on 15 minute steps; a move can change the day; the end never passes the start", () => {
  const e = { startsAt: TODAY + 10 * HOUR, endsAt: TODAY + 11 * HOUR };
  assert.deepEqual(dragMove(e, 26, 0, 0), { startsAt: TODAY + 10.5 * HOUR, endsAt: TODAY + 11.5 * HOUR }, "26 px is half an hour");
  assert.deepEqual(dragMove(e, 7, 0, 0), { startsAt: TODAY + 10.25 * HOUR, endsAt: TODAY + 11.25 * HOUR }, "7 px rounds to a quarter hour");
  assert.deepEqual(dragMove(e, 0, 1, 0), { startsAt: TODAY + DAY + 10 * HOUR, endsAt: TODAY + DAY + 11 * HOUR }, "one column right is the next day");
  assert.equal(minutes(dragMove(e, 91, 2, 0)), 60, "a move keeps the length");
  assert.deepEqual(dragResize(e, 13, 0), { startsAt: e.startsAt, endsAt: TODAY + 11.25 * HOUR });
  assert.deepEqual(dragResize(e, -500, 0), { startsAt: e.startsAt, endsAt: e.startsAt + 15 * MIN }, "never shorter than a step");
  assert.equal(dragResize(e, 40, 0).startsAt, e.startsAt, "resizing leaves the start alone");
});

test("a drag ends in calendar.update_event with the snapped times, and the grid shows them", async () => {
  const s = createCalendarSample();
  const e = byId(s, "e_planning");
  const span = dragMove(e, 26, 0, 0);
  await setTimes(s.data, e.id, span);
  assert.deepEqual(s.writes.at(-1), { cap: "calendar.update_event", input: { eventId: "e_planning", startsAt: span.startsAt, endsAt: span.endsAt } });
  const now = byId(s, "e_planning");
  assert.equal(now.startsAt, TODAY + 14.5 * HOUR);
  assert.equal((now.startsAt - TODAY) % (15 * MIN), 0);
  const r = dragResize(now, 26, 0);
  await setTimes(s.data, now.id, r);
  assert.equal(byId(s, "e_planning").endsAt, TODAY + 16 * HOUR);
  assert.ok(has(render(s), 'data-testid="event:e_planning"'));
});

// ------------------------------------------------------------------ dates and ranges

test("ranges and titles: Week runs Monday to Sunday, Month covers whole weeks, stepping moves a day, a week or a month", () => {
  assert.deepEqual(viewDays("week", TODAY, 0).map((d) => (d - TODAY) / DAY), [-4, -3, -2, -1, 0, 1, 2]);
  assert.equal(viewDays("month", TODAY, 0).length, 35);
  assert.equal(viewDays("month", TODAY, 0)[0], TODAY - 25 * DAY, "the grid starts on the Monday before the 1st");
  assert.deepEqual(viewRange("day", TODAY, 0), { from: TODAY, to: TODAY + DAY });
  assert.equal(stepView("day", TODAY, 1, 0), TODAY + DAY);
  assert.equal(stepView("week", TODAY, -1, 0), TODAY - 7 * DAY);
  assert.equal(stepView("month", TODAY, 1, 0), Date.UTC(2025, 10, 1));
  assert.equal(viewTitle("week", TODAY, 0), "Oct 20 to 26, 2025");
  assert.equal(viewTitle("week", TODAY + 7 * DAY, 0), "Oct 27 to Nov 2, 2025", "a week across two months names both");
  assert.equal(viewTitle("day", TODAY, 0), "Friday, Oct 24, 2025");
  assert.equal(viewTitle("month", TODAY, 0), "October 2025");
  const s0 = initialCal(TODAY);
  assert.equal(calReduce(s0, { type: "step", dir: 1, offsetMin: 0 }).day, TODAY + 7 * DAY);
  assert.equal(calReduce(calReduce(s0, { type: "step", dir: 1, offsetMin: 0 }), { type: "today", today: TODAY }).day, TODAY);
  assert.deepEqual(calReduce(calReduce(s0, { type: "people", email: MAYA }), { type: "people", email: MAYA }).people, [], "choosing a person twice clears them");
  assert.equal(calReduce({ ...s0, draft: newDraft({ startsAt: 1, endsAt: 2 }, "c") }, { type: "mode", mode: "day" }).draft, null, "changing the view drops a draft");
});

// ------------------------------------------------------------------ availability and Find a time

test("stripes: consecutive quarter hours with the same people busy become one stripe; more people shade deeper", () => {
  const busy = busyOf([MAYA, OMAR], TODAY, TODAY + DAY, createCalendarSample().events());
  const one = stripesOf(busy, [MAYA], TODAY);
  assert.deepEqual(one.map((x) => [x.top, x.height]), [[9.5 * HH, 1.5 * HH], [14 * HH, 1.5 * HH]], "Maya: 9:30 to 11:00 and 14:00 to 15:30");
  const both = stripesOf(busy, [MAYA, OMAR], TODAY);
  const overlap = both.find((x) => x.top === 14 * HH);
  assert.ok(overlap && overlap.who.length === 2 && overlap.height === 1.5 * HH, "14:00 to 15:30 both are busy");
  assert.ok(overlap.alpha > (both.find((x) => x.who.length === 1)?.alpha ?? 99), "two people shade deeper than one");
  assert.deepEqual(stripesOf(busy, [MAYA], TODAY - 6 * DAY), [], "a Sunday has nothing");
});

test("Find a time: the next free slots for everyone, inside working hours, never on top of anyone's busy time", async () => {
  const s = createCalendarSample();
  const slots = await findTime(s.data, [MAYA], 30, MON27, MON27 + 14 * DAY, 3);
  assert.deepEqual(slots.map((x) => slotText(x, 0)), ["Mon, Oct 27 · 9:00 to 9:30 AM", "Mon, Oct 27 · 11:30 AM to 12:00 PM", "Tue, Oct 28 · 9:00 to 9:30 AM"]);
  const busy = busyOf([MAYA, ME], MON27, MON27 + 14 * DAY, s.events());
  for (const sl of slots) assert.ok(!busy.some((b) => b.startsAt < sl.endsAt && b.endsAt > sl.startsAt), "free for Maya and for you");
  assert.deepEqual(s.writes.at(-1)?.cap, "calendar.find_time");
  assert.equal(findTimeInput(s).durationMinutes, 30);
  const none = await findTime(s.data, [MAYA, OMAR, "lena@northwind.example"], 8 * 60, MON27, MON27 + 14 * DAY, 3);
  assert.deepEqual(none, [], "a day-long meeting has no slot");
});
const findTimeInput = (s: CalendarSample): { durationMinutes: number } => s.writes.at(-1)!.input as { durationMinutes: number };

test("the availability line and the card's free line say who is busy and when everyone is free", () => {
  const names = new Map(TEAM.map((t) => [t.email, t.name]));
  const line = availabilityLine([MAYA, OMAR], names, { startsAt: MON27 + 9 * HOUR, endsAt: MON27 + 9.5 * HOUR }, 30, 0);
  assert.deepEqual(line, { who: "Maya, Omar busy times shaded", free: "Everyone free Mon, Oct 27 · 9:00 to 9:30 AM" });
  assert.equal(availabilityLine([MAYA], names, undefined, 60, 0).free, "No shared time for 1 hour in two weeks");
  const s = createCalendarSample();
  const busy = busyOf([MAYA, ME], MON27, MON27 + DAY, s.events());
  const d = newDraft({ startsAt: MON27 + 10.25 * HOUR, endsAt: MON27 + 10.75 * HOUR }, "cal_work", [MAYA, OMAR]);
  const c = conflicts(d, busy, ME);
  assert.deepEqual(c, { busy: [MAYA], mine: true }, "Maya is busy; you have the 10:30 intake");
  assert.equal(freeLine(d, c, names, [], ME), "Maya is busy then. You have something at this time.");
  assert.equal(freeLine({ ...d, people: [MAYA, "elena@example.test"] }, { busy: [], mine: false }, names, ["elena@example.test"], ME), "Maya is free. elena@example.test has not shared a calendar.");
});

// ------------------------------------------------------------------ writes

test("Add: calendar.create_event with the title, times, calendar, people and an idempotency key; the event is in the list at once", async () => {
  const s = createCalendarSample();
  const d = { ...newDraft({ startsAt: MON27 + 13 * HOUR, endsAt: MON27 + 13.5 * HOUR }, "cal_work", [MAYA]), title: "Plan the move" };
  const e = await createEvent(s.data, d, "key-1");
  assert.deepEqual(s.writes.at(-1), { cap: "calendar.create_event", input: { calendarId: "cal_work", title: "Plan the move", startsAt: d.startsAt, endsAt: d.endsAt, attendees: [{ email: MAYA }], joinProvider: "zoom", idempotencyKey: "key-1" } });
  assert.ok(events(s).some((x) => x.id === e.id && x.title === "Plan the move"));
  const blank = await createEvent(s.data, newDraft({ startsAt: MON27 + 15 * HOUR, endsAt: MON27 + 16 * HOUR }, "cal_pers"), "key-2");
  assert.equal(blank.title, "New event", "an untitled event is named New event");
  assert.equal((s.writes.at(-1)!.input as { attendees?: unknown }).attendees, undefined, "no people, no invitations");
});

test("Delete then Undo: calendar.delete_event takes it off the grid and calendar.restore_event puts it back; Duplicate and Move to a calendar", async () => {
  const s = createCalendarSample();
  await deleteEvent(s.data, "e_dinner");
  assert.ok(!events(s).some((e) => e.id === "e_dinner"));
  await restoreEvent(s.data, "e_dinner");
  assert.ok(events(s).some((e) => e.id === "e_dinner"));
  const copy = await duplicateEvent(s.data, byId(s, "e_dinner"), "key-3");
  assert.notEqual(copy.id, "e_dinner");
  assert.deepEqual([copy.title, copy.startsAt, copy.calendarId], ["Dinner with Grace", byId(s, "e_dinner").startsAt, "cal_pers"]);
  await moveToCalendar(s.data, "e_dinner", "cal_work");
  assert.equal(byId(s, "e_dinner").calendarId, "cal_work");
  assert.deepEqual(s.writes.map((w) => w.cap), ["calendar.delete_event", "calendar.restore_event", "calendar.create_event", "calendar.update_event"]);
});

// ------------------------------------------------------------------ menus

test("the event menu: Open, Join, Open Record, Open Conversation, Move to a calendar, Duplicate, Delete; Join, record and conversation appear only when the event has them", () => {
  const s = createCalendarSample();
  const picked: string[] = [];
  const h = {
    open: () => void picked.push("open"), join: () => void picked.push("join"), openRecord: () => void picked.push("record"), openConversation: () => void picked.push("conversation"),
    moveTo: (id: string) => void picked.push(`move:${id}`), duplicate: () => void picked.push("duplicate"), remove: () => void picked.push("delete"),
  };
  const rich = eventMenuEntries(menuFacts(byId(s, "e_lease_call"), calendars(s)), h);
  assert.deepEqual(items(rich).map((x) => x.label), ["Open", "Join", "Open Record", "Open Conversation", "Work Google", "Microsoft", "Personal", "Duplicate", "Delete"]);
  assert.ok(rich.some(isSeparator) && rich.some((x) => isHead(x) && x.head === "Move to a calendar"));
  assert.deepEqual(items(rich).filter((x) => x.checked).map((x) => x.label), ["Work Google"], "the event's own calendar is checked");
  assert.equal(items(rich).at(-1)?.danger, true, "Delete is marked destructive");
  for (const it of items(rich)) it.onSelect?.();
  assert.deepEqual(picked, ["open", "join", "record", "conversation", "move:cal_ms", "move:cal_pers", "duplicate", "delete"], "picking the current calendar does nothing");
  const plain = items(eventMenuEntries(menuFacts(byId(s, "e_dentist"), calendars(s)), h)).map((x) => x.label);
  assert.deepEqual(plain, ["Open", "Work Google", "Microsoft", "Personal", "Duplicate", "Delete"]);
});

test("the card's pickers and the header's people menu carry checkmarks; a day's menu offers New Event Here", () => {
  const s = createCalendarSample();
  const got: string[] = [];
  assert.deepEqual(items(lengthMenuEntries(30, (m) => void got.push(`len:${m}`))).map((x) => [x.label, x.checked === true]), [["15 min", false], ["30 min", true], ["45 min", false], ["1 hour", false], ["1 h 30 min", false], ["2 hours", false]]);
  const cm = items(calendarMenuEntries(calendars(s), "cal_ms", (id) => void got.push(`cal:${id}`)));
  assert.deepEqual(cm.map((x) => [x.label, x.checked === true]), [["Work Google", false], ["Microsoft", true], ["Personal", false]]);
  cm[2]!.onSelect?.();
  const pm = peopleMenuEntries(TEAM, [MAYA], ME, { toggle: (e) => void got.push(`p:${e}`), clear: () => void got.push("clear") });
  const people = items(pm);
  assert.deepEqual(people.map((x) => [x.label, x.checked === true]), [["Maya Chen", true], ["Omar Haddad", false], ["Lena Ortiz", false], ["Clear", false]], "you are not in your own list; Clear appears once someone is chosen");
  people[1]!.onSelect?.();
  people[3]!.onSelect?.();
  assert.equal(items(peopleMenuEntries(TEAM, [], ME, { toggle: () => undefined, clear: () => undefined })).some((x) => x.label === "Clear"), false);
  assert.deepEqual(got, ["cal:cal_pers", `p:${OMAR}`, "clear"]);
  const dm = items(dayMenuEntries({ newHere: () => void got.push("new"), goDay: () => void got.push("day") }));
  assert.deepEqual(dm.map((x) => x.label), ["New Event Here", "Open Day"]);
});

test("blocks: a short event is one line, a long one shows its time; lanes split the width", () => {
  const s = createCalendarSample();
  const stand = lanesOf([byId(s, "standup_0")])[0]!;
  assert.equal(blockOf(stand, TODAY).one, true, "30 minutes is under 40 px: one line");
  assert.equal(blockOf(stand, TODAY).top, 9.5 * HH);
  const long = lanesOf([byId(s, "e_spring")])[0]!;
  assert.equal(blockOf(long, TODAY - 2 * DAY).one, false);
  assert.equal(blockOf(long, TODAY - 2 * DAY).height, 1.5 * HH - 1);
});
