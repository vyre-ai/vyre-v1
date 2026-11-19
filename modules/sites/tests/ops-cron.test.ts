// Cron for jobs: parsing, the next slot in a time zone, the missed slot (r42-sites-run, slice 5).
import test from "node:test";
import assert from "node:assert/strict";
import { describe, latestBefore, localOf, next, parseCron, validZone } from "../ops/cron.ts";

const at = (iso: string): number => Date.parse(iso);

test("fields: lists, ranges, steps, names and the aliases", () => {
  const c = parseCron("*/15 9-17 * jan,mar mon-fri");
  assert.deepEqual([...c.minutes], [0, 15, 30, 45]);
  assert.deepEqual([...c.hours], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...c.months], [1, 3]);
  assert.deepEqual([...c.weekdays], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron("5/20 * * * *").minutes], [5, 25, 45]);
  assert.deepEqual([...parseCron("0 0 * * 7").weekdays], [0]);
  assert.deepEqual([...parseCron("@daily").hours], [0]);
  assert.deepEqual([...parseCron("@HOURLY").minutes], [0]);
});

test("a bad schedule is one plain sentence", () => {
  assert.throws(() => parseCron("* * *"), /five parts/);
  assert.throws(() => parseCron("61 * * * *"), /outside 0 to 59/);
  assert.throws(() => parseCron("5-1 * * * *"), /backwards/);
  assert.throws(() => parseCron("*/0 * * * *"), /step/);
  assert.throws(() => parseCron("a b c d e"), /outside|not a cron/);
});

test("next is the first minute strictly after the time", () => {
  const c = parseCron("*/15 * * * *");
  assert.equal(next(c, at("2026-11-19T10:00:00Z"), "UTC"), at("2026-11-19T10:15:00Z"));
  assert.equal(next(c, at("2026-11-19T10:14:59Z"), "UTC"), at("2026-11-19T10:15:00Z"));
  assert.equal(next(c, at("2026-11-19T10:45:30Z"), "UTC"), at("2026-11-19T11:00:00Z"));
});

test("next reads the schedule in the zone", () => {
  const c = parseCron("30 9 * * *");
  // 09:30 in Karachi (UTC+5) is 04:30 UTC
  assert.equal(next(c, at("2026-11-19T00:00:00Z"), "Asia/Karachi"), at("2026-11-19T04:30:00Z"));
  // 09:30 in New York in November (UTC-5)
  assert.equal(next(c, at("2026-11-19T00:00:00Z"), "America/New_York"), at("2026-11-19T14:30:00Z"));
  assert.equal(localOf(at("2026-11-19T04:30:00Z"), "Asia/Karachi").h, 9);
});

test("day of month and day of week: either matches when both are given", () => {
  const c = parseCron("0 0 13 * fri");
  assert.equal(next(c, at("2026-11-01T00:00:00Z"), "UTC"), at("2026-11-06T00:00:00Z")); // a Friday
  assert.equal(next(c, at("2026-11-07T00:00:00Z"), "UTC"), at("2026-11-13T00:00:00Z")); // the 13th (also a Friday)
  const dom = parseCron("0 0 13 * *");
  assert.equal(next(dom, at("2026-11-01T00:00:00Z"), "UTC"), at("2026-11-13T00:00:00Z"));
});

test("a month rolls, a leap day waits, and an impossible date finds nothing", () => {
  assert.equal(next(parseCron("0 0 1 1 *"), at("2026-11-19T00:00:00Z"), "UTC"), at("2027-01-01T00:00:00Z"));
  assert.equal(next(parseCron("0 0 29 2 *"), at("2026-11-19T00:00:00Z"), "UTC"), at("2028-02-29T00:00:00Z"));
  assert.equal(next(parseCron("0 0 31 2 *"), at("2026-11-19T00:00:00Z"), "UTC"), null);
});

