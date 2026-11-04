// Calendar week polish: overlap groups in equal columns, long Block and Focus as a band behind, titles and time by the room there is, the all-day lane (one chip per event per day, a multi-day bar, "+N"),
// the month's three and "+N more", and the crowded sample week on screen. The model tests build rows by hand; the screen tests read the sample.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar, ME, TEAM, createCalendarSample } from "../calendar/index.ts";
import { daysTo } from "../calendar/sample.ts";
import { DAY, HH, HOUR, LINE, MONTH_CAP, TEXT_TOP, allDayLane, blockOf, rangeShort, eventsOn, isBand, lanesOf, monthCell } from "../calendar/model.ts";
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

test("no text of a covered card sits under the card over it, and the strip beside a cascaded card holds no text", () => {
  const day = [row("p", "Pipeline review", 9, 9.75), row("q", "Quick sync", 9.5, 10), row("n", "NDA walk-through: Alvarez Design", 10, 10.5), row("m", "Meeting with Priya", 10, 10.5), row("h", "Hartwell intake", 10.25, 11), row("c", "Cole Dental walkthrough", 14, 14.75), row("t", "Intake triage", 14.25, 14.75), row("z", "Z", 16, 16.25), row("y", "Y", 16.1, 16.5)];
  const l = lanesOf(day);
  let covered = 0;
  for (const a of l) {
    if (a.band || a.more) continue;
    const b = blockOf(a, D0);
    if (a.room === undefined) { assert.equal(b.clip, undefined, `${a.e.title} is not covered`); continue; }
    covered++;
    const bottom = TEXT_TOP + b.lines * LINE + (b.time === "none" ? 0 : LINE);
    assert.ok(bottom <= Math.max(a.room, TEXT_TOP + LINE), `${a.e.title}: its text ends at ${bottom} px, above the ${a.room} px where the next card starts`);
    assert.ok(b.clip !== undefined && b.clip >= TEXT_TOP + LINE, "the text is clipped there");
  }
  assert.ok(covered >= 3, "the crowded day has covered cards");
});

test("agenda times: a fixed short form, AM or PM only when it changes", () => {
  const at = (h: number, m = 0): number => D0 + h * HOUR + m * 60_000;
  assert.equal(rangeShort(at(9, 30), at(10), 0), "9:30 to 10:00", "same half of the day: no AM or PM");
  assert.equal(rangeShort(at(14), at(15, 30), 0), "2:00 to 3:30");
  assert.equal(rangeShort(at(11, 30), at(12), 0), "11:30 AM to 12:00 PM", "it changes at noon, so both are named");
});

test("sample: shifted by days, today is the real today and the crowd falls Monday to Thursday of that week", () => {
  const now = Date.UTC(2026, 10, 4, 15), n = daysTo(now);
  const sm = createCalendarSample(undefined, { shiftDays: n });
  assert.equal(Math.floor(sm.data.clock().now / DAY), Math.floor(now / DAY), "the sample's day is the real day");
  const e = sm.events().find((x) => x.id === "e_x_nda")!;
  assert.equal(new Date(e.startsAt).getUTCDay(), 3, "the 10:00 pile-up is on Wednesday of that week");
  createCalendarSample();
});

test("stacking: a later start sits above every earlier card in the group, side by side or not", () => {
  const l = lanesOf([row("n", "NDA", 10, 10.5), row("m", "Meeting with Priya", 10, 10.5), row("h", "Hartwell intake", 10.25, 11)]);
  const z = (id: string): number => blockOf(l.find((x) => x.e.id === id)!, D0).z;
  assert.ok(z("h") > z("m") && z("h") > z("n"), "Hartwell's title is never drawn over by the Meeting card's colour bar");
  assert.ok(z("m") > z("n"), "and the second lane sits above the first");
  const d = lanesOf([row("a", "A", 9, 10), row("b", "B", 9.5, 10.5), row("c", "C", 9.75, 11)]);
  const zs = d.map((x) => blockOf(x, D0).z);
  assert.deepEqual(zs, [...zs].sort((p, q) => p - q), "z follows the start time");
});

test("a band's label is left out when a card covers its top, and the band stays", () => {
  const sm = createCalendarSample(), sd = renderToStaticMarkup(<InboxDataProvider value={sm.data}><InboxStateProvider initial={{}}><Calendar me={ME} team={TEAM} /></InboxStateProvider></InboxDataProvider>).replaceAll("<!-- -->", "");
  assert.ok(sd.includes('data-testid="band:e_x_prep"'), "the 10:00 prep band is drawn");
  assert.ok(!sd.includes('data-testid="band-label:e_x_prep"'), "its label would sit under three cards, so it is left out");
  assert.ok(sd.includes('data-testid="band-label:e_x_focus"'), "Focus has a free top and keeps its label");
});
