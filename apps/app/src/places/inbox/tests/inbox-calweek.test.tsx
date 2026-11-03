// Calendar week polish: overlap groups in equal columns, long Block and Focus as a band behind, titles and time by the room there is, the all-day lane (one chip per event per day, a multi-day bar, "+N"),
// the month's three and "+N more", and the crowded sample week on screen. The model tests build rows by hand; the screen tests read the sample.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar, ME, TEAM, createCalendarSample } from "../calendar/index.ts";
import { DAY, HH, HOUR, MONTH_CAP, allDayLane, blockOf, eventsOn, isBand, lanesOf, monthCell } from "../calendar/model.ts";
import type { EventRow } from "../calendar/model.ts";
import { InboxDataProvider, InboxStateProvider } from "../sidebar/index.ts";

const D0 = Date.UTC(2025, 9, 22); // Wednesday 22 October 2025, midnight
const row = (id: string, title: string, a: number, b: number, o: Partial<EventRow> = {}): EventRow =>
  ({ id, calendarId: "cal_work", title, startsAt: D0 + a * HOUR, endsAt: D0 + b * HOUR, allDay: false, joinProvider: "none", attendees: [], recordIds: [], status: "confirmed", ...o });
const allDay = (id: string, title: string, from: number, days = 1, o: Partial<EventRow> = {}): EventRow => row(id, title, 0, 0, { allDay: true, startsAt: D0 + from * DAY, endsAt: D0 + (from + days) * DAY, ...o });

test("overlap: events that start together share the width, a later start sits on top 12 px further in, past three the first two show and a +N tile holds the rest", () => {
  const l = lanesOf([row("a", "NDA", 10, 10.5), row("b", "Meeting with Priya", 10, 10.5), row("c", "Hartwell intake", 10.25, 11), row("d", "Lunch", 12, 13)]);
  assert.deepEqual(l.map((x) => [x.e.id, x.lane, x.lanes, x.level]), [["a", 0, 2, 0], ["b", 1, 2, 0], ["c", 0, 1, 1], ["d", 0, 1, 0]]);
  assert.equal(blockOf(l[0]!, D0).width, "calc((100% - 0px) / 2 - 4px)");
  assert.equal(blockOf(l[2]!, D0).left, "calc(12px + 0 * (100% - 12px) / 1 + 2px)");
  assert.ok(blockOf(l[2]!, D0).z > blockOf(l[0]!, D0).z, "the later card is drawn on top");
  assert.equal(blockOf(l[3]!, D0).width, "calc((100% - 0px) / 1 - 4px)");
  const many = lanesOf([row("a", "A", 10, 11), row("b", "B", 10.25, 11), row("c", "C", 10.5, 11), row("d", "D", 10.75, 11), row("e", "E", 10.75, 11)]);
  assert.deepEqual(many.filter((x) => !x.more).map((x) => x.e.id), ["a", "b"], "the first two");
  assert.deepEqual(many.find((x) => x.more)!.more!.map((x) => x.id), ["c", "d", "e"], "and a tile for the other three");
});

test("background blocks: a long Block or Focus is a band behind the others and takes no column; a short one and a real meeting are not", () => {
  assert.equal(isBand(row("x", "Block", 9, 17)), true);
  assert.equal(isBand(row("x", "Focus time", 8.5, 12)), true);
  assert.equal(isBand(row("x", "Block 10:00 prep", 10, 12)), true);
  assert.equal(isBand(row("x", "Block", 10, 11)), false, "an hour of Block is a normal event");
  assert.equal(isBand(row("x", "Board offsite", 9, 17)), true, "any event of seven hours or more");
  assert.equal(isBand(row("x", "Board prep", 9, 11)), false);
  assert.equal(isBand(allDay("x", "Block", 0)), false);
  const l = lanesOf([row("blk", "Block", 9, 17), row("a", "Call A", 10, 11), row("b", "Call B", 10, 11)]);
  const band = l.find((x) => x.e.id === "blk")!;
  assert.equal(band.band, true);
  assert.deepEqual(l.filter((x) => !x.band).map((x) => [x.e.id, x.lane, x.lanes]), [["a", 0, 2], ["b", 1, 2]], "the two calls share the width; the band is not counted");
  assert.equal(l[0]!.band, true, "bands come first, drawn behind");
  assert.equal(blockOf(band, D0).top, 9 * HH);
});

test("titles and time: two lines before a cut, the time on its own line only when there is room", () => {
  const one = (o: EventRow, lanes = 1) => blockOf({ e: o, lane: 0, lanes, level: 0, band: false }, D0);
  const q = one(row("q", "Quick", 10, 10.25));
  assert.deepEqual([q.lines, q.time], [1, "start"], "15 minutes: one line, the start beside the title");
  const h = one(row("h", "Half", 10, 10.5));
  assert.deepEqual([h.lines, h.time], [2, "none"], "30 minutes: a title of two lines, no time line");
  assert.ok(h.height >= 30, "two lines of 14 px fit");
  const t = one(row("t", "Three quarters", 10, 10.75));
  assert.deepEqual([t.lines, t.time], [2, "range"], "45 minutes alone in its width: title and the whole range");
  const n = one(row("n", "Three quarters", 10, 10.75), 3);
  assert.deepEqual([n.lines, n.time], [1, "none"], "side by side in a narrow lane: one line with an ellipsis, no time line, so no word is split");
  const c = one(row("c", "Short", 10, 10.25), 2);
  assert.equal(c.time, "none", "a narrow one-line block has no room for a time");
});

