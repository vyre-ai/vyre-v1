// The clock (P1 step 1): the next time of a time of day, an interval and one moment, in a zone that is always a name. The rules that matter: a time that does not exist (spring forward) fires at the first
// moment after the gap, the same day; a time that happens twice (fall back) fires once, at its first pass; an interval counts from the last due time, so a clock change cannot move it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  cronAt,
  instantOfWall,
  nextCron,
  nextEvery,
  nextFire,
  parseCron,
  startOfDay,
  zoneOf,
} from "./clock.ts";
import { offsetMinAt, partsIn } from "./zones.ts";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);
const HOUR = 3_600_000;
const NY = "America/New_York"; // forward on 8 Mar 2026 at 07:00Z (02:00 becomes 03:00), back on 1 Nov 2026 at 06:00Z (02:00 becomes 01:00)

const next = (cron: string, zone: string, after: number): number | undefined => nextCron(parseCron(cron)!, zone, after);
const series = (cron: string, zone: string, after: number, n: number): number[] => {
  const out: number[] = [];
  for (let at = after; out.length < n; ) {
    const t = next(cron, zone, at);
    if (t === undefined) break;
    out.push(t);
    at = t;
  }
  return out;
};

// ---- a time that does not exist

test("a time in the hour that spring skips fires at the first moment after the gap, the same day", () => {
  const before = utc(2026, 3, 7, 12);
  assert.equal(
    next("30 2 * * *", NY, before),
    utc(2026, 3, 8, 7),
    "02:30 does not exist on 8 Mar: it fires at 03:00 EDT",
  );
  assert.equal(next("0 2 * * *", NY, before), utc(2026, 3, 8, 7));
  assert.equal(next("59 2 * * *", NY, before), utc(2026, 3, 8, 7));
  assert.equal(next("30 2 * * *", NY, utc(2026, 3, 8, 5)), utc(2026, 3, 8, 7), "also asked from inside that morning");
  // the next day it is 02:30 EDT again
  assert.equal(next("30 2 * * *", NY, utc(2026, 3, 8, 7)), utc(2026, 3, 9, 6, 30));
});

test("two times that both land in the gap fire once", () => {
  assert.deepEqual(series("0 2,3 * * *", NY, utc(2026, 3, 7, 12), 3), [
    utc(2026, 3, 8, 7),
    utc(2026, 3, 9, 6),
    utc(2026, 3, 9, 7),
  ]);
});

test("a gap at midnight and a gap of half an hour work the same way", () => {
  // Havana skips 00:00 to 01:00 on 8 Mar 2026 (05:00Z); Lord Howe skips 02:00 to 02:30 on 4 Oct 2026 (15:30Z on the 3rd)
  assert.equal(next("0 0 * * *", "America/Havana", utc(2026, 3, 7, 12)), utc(2026, 3, 8, 5));
  assert.equal(next("15 2 * * *", "Australia/Lord_Howe", utc(2026, 10, 3, 12)), utc(2026, 10, 3, 15, 30));
});

test("the gap rule holds south of the equator too", () => {
  // Sydney springs forward on 4 Oct 2026 at 16:00Z: 02:00 becomes 03:00
  assert.equal(next("30 2 * * *", "Australia/Sydney", utc(2026, 10, 3, 12)), utc(2026, 10, 3, 16));
});

// ---- a time that happens twice

test("a time that happens twice fires once, at its first pass", () => {
  assert.equal(next("30 1 * * *", NY, utc(2026, 10, 31, 12)), utc(2026, 11, 1, 5, 30), "01:30 EDT, the first pass");
  assert.equal(next("30 1 * * *", NY, utc(2026, 11, 1, 5, 30)), utc(2026, 11, 2, 6, 30), "not again at 01:30 EST");
  assert.equal(next("30 1 * * *", NY, utc(2026, 11, 1, 6, 0)), utc(2026, 11, 2, 6, 30), "asked in the second pass");
  assert.equal(next("30 1 * * *", "Europe/London", utc(2026, 10, 24, 12)), utc(2026, 10, 25, 0, 30));
  assert.equal(next("30 2 * * *", "Australia/Sydney", utc(2026, 4, 4, 12)), utc(2026, 4, 4, 15, 30));
});

// ---- a zone with no daylight saving

