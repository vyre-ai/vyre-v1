// The golden times replayed on the clock (P1 step 1): every case of the recorded table, through lib/clock.ts. The table, the hand-worked answers and the sentences that justify each difference are in lib/clock-golden-kit.test.ts.

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, cronAt, instantOfWall, nextCron, parseCron, startOfDay } from "./clock.ts";
import { offsetMinAt, partsIn } from "./zones.ts";
import {
  CRON_AGENTS,
  CRON_ZONE,
  DAY,
  GOAL_INSTANT,
  GOAL_NEXT_AT,
  TASK_NEXT_DUE,
  TASK_START_OF_DAY,
  WALKS,
  golden,
  iso,
  replay,
  unused,
  used,
  utc,
  zoneOrUtc,
} from "./clock-golden-kit.test.ts";

test("the table is recorded: the families and how many cases each holds", () => {
  const sizes = Object.fromEntries(Object.entries(golden).map(([k, v]) => [k, v.length]));
  assert.ok(sizes["cron_zone"]! >= 62 && sizes["cron_walk"]! >= 14, JSON.stringify(sizes));
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