test("all-day lane: one chip per event per day, a multi-day event is one bar, more than two rows fold into +N per day", () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => D0 - 2 * DAY + i * DAY);
  const evs = [allDay("u1", "MLA Updates", -2), allDay("u2", "MLA Updates", -1), allDay("u2b", "MLA Updates", -1), allDay("u3", "MLA Updates", 0), allDay("u3b", "MLA Updates", 0), allDay("sum", "Summit", 0, 3), allDay("bd", "Birthday", 0), allDay("car", "Car", 0)];
  const lane = allDayLane(evs, days);
  const sums = lane.segs.filter((x) => x.e.title === "Summit");
  assert.equal(sums.length, 1, "a multi-day event is one bar");
  assert.deepEqual([sums[0]!.a, sums[0]!.b], [2, 4], "across its three days");
  assert.equal(lane.segs.filter((x) => x.e.title === "MLA Updates").length, 3, "a copy of the same title on the same day is one chip");
  assert.equal(lane.rows, 3, "two rows and the +N row");
  assert.ok(lane.segs.every((x) => x.row < 2));
  assert.deepEqual(lane.hidden, { 2: 2 }, "Wednesday has the bar, the updates chip, the birthday and the car: two folded");
  const calm = allDayLane([allDay("a", "Holiday", 1), allDay("b", "Out", 1)], days);
  assert.deepEqual([calm.rows, calm.hidden], [2, {}], "two rows are drawn whole");
  assert.equal(allDayLane([], days).rows, 0);
  const cancelled = allDayLane([allDay("c", "Gone", 1, 1, { status: "canceled" })], days);
  assert.equal(cancelled.segs.length, 0);
});

test("month: three events, then +N more; all-day first one per title; a background band is not listed", () => {
  const day = D0;
  const evs = [allDay("a", "MLA Updates", 0), allDay("a2", "MLA Updates", 0), row("blk", "Block", 9, 17), row("m1", "One", 10, 11), row("m2", "Two", 11, 12), row("m3", "Three", 12, 13)];
  const cell = monthCell(evs, day);
  assert.deepEqual(cell.map((e) => e.id), ["a", "m1", "m2", "m3"]);
  assert.equal(MONTH_CAP, 3);
  assert.equal(eventsOn(evs, day, false).length, 4, "the day itself still has the band");
});

test("screen: the crowded week shows the band behind, the 10:00 group in three columns, one chip per day and a +N under the all-day rows", () => {
  const sm = createCalendarSample();
  const out = renderToStaticMarkup(<InboxDataProvider value={sm.data}><InboxStateProvider initial={{}}><Calendar me={ME} team={TEAM} /></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
  const has = (n: string): boolean => out.includes(n);
  assert.ok(has('data-testid="band:e_x_block"') && has('data-testid="band:e_x_focus"'), "Block and Focus are bands");
  assert.ok(!has('data-testid="event:e_x_block"'), "and not event blocks");
  for (const id of ["e_x_nda", "e_x_priya", "e_x_hart"]) {
    const i = out.indexOf(`data-testid="event:${id}"`);
    assert.ok(i >= 0, id);
    assert.ok(/width:calc\(\(100% - \d+px\) \/ [12] - 4px\)/.test(out.slice(Math.max(0, i - 600), i)), `${id} gets most of the column`);
  }
  assert.ok(has('data-testid="cal-allday"'), "the all-day lane");
  assert.ok(has('data-testid="allday:e_x_summit"'), "the summit is one bar");
  assert.ok(has('data-testid="cal-now-label"'), "the current time pill");
  assert.ok(/data-testid="admore:\d+"/.test(out), "a +N chip when the lane is crowded");
  const chips = (out.match(/data-testid="allday:e_x_up\w+"/g) ?? []).map((c) => c.slice(20, -1));
  assert.ok(!chips.includes("e_x_up2b") && !chips.includes("e_x_up3b"), "a copy on the same day is not drawn twice");
  assert.deepEqual(chips, ["e_x_up1", "e_x_up2", "e_x_up3"], "Monday, Tuesday and Wednesday show their one chip; Thursday's rows are full (the summit bar, Lena out), so its updates fold into the +N");
  assert.ok(!out.includes(String.fromCharCode(0x2014)), "no em dash");
});

test("month: a wide window keeps the event rows and has no phone agenda (the phone dots and agenda are shot, CALWEEK_01-month phone)", () => {
  const sm = createCalendarSample();
  const html = (w: number): string => renderToStaticMarkup(<InboxDataProvider value={sm.data}><InboxStateProvider initial={{}}><Calendar me={ME} team={TEAM} initial={{ mode: "month" }} /></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "") + String(w);
  const wide = html(1440);
  assert.ok(wide.includes('data-testid="cal-month"') && !wide.includes('data-testid="cal-agenda"'), "a wide window keeps the event rows and has no agenda");
});

test("a card keeps no time line under the card drawn over it", () => {
  const l = lanesOf([row("p", "Pipeline review", 10, 10.75), row("q", "Quick sync", 10.5, 11)]);
  const p = l.find((x) => x.e.id === "p")!;
  assert.equal(p.room, HH / 2, "the next card starts half an hour below");
  assert.deepEqual([blockOf(p, D0).lines, blockOf(p, D0).time], [2, "none"], "so the range would sit under it and is left out");
  assert.equal(l.find((x) => x.e.id === "q")!.room, undefined, "the card on top has all its room");
});
