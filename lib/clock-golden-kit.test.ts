// The golden times kit (P1 steps 1 and 2): the recorded table and the list of differences, shared by lib/clock.golden.test.ts (the clock) and test/clock.golden.wrappers.test.ts (the functions of the modules that now call it).
// The golden times (P1 step 1): a table of cases RECORDED from the code of 13 Nov 2026 (tree 19aa9acab) before lib/clock.ts existed, replayed on the clock. Each family below is one of today's code paths:
//   cron_zone, cron_walk  the three cron parsers: automations/schedule/cron.ts and scheduler-api/projections.ts (a zone name) and agents/projections.ts nextRun (UTC only)
//   goal_*                goals/projections.ts nextAt, instant, local and offsetAt (afterQuiet and nextCheckin are replayed in test/clock.golden.wrappers.test.ts, where they call the clock)
//   task_*                tasks/projections.ts startOfDayIn and tasks/handlers/schedule.ts nextDue
//   notif_local_clock     notifications/projections.ts localClock
// Every case must give the answer it gave on the day it was recorded, except the cases listed in DELIBERATE, FOUND and WIDER, each with the sentence that justifies it, so nothing changes silently.
// The expected new answers below are worked out by hand from the zone rules (New York springs forward on 8 Mar 2026 at 07:00Z and falls back on 1 Nov at 06:00Z; London on 29 Mar at 01:00Z and 25 Oct at 01:00Z;
// Sydney falls back on 4 Apr at 16:00Z and springs forward on 3 Oct at 16:00Z), not copied from the clock.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validZone } from "./zones.ts";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const golden = JSON.parse(fs.readFileSync(new URL("./clock.golden.json", import.meta.url), "utf8"))
  .families as Record<string, Row[]>;
export const utc = (iso: string): number => Date.parse(iso);
export const DAY = 86_400_000;
export const zoneOrUtc = (z: unknown): string => (typeof z === "string" && validZone(z) ? z : "UTC"); // an unknown zone read as UTC, as goals, tasks and notifications did

// ---- the cases the clock answers differently on purpose, with the sentence that justifies each

const GAP =
  'P1 section 2, Time: "a time that does not exist (spring forward) fires at the first moment after the gap, the same day"; section 8, Q2: "Fire at the first moment after the gap", the lead\'s decision of 13 Nov 2026';
const GAP_TODAY_AUTOMATIONS =
  'today Automations skips the day (cron.ts:2, "A local time that does not exist ... is skipped")';
const GAP_TODAY_GOALS =
  "today goals' instant() lands on the wrong side of the gap by the length of the gap (an hour before it in New York and Havana, an hour after the start of it in London)";
const REPEAT =
  'P1 section 2, Time: "a time that happens twice (fall back) fires once, at its first pass (both tz-aware parsers say so, automations/schedule/cron.ts:1-3)". Found by the golden table: east of the prime meridian today they fire at the SECOND pass (London, Sydney), only New York takes the first';
const START_OF_DAY =
  "FOUND, not named by the contract: P1 section 3 moves \"tasks/projections.ts zone math\" onto the clock's startOfDay. Today startOfDayIn reads the zone's offset at the moment asked, not at midnight, so on the two days a year the clocks change, a moment after the change gets a day start an hour wrong";
const REPEAT_24H =
  'P1 section 1: "A repeating task adds fixed 24 h days (tasks/handlers/schedule.ts:13-20), so it drifts an hour across a clock change"; section 4 step 2: "repeating task across a DST change stays 09:00"';
const WIDER =
  "FOUND, not named by the contract: the three parsers become one, so a routine's cron now takes what the other two already took (@daily macros, month and weekday names) and looks nine years ahead for a leap day; it was one year, and null";

export interface Deliberate {
  why: string[];
  now: unknown;
}
export const D = (now: unknown, ...why: string[]): Deliberate => ({ now, why });