test("in a zone with no daylight saving every day is the same clock", () => {
  const fires = series("0 9 * * *", "Asia/Karachi", utc(2026, 3, 6, 12), 4);
  assert.deepEqual(
    fires,
    [utc(2026, 3, 7, 4), utc(2026, 3, 8, 4), utc(2026, 3, 9, 4), utc(2026, 3, 10, 4)],
    "09:00 in Karachi is 04:00Z, across the days the United States changes its clocks",
  );
  assert.equal(next("30 9 * * *", "Asia/Kolkata", utc(2026, 2, 6, 4)), utc(2026, 2, 7, 4), "a half-hour zone");
});

test("a wall time keeps its clock across a change: 09:00 stays 09:00", () => {
  assert.deepEqual(series("0 9 * * *", NY, utc(2026, 3, 7, 15), 3), [
    utc(2026, 3, 8, 13),
    utc(2026, 3, 9, 13),
    utc(2026, 3, 10, 13),
  ]);
});

// ---- every N hours

test("every N hours counts from the last due time, so a clock change cannot move it", () => {
  const last = utc(2026, 11, 1, 4); // 00:00 EDT on the day the clocks go back
  assert.equal(nextEvery(last, 6 * HOUR), utc(2026, 11, 1, 10), "six hours later, on the clock that runs");
  assert.equal(
    nextEvery(last, 6 * HOUR, utc(2026, 11, 1, 10)),
    utc(2026, 11, 1, 16),
    "strictly after the one that just fired",
  );
  const wall = (t: number): string => `${partsIn(t, NY).hour}:00`;
  assert.deepEqual(
    [last, utc(2026, 11, 1, 10), utc(2026, 11, 1, 16)].map(wall),
    ["0:00", "5:00", "11:00"],
    "the wall clock moved by an hour on the way; the interval did not",
  );
});

test("every N hours catches up after a missed time without drifting off its grid", () => {
  const last = utc(2026, 3, 8, 0);
  assert.equal(
    nextEvery(last, 6 * HOUR, last + 20 * HOUR),
    last + 24 * HOUR,
    "the next grid point after now, not now plus six hours",
  );
  assert.equal(nextEvery(last, 6 * HOUR, last + 6 * HOUR), last + 12 * HOUR);
  assert.throws(() => nextEvery(last, 0), RangeError);
});

// ---- a wake follows the Space's zone

test("a wake with no zone of its own follows the Space's zone", () => {
  const after = utc(2026, 6, 1, 12);
  const daily = { cron: "0 9 * * *" };
  assert.equal(nextFire(daily, { space: "Asia/Karachi" }, after), utc(2026, 6, 2, 4));
  assert.equal(
    nextFire(daily, { space: NY }, after),
    utc(2026, 6, 1, 13),
    "the Space moved to New York: the same wake, a new clock",
  );
  assert.equal(nextFire(daily, { space: "Europe/London" }, after), utc(2026, 6, 2, 8));
  assert.equal(
    nextFire({ cron: "0 9 * * *", tz: "UTC" }, { space: NY }, after),
    utc(2026, 6, 2, 9),
    "its own zone wins",
  );
  assert.equal(nextFire(daily, { person: "Asia/Karachi" }, after), utc(2026, 6, 2, 4), "no Space zone: the person's");
  assert.equal(nextFire(daily, {}, after), utc(2026, 6, 2, 9), "nothing named: UTC");
});

test("zoneOf takes the wake's zone, then the Space's, then the person's, then UTC, and skips a name that is not a zone", () => {
  assert.equal(zoneOf({ wake: "Asia/Tokyo", space: NY, person: "Europe/Paris" }), "Asia/Tokyo");
  assert.equal(zoneOf({ wake: null, space: NY, person: "Europe/Paris" }), NY);
  assert.equal(zoneOf({ space: "Not/AZone", person: "Europe/Paris" }), "Europe/Paris");
  assert.equal(
    zoneOf({ wake: "+05:00", space: undefined, person: "" }),
    "+05:00",
    "a fixed offset may be stored on a live Space and keeps its meaning (no daylight saving)",
  );
  assert.equal(zoneOf({ wake: "nonsense", space: "-03:30" }), "-03:30");
});

