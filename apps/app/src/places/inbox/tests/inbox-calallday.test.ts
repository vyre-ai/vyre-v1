// All-day events from a provider are dates (midnight UTC to midnight UTC); the grid's days start at midnight in the viewer's zone. And the event pane says "not there any more" only for a read that says so.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, MIN, allDayLane, allDayLocal, allDayToWire, openHour, viewDays } from "../calendar/model.ts";
import type { EventRow } from "../calendar/model.ts";
import { goneError, whenLine } from "../calendar/eventpane/model.ts";

const ev = (title: string, startsAt: number, endsAt: number, allDay: boolean): EventRow =>
  ({ id: `cev_${title}`, calendarId: "cld_a", title, startsAt, endsAt, allDay, joinProvider: "none", attendees: [], recordIds: [], status: "confirmed" }) as EventRow;

test("an all-day event sits on its own date in any zone, not across two days", () => {
  for (const off of [-480, -300, 0, 300, 330, 600]) {
    const sunday = Date.UTC(2026, 10, 8);   // Sunday 8 Nov 2026 as a date: midnight UTC to midnight UTC
    const days = viewDays("week", sunday - off * MIN, off);   // the week the viewer sees, Monday first
    const lane = allDayLane([allDayLocal(ev("MLA Updates", sunday, sunday + DAY, true), off)], days);
    assert.deepEqual(lane.segs.map((s) => [s.a, s.b]), [[6, 6]], `offset ${off}: one chip on Sunday`);
    const mon = Date.UTC(2026, 10, 9);
    const l2 = allDayLane([allDayLocal(ev("MLA Updates", mon, mon + DAY, true), off)], viewDays("week", mon - off * MIN, off));
    assert.deepEqual(l2.segs.map((s) => [s.a, s.b]), [[0, 0]], `offset ${off}: one chip on Monday`);
  }
});

test("a timed event is left alone, and the way back to the wire restores an all-day event", () => {
  const timed = ev("Office hours", 1_000_000, 1_000_000 + 3_600_000, false);
  assert.equal(allDayLocal(timed, -420), timed);
  const day = ev("Day", Date.UTC(2026, 10, 8), Date.UTC(2026, 10, 9), true);
  assert.deepEqual(allDayToWire(allDayLocal(day, -420), -420), day);
});

test("the pane's when line for an all-day event reads the date, whatever the viewer's zone", () => {
  const d = Date.UTC(2026, 10, 8);
  for (const off of [-480, 0, 600]) assert.equal(whenLine({ startsAt: d, endsAt: d + DAY, allDay: true }, off), "Sun, Nov 8 · All day");
});

test("only a not-found answer means the event is gone; a busy server or a dropped link does not", () => {
  assert.equal(goneError({ code: "validation.not_found" }), true);
  assert.equal(goneError({ error: { code: "validation.not_found" } }), true);
  assert.equal(goneError(new Error("timeout")), false);
  assert.equal(goneError({ code: "server.unavailable" }), false);
  assert.equal(goneError(null), false);
});

test("the week opens one hour above the current time, whatever early event is in it", () => {
  assert.equal(openHour(true, 14.5, [0]), 13.5, "an event at midnight does not pull it up");
  assert.equal(openHour(true, 0.5, []), 0);
  assert.equal(openHour(false, 14.5, []), 7.5, "another week opens at the working day");
  assert.equal(openHour(false, 14.5, [6]), 5.5, "but not below its first event");
});
