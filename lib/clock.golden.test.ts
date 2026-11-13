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
import { addDays, addMonths, cronAt, instantOfWall, nextCron, parseCron, startOfDay } from "./clock.ts";
import { offsetMinAt, partsIn, validZone } from "./zones.ts";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const golden = JSON.parse(fs.readFileSync(new URL("./clock.golden.json", import.meta.url), "utf8")).families as Record<
  string,
  Row[]
>;
const utc = (iso: string): number => Date.parse(iso);
const DAY = 86_400_000;
const zoneOrUtc = (z: unknown): string => (typeof z === "string" && validZone(z) ? z : "UTC"); // an unknown zone read as UTC, as goals, tasks and notifications did

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

interface Deliberate {
  why: string[];
  now: unknown;
}
const D = (now: unknown, ...why: string[]): Deliberate => ({ now, why });

/** cron_zone rows, by "cron | zone | after". The new answer is the hand-worked one. */
const CRON_ZONE: Record<string, Deliberate> = {
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
const CRON_AGENTS: Record<string, Deliberate> = {
  "5 4 * * mon,fri | 2026-03-01T12:00:00Z": D(utc("2026-03-02T04:05:00Z"), WIDER),
  "@daily | 2026-11-01T12:00:00Z": D(utc("2026-11-02T00:00:00Z"), WIDER),
  "@weekly | 2026-11-01T12:00:00Z": D(utc("2026-11-08T00:00:00Z"), WIDER),
  "@hourly | 2026-11-01T12:10:00Z": D(utc("2026-11-01T13:00:00Z"), WIDER),
};

/** cron_walk rows: the fires of 2026 in the clock = today's, less `missing`, plus `extra`. */
const WALKS: Record<string, { extra: string[]; missing: string[]; why: string[] }> = {
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

const GOAL_NEXT_AT: Record<string, Deliberate> = {
  "America/New_York | 02:30 | any | 2026-03-07T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS),
  "America/New_York | 02:30 | 0 | 2026-03-01T12:00:00Z": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 01:30 | any | 2026-03-28T12:00:00Z": D(utc("2026-03-29T01:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 01:30 | any | 2026-10-24T12:00:00Z": D(utc("2026-10-25T00:30:00Z"), REPEAT),
  "Australia/Sydney | 02:30 | any | 2026-04-04T12:00:00Z": D(utc("2026-04-04T15:30:00Z"), REPEAT),
  "Australia/Sydney | 02:30 | any | 2026-10-03T12:00:00Z": D(utc("2026-10-03T16:00:00Z"), GAP, GAP_TODAY_GOALS),
  "America/Havana | 00:00 | any | 2026-03-07T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_GOALS),
  "America/Havana | 00:30 | any | 2026-03-07T12:00:00Z": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_GOALS),
};

const GOAL_INSTANT: Record<string, Deliberate> = {
  "America/New_York | 2026-3-8 2:30": D(utc("2026-03-08T07:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 2026-3-29 1:30": D(utc("2026-03-29T01:00:00Z"), GAP, GAP_TODAY_GOALS),
  "Europe/London | 2026-10-25 1:30": D(utc("2026-10-25T00:30:00Z"), REPEAT),
  "America/Havana | 2026-3-8 0:30": D(utc("2026-03-08T05:00:00Z"), GAP, GAP_TODAY_GOALS),
};

const TASK_START_OF_DAY: Record<string, Deliberate> = {
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
const TASK_NEXT_DUE: Record<string, Deliberate> = {
  "2026-03-07T14:00:00Z day 1": D(utc("2026-03-08T13:00:00Z"), REPEAT_24H), // 09:00 EST Saturday, 09:00 EDT Sunday
  "2026-03-07T14:00:00Z week 1": D(utc("2026-03-14T13:00:00Z"), REPEAT_24H),
  "2026-10-31T13:00:00Z day 2": D(utc("2026-11-02T14:00:00Z"), REPEAT_24H), // 09:00 EDT on 31 Oct, 09:00 EST on 2 Nov
  "2026-10-25T13:00:00Z week 1": D(utc("2026-11-01T14:00:00Z"), REPEAT_24H), // 09:00 EDT on 25 Oct, 09:00 EST on 1 Nov (the day the clocks go back)
  "2026-03-01T14:00:00Z month 1": D(utc("2026-04-01T13:00:00Z"), REPEAT_24H), // 09:00 EST on 1 Mar, 09:00 EDT on 1 Apr
};

// ---- the replay

const used = new Set<string>();
/** Replays one row: a case in `deliberate` must differ from today's answer and equal the hand-worked one; every other case must equal today's. */
function replay(table: Record<string, Deliberate>, key: string, today: unknown, now: unknown): void {
  const d = table[key];
  if (d === undefined) return void assert.deepEqual(now, today, `${key}: the clock changed an answer nobody listed`);
  used.add(`${key}`);
  assert.notDeepEqual(today, d.now, `${key}: listed as a difference, but today's answer is the same`);
  assert.deepEqual(now, d.now, `${key}: not the hand-worked answer (${d.why[0]})`);
}
const iso = (t: number): string => new Date(t).toISOString().replace(".000Z", "Z");
const unused = (table: Record<string, unknown>): string[] => Object.keys(table).filter((k) => !used.has(k));

test("the table is recorded: the families and how many cases each holds", () => {
  const sizes = Object.fromEntries(Object.entries(golden).map(([k, v]) => [k, v.length]));
  assert.ok(sizes["cron_zone"]! >= 57 && sizes["cron_walk"]! >= 14, JSON.stringify(sizes));
  assert.equal(
    Object.values(sizes).reduce((a, b) => a + b, 0),
    sizes["cron_zone"]! + sizes["cron_walk"]! + 23 + 36 + 15 + 19 + 7 + 21 + 12 + 20,
    "nobody trimmed the table",
  );
});

test("cron, in a zone: Automations and scheduler-api answers replayed, except the gap and repeat rules", () => {
  for (const r of golden["cron_zone"]!) {
    const key = `${r["cron"]} | ${r["zone"]} | ${iso(r["after"])}`;
    const spec = parseCron(r["cron"]);
    const now = spec ? (nextCron(spec, r["zone"], r["after"]) ?? null) : "bad";
    assert.equal(
      r["automations"],
      r["scheduler"],
      `${key}: the two old tz-aware parsers agreed on the day it was recorded`,
    );
    replay(CRON_ZONE, key, r["automations"], now);
  }
});

test("cron, in UTC: the agents routine parser replayed, except the three parsers becoming one", () => {
  for (const r of golden["cron_zone"]!.filter((x) => "agents" in x)) {
    const key = `${r["cron"]} | ${iso(r["after"])}`;
    const spec = parseCron(r["cron"]);
    const t = spec ? nextCron(spec, "UTC", r["after"]) : undefined;
    // the routines parser looked a year ahead (nextRun: 367 days) and answered null beyond it; its wrapper keeps that
    const now = t !== undefined && t - r["after"] <= 367 * DAY ? t : null;
    replay(CRON_AGENTS, key, r["agents"], now);
  }
});

test("cron, every fire of 2026: the three parsers walked from 31 Dec 2025 to 1 Jan 2027, except the gap and repeat days", () => {
  for (const w of golden["cron_walk"]!) {
    const key = `${w.cron} | ${w.zone}`;
    const spec = parseCron(w.cron)!;
    const now: number[] = [];
    for (let at = w.from; ; ) {
      const t = nextCron(spec, w.zone, at);
      if (t === undefined || t >= w.until) break;
      now.push(t);
      at = t;
    }
    assert.deepEqual(w.automations, w.scheduler, `${key}: the two old tz-aware parsers walked the same year`);
    const edit = WALKS[key];
    if (edit === undefined) assert.deepEqual(now, w.automations, `${key}: a day of 2026 moved`);
    else {
      const missing = new Set(edit.missing.map(utc));
      const expected = [...w.automations.filter((t: number) => !missing.has(t)), ...edit.extra.map(utc)].sort(
        (a, b) => a - b,
      );
      assert.deepEqual(now, expected, `${key}: not the hand-edited year (${edit.why[0]})`);
      assert.ok(
        edit.missing.every((m) => w.automations.includes(utc(m))),
        `${key}: a fire listed as missing was never there`,
      );
      used.add(`walk ${key}`);
    }
    if (w.agents) assert.deepEqual(now, w.agents, `${key}: the routines parser walked the same year`);
  }
  assert.deepEqual(
    Object.keys(WALKS).filter((k) => !used.has(`walk ${k}`)),
    [],
  );
});

test("goals: a time of day after an instant, replayed, except the gap and repeat rules", () => {
  const hm = (s: string): [number, number] => {
    const m = /^(\d{2}):(\d{2})$/.exec(s); // goals read a time that is not hh:mm as 09:00
    return m ? [Number(m[1]) % 24, Number(m[2]) % 60] : [9, 0];
  };
  for (const r of golden["goal_next_at"]!) {
    const [h, mi] = hm(r["time"]);
    const now = nextCron(cronAt(h, mi, r["day"]), zoneOrUtc(r["zone"]), r["after"]);
    replay(GOAL_NEXT_AT, `${r["zone"]} | ${r["time"]} | ${r["day"] ?? "any"} | ${iso(r["after"])}`, r["got"], now);
  }
});

test("goals: the instant of a wall clock time, replayed, except the gap and repeat rules", () => {
  for (const r of golden["goal_instant"]!) {
    const now = instantOfWall(Date.UTC(r["y"], r["mo"] - 1, r["d"], r["h"], r["mi"]), r["zone"]);
    replay(GOAL_INSTANT, `${r["zone"]} | ${r["y"]}-${r["mo"]}-${r["d"]} ${r["h"]}:${r["mi"]}`, r["got"], now);
  }
});

test("goals: the wall clock of an instant and the zone's offset, replayed exactly", () => {
  for (const r of golden["goal_local"]!) {
    const zone = zoneOrUtc(r["zone"]);
    const p = partsIn(r["at"], zone);
    assert.deepEqual(
      { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, wd: p.dow },
      r["got"],
      `${r["zone"]} at ${iso(r["at"])}`,
    );
    assert.equal(offsetMinAt(r["at"], zone) * 60_000, r["offsetMs"], `${r["zone"]} offset at ${iso(r["at"])}`);
  }
});

test("tasks: the start of a day in a zone, replayed, except the two days a year the clocks change", () => {
  for (const r of golden["task_start_of_day"]!) {
    replay(TASK_START_OF_DAY, `${r["zone"]} | ${iso(r["ms"])}`, r["got"], startOfDay(r["ms"], zoneOrUtc(r["zone"])));
  }
});

test("tasks: a repeating task's next due date, replayed in UTC, and in New York across a clock change", () => {
  for (const r of golden["task_next_due"]!) {
    const move = r["every"] === "month" ? addMonths : addDays;
    const step = r["every"] === "week" ? r["n"] * 7 : r["n"];
    if (r["zone"] === undefined) {
      assert.equal(move(r["from"], step, "UTC"), r["got"], `${iso(r["from"])} ${r["every"]} ${r["n"]} in UTC`);
      continue;
    }
    replay(TASK_NEXT_DUE, `${iso(r["from"])} ${r["every"]} ${r["n"]}`, r["got"], move(r["from"], step, r["zone"]));
  }
});

test("notifications: the weekday and minute of the day at an instant, replayed exactly", () => {
  for (const r of golden["notif_local_clock"]!) {
    const p = partsIn(r["at"], zoneOrUtc(r["tz"]));
    assert.deepEqual({ day: p.dow, minutes: p.hour * 60 + p.minute }, r["got"], `${r["tz"]} at ${iso(r["at"])}`);
  }
});

test("every listed difference was exercised by a case in the table", () => {
  const tables: [string, Record<string, unknown>][] = [
    ["cron_zone", CRON_ZONE],
    ["goal_next_at", GOAL_NEXT_AT],
    ["goal_instant", GOAL_INSTANT],
    ["task_start_of_day", TASK_START_OF_DAY],
    ["task_next_due", TASK_NEXT_DUE],
    ["cron agents", CRON_AGENTS],
  ];
  for (const [name, table] of tables)
    assert.deepEqual(unused(table), [], `${name}: a listed difference matched no case`);
});