test("a moment fires once and never again; an interval wake counts from its last due time", () => {
  const at = utc(2026, 7, 1, 9);
  assert.equal(nextFire({ at }, {}, at - 1), at);
  assert.equal(nextFire({ at }, {}, at), undefined);
  assert.equal(
    nextFire({ every: { hours: 6 }, lastDue: at }, { space: NY }, at),
    at + 6 * HOUR,
    "an interval does not look at the zone",
  );
});

// ---- the wall clock to an instant

test("a wall reading becomes the instant it has in the zone", () => {
  assert.equal(instantOfWall(utc(2026, 7, 1, 9), NY), utc(2026, 7, 1, 13));
  assert.equal(instantOfWall(utc(2026, 1, 5, 9), "Asia/Karachi"), utc(2026, 1, 5, 4));
  assert.equal(instantOfWall(utc(2026, 3, 8, 2, 30), NY), utc(2026, 3, 8, 7), "the gap ends here");
  assert.equal(instantOfWall(utc(2026, 11, 1, 1, 30), NY), utc(2026, 11, 1, 5, 30), "the first of two");
  assert.equal(instantOfWall(utc(2026, 3, 29, 1, 30), "Europe/London"), utc(2026, 3, 29, 1), "the gap ends here");
});

test("start of day and a day later are in the zone's own days", () => {
  assert.equal(startOfDay(utc(2026, 7, 1, 20), NY), utc(2026, 7, 1, 4));
  assert.equal(
    startOfDay(utc(2026, 3, 8, 12), NY),
    utc(2026, 3, 8, 5),
    "on the day clocks go forward, midnight is still EST",
  );
  assert.equal(
    startOfDay(utc(2026, 11, 1, 20), NY),
    utc(2026, 11, 1, 4),
    "on the day clocks go back, midnight is still EDT",
  );
  assert.equal(
    startOfDay(utc(2026, 3, 8, 12), "America/Havana"),
    utc(2026, 3, 8, 5),
    "a day that starts at 01:00 starts there",
  );
  // a day later keeps the wall clock
  const nineEst = utc(2026, 3, 7, 14); // 09:00 EST
  assert.equal(addDays(nineEst, 1, NY), utc(2026, 3, 8, 13), "09:00 EDT, not 10:00");
  assert.equal(addDays(nineEst, 7, NY), utc(2026, 3, 14, 13));
  assert.equal(
    addDays(utc(2026, 11, 1, 13), -1, NY),
    utc(2026, 10, 31, 12),
    "08:00 EST the day clocks go back is 08:00 EDT the day before",
  );
  assert.equal(addMonths(utc(2026, 3, 1, 14), 1, NY), utc(2026, 4, 1, 13), "a month later, the same wall clock");
});

// ---- the cron text

test("the cron text: fields, lists, ranges, steps, names, macros", () => {
  assert.ok(parseCron("*/15 9-10 * * mon,fri"));
  assert.ok(parseCron("@daily"));
  assert.equal(parseCron("61 0 * * *"), undefined);
  assert.equal(parseCron("0 9 * *"), undefined);
  assert.equal(parseCron(""), undefined);
  assert.equal(parseCron("0 9 * * * *"), undefined);
  assert.equal(next("0 12 * * 7", "UTC", utc(2026, 7, 1, 12)), utc(2026, 7, 5, 12), "7 is Sunday");
  assert.equal(
    next("0 9 15 * 1", "UTC", utc(2026, 11, 1, 12)),
    utc(2026, 11, 2, 9),
    "a day of the month and a weekday: either one",
  );
  assert.equal(next("0 9 30 2 *", "UTC", utc(2026, 1, 1)), undefined, "30 February never comes");
  assert.equal(next("0 0 29 2 *", "UTC", utc(2026, 3, 1)), utc(2028, 2, 29), "a leap day is found");
});

test("a time of day, on any day or on one weekday", () => {
  assert.equal(nextCron(cronAt(9, 0), NY, utc(2026, 7, 1, 14)), utc(2026, 7, 2, 13));
  assert.equal(
    nextCron(cronAt(9, 0, 1), "Europe/London", utc(2026, 3, 29, 1)),
    utc(2026, 3, 30, 8),
    "Monday 09:00 BST",
  );
});

test("a change of clock is where the zone says it is: the instant the gap ends is the instant the offset changes", () => {
  const t = next("30 2 * * *", NY, utc(2026, 3, 7, 12))!;
  assert.notEqual(offsetMinAt(t - 1_000, NY), offsetMinAt(t, NY));
});