test("spring forward: a slot in the hour that does not exist runs once, shifted by the hour, never lost", () => {
  // New York, 2027-03-14: 02:00 jumps to 03:00. A 02:30 job has no 02:30 that day: it runs at 03:30.
  const c = parseCron("30 2 * * *");
  assert.equal(next(c, at("2027-03-14T00:00:00Z"), "America/New_York"), at("2027-03-14T07:30:00Z"));
  // and the day after is the plain 02:30 (EDT, UTC-4)
  assert.equal(next(c, at("2027-03-14T07:30:00Z"), "America/New_York"), at("2027-03-15T06:30:00Z"));
});

test("spring forward: the Monday after the change still has its 00:00 slot (Berlin and New York)", () => {
  const c = parseCron("0 0 * * 1");
  assert.equal(next(c, at("2027-03-08T12:00:00Z"), "America/New_York"), at("2027-03-15T04:00:00Z")); // Monday 15 Mar 00:00 EDT
  assert.equal(next(c, at("2027-03-22T12:00:00Z"), "Europe/Berlin"), at("2027-03-28T22:00:00Z")); // Monday 29 Mar 00:00 CEST
});

test("fall back: a slot in the hour that happens twice runs once, at the first, never doubled", () => {
  // New York, 2027-11-07: 02:00 EDT goes back to 01:00 EST, so 01:30 happens twice. A 01:30 job runs once, at the first 01:30 (05:30Z).
  const c = parseCron("30 1 * * *");
  const first = next(c, at("2027-11-07T00:00:00Z"), "America/New_York");
  assert.equal(first, at("2027-11-07T05:30:00Z"));
  const after = next(c, first as number, "America/New_York");
  assert.equal(after, at("2027-11-08T06:30:00Z"), "the next one is the next day's, not the repeated 01:30");
});

test("every hour across the change neither skips nor doubles a slot", () => {
  const c = parseCron("0 * * * *");
  const seen: number[] = [];
  let t = at("2027-03-14T04:30:00Z");
  for (let i = 0; i < 6; i++) {
    t = next(c, t, "America/New_York") as number;
    seen.push(t);
  }
  // 00:00 EST, 01:00 EST, 03:00 EDT, 04:00 EDT ... one an hour on the clock, with the skipped 02:00 not invented
  assert.deepEqual(
    seen.map((x) => x - at("2027-03-14T05:00:00Z")),
    [0, 3600_000, 2 * 3600_000, 3 * 3600_000, 4 * 3600_000, 5 * 3600_000],
  );
});

test("an impossible date finds nothing, and quickly: a few thousand additions, not years of minutes", () => {
  const started = performance.now();
  for (let i = 0; i < 50; i++)
    assert.equal(next(parseCron("0 0 31 2 *"), at("2026-11-19T00:00:00Z"), "America/New_York"), null);
  assert.ok(performance.now() - started < 1500, `50 scans took ${Math.round(performance.now() - started)} ms`);
});

test("a schedule that fires every minute costs a few zone lookups, not a day of them", () => {
  const started = performance.now();
  for (let i = 0; i < 500; i++)
    next(parseCron("* * * * *"), at("2026-11-19T10:00:30Z") + i * 60_000, "America/New_York");
  assert.ok(performance.now() - started < 1500, `500 lookups took ${Math.round(performance.now() - started)} ms`);
});

test("latestBefore finds the newest slot inside the window", () => {
  const c = parseCron("0 * * * *");
  assert.equal(latestBefore(c, at("2026-11-19T10:30:00Z"), "UTC", 3 * 3_600_000), at("2026-11-19T10:00:00Z"));
  assert.equal(latestBefore(c, at("2026-11-19T10:00:00Z"), "UTC", 0), at("2026-11-19T10:00:00Z"));
  assert.equal(latestBefore(parseCron("0 0 1 1 *"), at("2026-11-19T10:30:00Z"), "UTC", 3_600_000), null);
});

test("describe and validZone", () => {
  assert.equal(describe("*/5 * * * *"), "Every 5 minutes");
  assert.equal(describe("@hourly"), "Every hour");
  assert.equal(describe("30 2 * * *"), "Every day at 02:30");
  assert.equal(describe("5 4 1 * *"), "5 4 1 * *");
  assert.equal(validZone("Asia/Karachi"), true);
  assert.equal(validZone("Mars/Base"), false);
});