/** cron_zone rows, by "cron | zone | after". The new answer is the hand-worked one. */
export const CRON_ZONE: Record<string, Deliberate> = {
  "30 2 * * * | America/New_York | 2026-03-07T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "30 2 * * * | America/New_York | 2026-03-08T05:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "0 2 * * * | America/New_York | 2026-03-07T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "59 2 * * * | America/New_York | 2026-03-07T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "30 2 * * 0 | America/New_York | 2026-03-01T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS), // 8 Mar is a Sunday
  "30 1 * * * | Europe/London | 2026-03-28T12:00:00Z": D(utc("2026-03-29T01:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "30 2 * * * | Australia/Sydney | 2026-10-03T12:00:00Z": D(utc("2026-10-03T16:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "0 0 * * * | America/Havana | 2026-03-07T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "30 0 * * * | America/Havana | 2026-03-07T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "15 2 * * * | Australia/Lord_Howe | 2026-10-03T12:00:00Z": D(utc("2026-10-03T15:30:00Z"), GAP, GAP_TODAY_AUTOMATIONS),
  "30 1 * * * | Europe/London | 2026-10-24T12:00:00Z": D(utc("2026-10-25T00:30:00Z"), REPEAT), // first pass 00:30Z; today the second, 01:30Z
  "30 1 * * * | Europe/London | 2026-10-25T00:45:00Z": D(utc("2026-10-26T01:30:00Z"), REPEAT), // today it fires again at 01:30Z the same morning
  "30 2 * * * | Australia/Sydney | 2026-04-04T12:00:00Z": D(utc("2026-04-04T15:30:00Z"), REPEAT),
};

/** The agents parser only: what it answered null to and the clock answers. */
export const CRON_AGENTS: Record<string, Deliberate> = {
  "5 4 * * mon,fri | 2026-03-01T12:00:00Z": D(utc("2026-03-02T04:05:00Z"), WIDER),
  "@daily | 2026-11-01T12:00:00Z": D(utc("2026-11-02T00:00:00Z"), WIDER),
  "@weekly | 2026-11-01T12:00:00Z": D(utc("2026-11-08T00:00:00Z"), WIDER),
  "@hourly | 2026-11-01T12:10:00Z": D(utc("2026-11-01T13:00:00Z"), WIDER),
  "0 9 * * sun | 2026-01-01T12:00:00Z": D(utc("2026-01-04T09:00:00Z"), WIDER),
  "0 9 * * 1-7 | 2026-01-01T12:00:00Z": D(utc("2026-01-02T09:00:00Z"), WIDER),
};

/**
 * The same rows through the routines functions (agents/projections.ts parseCron and nextRun), which keep the old grammar for names and @macros (routines.test.ts: "names are not supported") and the one year
 * look-ahead; only a weekday range that ends in 7 is read now (the other two parsers always did).
 */
export const CRON_AGENTS_WRAPPED: Record<string, Deliberate> = {
  "0 9 * * 1-7 | 2026-01-01T12:00:00Z": D(utc("2026-01-02T09:00:00Z"), WIDER),
};

/** cron_walk rows: the fires of 2026 in the clock = today's, less `missing`, plus `extra`. */
export const WALKS: Record<string, { extra: string[]; missing: string[]; why: string[] }> = {
  "30 2 * * * | America/New_York": { extra: ["2026-03-08T07:00:00Z"], missing: [], why: [GAP, GAP_TODAY_AUTOMATIONS] },
  "30 1 * * * | Europe/London": {
    extra: ["2026-03-29T01:00:00Z", "2026-10-25T00:30:00Z"],
    missing: ["2026-10-25T01:30:00Z"],
    why: [GAP, REPEAT],
  },
  "30 2 * * * | Australia/Sydney": {
    extra: ["2026-04-04T15:30:00Z", "2026-10-03T16:00:00Z"],
    missing: ["2026-04-04T16:30:00Z"],
    why: [GAP, REPEAT],
  },
};

export const GOAL_NEXT_AT: Record<string, Deliberate> = {
  "America/New_York | 02:30 | any | 2026-03-07T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS),
  "America/New_York | 02:30 | 0 | 2026-03-01T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 01:30 | any | 2026-03-28T12:00:00Z": D(utc("2026-03-29T01:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 01:30 | any | 2026-10-24T12:00:00Z": D(utc("2026-10-25T00:30:00Z"), REPEAT),
  "Australia/Sydney | 02:30 | any | 2026-04-04T12:00:00Z": D(utc("2026-04-04T15:30:00Z"), REPEAT),
  "Australia/Sydney | 02:30 | any | 2026-10-03T12:00:00Z": D(utc("2026-10-03T16:00:00Z"), GAP, GAP_TODAY_GOALS),
  "America/Havana | 00:00 | any | 2026-03-07T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_GOALS),
  "America/Havana | 00:30 | any | 2026-03-07T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_GOALS),
};

export const GOAL_INSTANT: Record<string, Deliberate> = {
  "America/New_York | 2026-3-8 2:30": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 2026-3-29 1:30": D(utc("2026-03-29T01:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 2026-10-25 1:30": D(utc("2026-10-25T00:30:00Z"), REPEAT),
  "America/Havana | 2026-3-8 0:30": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_GOALS),
};

/** goal_after_quiet rows, by "zone | from-to | at": a quiet window that ends in the gap ends when the gap does. */
export const GOAL_AFTER_QUIET: Record<string, Deliberate> = {
  "America/New_York | 01:00-02:30 | 2026-03-08T06:30:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS), // 02:30 does not exist: quiet ends at 03:00 EDT; today the goal stays quiet until 02:30 the next day
};

export const TASK_START_OF_DAY: Record<string, Deliberate> = {
  "America/New_York | 2026-03-08T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), START_OF_DAY),
  "America/New_York | 2026-03-09T03:59:00Z": D(utc("2026-03-08T05:00:00Z"), START_OF_DAY),
  "America/New_York | 2026-11-01T06:30:00Z": D(utc("2026-11-01T04:00:00Z"), START_OF_DAY),
  "America/New_York | 2026-11-01T20:00:00Z": D(utc("2026-11-01T04:00:00Z"), START_OF_DAY),
  "Europe/London | 2026-03-29T12:00:00Z": D(utc("2026-03-29T00:00:00Z"), START_OF_DAY),
  "Europe/London | 2026-10-25T12:00:00Z": D(utc("2026-10-24T23:00:00Z"), START_OF_DAY),
  "Australia/Sydney | 2026-04-05T10:00:00Z": D(utc("2026-04-04T13:00:00Z"), START_OF_DAY),
  "Australia/Sydney | 2026-10-04T10:00:00Z": D(utc("2026-10-03T14:00:00Z"), START_OF_DAY),
  "America/Havana | 2026-03-08T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), START_OF_DAY, GAP), // a day that starts at 01:00
};

/** task_next_due rows that carry a zone: today's answer adds fixed 24 hour days; the clock keeps the wall clock. */
export const TASK_NEXT_DUE: Record<string, Deliberate> = {
  "2026-03-07T14:00:00Z day 1": D(utc("2026-03-08T13:00:00Z"), REPEAT_24H), // 09:00 EST Saturday, 09:00 EDT Sunday
  "2026-03-07T14:00:00Z week 1": D(utc("2026-03-14T13:00:00Z"), REPEAT_24H),
  "2026-10-31T13:00:00Z day 2": D(utc("2026-11-02T14:00:00Z"), REPEAT_24H), // 09:00 EDT on 31 Oct, 09:00 EST on 2 Nov
  "2026-10-25T13:00:00Z week 1": D(utc("2026-11-01T14:00:00Z"), REPEAT_24H), // 09:00 EDT on 25 Oct, 09:00 EST on 1 Nov (the day the clocks go back)
  "2026-03-01T14:00:00Z month 1": D(utc("2026-04-01T13:00:00Z"), REPEAT_24H), // 09:00 EST on 1 Mar, 09:00 EDT on 1 Apr
};

// ---- the replay

export const used = new Set<string>();
/** Replays one row: a case in `deliberate` must differ from today's answer and equal the hand-worked one; every other case must equal today's. */
export function replay(table: Record<string, Deliberate>, key: string, today: unknown, now: unknown): void {
  const d = table[key];
  if (d === undefined) return void assert.deepEqual(now, today, `${key}: the clock changed an answer nobody listed`);
  used.add(`${key}`);
  assert.notDeepEqual(today, d.now, `${key}: listed as a difference, but today's answer is the same`);
  assert.deepEqual(now, d.now, `${key}: not the hand-worked answer (${d.why[0]})`);
}
export const iso = (t: number): string => new Date(t).toISOString().replace(".000Z", "Z");
export const unused = (table: Record<string, unknown>): string[] => Object.keys(table).filter((k) => !used.has(k));
