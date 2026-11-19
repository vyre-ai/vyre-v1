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

test("the spring-forward hour that does not exist is skipped, the day still runs", () => {
  // New York, 2027-03-14: 02:00 jumps to 03:00. A 02:30 job has no 02:30 that day.
  const c = parseCron("30 2 * * *");
  const n = next(c, at("2027-03-14T00:00:00Z"), "America/New_York");
  assert.equal(n, at("2027-03-15T06:30:00Z")); // the next day's 02:30 (EDT, UTC-4)
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
