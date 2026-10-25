// The cron engine (scheduler.next_times and every schedule's next fire time): fields, names, steps, the day-of-month and weekday rule, and the wall clock of a time zone through daylight saving.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { host, NOW } from "../fixtures/seed.ts";
import { nextCron, parseCron } from "../impl.ts";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);
const next = (cron: string, tz: string, after: number): number | undefined => nextCron(parseCron(cron)!, tz, after);
const series = (cron: string, tz: string, after: number, n: number): number[] => {
  const out: number[] = [];
  let at = after;
  for (let i = 0; i < n; i++) { const t = next(cron, tz, at); if (t === undefined) break; out.push(t); at = t; }
  return out;
};

test("every minute, every five minutes, lists and ranges", () => {
  const t0 = utc(2026, 1, 5, 10, 7);
  assert.equal(next("* * * * *", "UTC", t0), utc(2026, 1, 5, 10, 8));
  assert.equal(next("* * * * *", "UTC", t0 + 30_000), utc(2026, 1, 5, 10, 8), "seconds are ignored; the next minute");
  assert.deepEqual(series("*/5 * * * *", "UTC", t0, 3), [utc(2026, 1, 5, 10, 10), utc(2026, 1, 5, 10, 15), utc(2026, 1, 5, 10, 20)]);
  assert.deepEqual(series("0,30 9-10 * * *", "UTC", t0, 3), [utc(2026, 1, 5, 10, 30), utc(2026, 1, 6, 9, 0), utc(2026, 1, 6, 9, 30)]);
  assert.equal(next("10-20/5 * * * *", "UTC", utc(2026, 1, 5, 10, 11)), utc(2026, 1, 5, 10, 15));
  assert.equal(next("5/20 * * * *", "UTC", utc(2026, 1, 5, 10, 6)), utc(2026, 1, 5, 10, 25), "a start with a step runs to the end of the field");
});

test("strictly after: a time that is exactly now is not the next one", () => {
  assert.equal(next("0 9 * * *", "UTC", utc(2026, 1, 5, 9, 0)), utc(2026, 1, 6, 9, 0));
});

test("weekdays, names and Sunday as 0 or 7", () => {
  const fri = utc(2025, 10, 10, 12, 0);   // a Friday
  assert.deepEqual(series("0 9 * * 1-5", "UTC", fri, 3), [utc(2025, 10, 13, 9), utc(2025, 10, 14, 9), utc(2025, 10, 15, 9)]);
  assert.equal(next("0 9 * * sun", "UTC", fri), utc(2025, 10, 12, 9));
  assert.equal(next("0 9 * * 7", "UTC", fri), utc(2025, 10, 12, 9));
  assert.equal(next("0 9 * * mon-wed", "UTC", fri), utc(2025, 10, 13, 9));
  assert.equal(next("0 0 1 JAN,jul *", "UTC", fri), utc(2026, 1, 1, 0));
});

test("day of month and weekday together match either; a star leaves the other in charge", () => {
  const t0 = utc(2026, 1, 1, 0, 0);   // a Thursday
  assert.deepEqual(series("0 0 15 * 1", "UTC", t0, 3), [utc(2026, 1, 5), utc(2026, 1, 12), utc(2026, 1, 15)], "the 15th or any Monday");
  assert.deepEqual(series("0 0 15 * *", "UTC", t0, 2), [utc(2026, 1, 15), utc(2026, 2, 15)]);
  assert.equal(next("0 0 31 * *", "UTC", utc(2026, 2, 1)), utc(2026, 3, 31), "months without a 31st are skipped");
});

test("macros, leap days and a cron that never fires", () => {
  const t0 = utc(2026, 1, 5, 10, 0);
  assert.equal(next("@hourly", "UTC", t0), utc(2026, 1, 5, 11));
  assert.equal(next("@daily", "UTC", t0), utc(2026, 1, 6));
  assert.equal(next("@weekly", "UTC", t0), utc(2026, 1, 11));
  assert.equal(next("@monthly", "UTC", t0), utc(2026, 2, 1));
  assert.equal(next("@yearly", "UTC", t0), utc(2027, 1, 1));
  assert.equal(next("0 0 29 2 *", "UTC", t0), utc(2028, 2, 29));
  assert.equal(next("0 0 30 2 *", "UTC", t0), undefined);
});

test("bad crons are refused", () => {
  for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "5-1 * * * *", "a * * * *", "1//2 * * * *", "@sometimes"]) {
    assert.equal(parseCron(bad), undefined, bad);
  }
});

test("a time zone's wall clock: Karachi is UTC+5, Kolkata UTC+5:30, Sydney moves with daylight saving", () => {
  const after = utc(2025, 10, 9, 2, 0);
  assert.equal(next("0 9 * * *", "Asia/Karachi", after), utc(2025, 10, 9, 4, 0));
  assert.equal(next("0 9 * * *", "Asia/Kolkata", after), utc(2025, 10, 9, 3, 30));
  assert.equal(next("0 9 * * *", "Australia/Sydney", utc(2025, 10, 8, 20, 0)), utc(2025, 10, 8, 22, 0), "AEDT from 5 October is UTC+11");
  assert.equal(next("0 9 * * *", "Australia/Sydney", utc(2025, 6, 30, 20, 0)), utc(2025, 6, 30, 23, 0), "AEST in June is UTC+10");
});

test("daylight saving: a local time that does not exist is skipped that day; one that happens twice fires at its first pass", () => {
  // New York went forward on 8 March 2026 (02:00 became 03:00) and back on 1 November 2026 (02:00 became 01:00)
  assert.equal(next("30 2 * * *", "America/New_York", utc(2026, 3, 7, 8, 0)), utc(2026, 3, 9, 6, 30), "no 02:30 on 8 March; 9 March is already EDT");
  assert.equal(next("30 1 * * *", "America/New_York", utc(2026, 11, 1, 0, 0)), utc(2026, 11, 1, 5, 30), "01:30 EDT, the first of the two");
  assert.equal(next("30 1 * * *", "America/New_York", utc(2026, 11, 1, 5, 30)), utc(2026, 11, 2, 6, 30), "the next day is EST");
  assert.equal(next("0 9 * * *", "America/New_York", utc(2026, 3, 7, 15, 0)), utc(2026, 3, 8, 13, 0), "09:00 on 8 March is EDT: 13:00 UTC");
});

test("scheduler.next_times gives the editor preview and refuses a bad cron or zone", async () => {
  const h = harness();
  const r = await h.call("scheduler.next_times", { cron: "0 9 * * 1-5", tz: "Asia/Karachi", count: 3 }, host);
  assert.deepEqual(r.times, [utc(2025, 10, 10, 4), utc(2025, 10, 13, 4), utc(2025, 10, 14, 4)]);
  assert.equal((await h.call("scheduler.next_times", { cron: "* * * * *", tz: "UTC" }, host)).times.length, 5, "five by default");
  assert.equal((await h.call("scheduler.next_times", { cron: "0 0 30 2 *", tz: "UTC" }, host)).times.length, 0);
  await assert.rejects(h.call("scheduler.next_times", { cron: "nope", tz: "UTC" }, host), (e) => codeOf(e) === "validation.bad_input" && reasonOf(e) === "bad_cron");
  await assert.rejects(h.call("scheduler.next_times", { cron: "* * * * *", tz: "Nowhere/Land" }, host), (e) => reasonOf(e) === "bad_tz");
  assert.ok(r.times[0] > NOW);
});
