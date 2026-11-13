// The golden times replayed through the functions of the modules that call the clock (P1 step 2): the three cron parsers and the zone formatters keep their own names, callers do not change, and every recorded answer
// is still the answer except the cases listed in lib/clock-golden-kit.test.ts, each with the sentence that justifies it.
import test from "node:test";
import assert from "node:assert/strict";
import { nextRun, parseCron as agentsParse } from "../modules/agents/projections.ts";
import { nextCron as autoNext, parseCron as autoParse } from "../modules/automations/schedule/cron.ts";
import { nextCron as schedNext, parseCron as schedParse } from "../modules/scheduler-api/projections.ts";
import { afterQuiet, instant, local, nextAt, nextCheckin, offsetAt, type Goal } from "../modules/goals/projections.ts";
import { startOfDayIn } from "../modules/tasks/projections.ts";
import { nextDue } from "../modules/tasks/handlers/schedule.ts";
import { localClock } from "../modules/notifications/projections.ts";
import {
  CRON_AGENTS_WRAPPED,
  CRON_ZONE,
  GOAL_AFTER_QUIET,
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
} from "../lib/clock-golden-kit.test.ts";

const DAY = 86_400_000;
const keyOf = (r: Record<string, any>): string => `${r["cron"]} | ${r["zone"]} | ${iso(r["after"])}`; // eslint-disable-line @typescript-eslint/no-explicit-any

test("Automations: parseCron and nextCron answer as recorded, except the gap and repeat rules", () => {
  for (const r of golden["cron_zone"]!) {
    const spec = autoParse(r["cron"]);
    replay(CRON_ZONE, keyOf(r), r["automations"], spec ? (autoNext(spec, r["zone"], r["after"]) ?? null) : "bad");
  }
});

test("scheduler-api: parseCron and nextCron answer as recorded, except the gap and repeat rules", () => {
  used.clear();
  for (const r of golden["cron_zone"]!) {
    const spec = schedParse(r["cron"]);
    replay(CRON_ZONE, keyOf(r), r["scheduler"], spec ? (schedNext(spec, r["zone"], r["after"]) ?? null) : "bad");
  }
  assert.deepEqual(unused(CRON_ZONE), [], "every listed gap and repeat case was exercised");
});

test("routines (agents): nextRun answers as recorded: numbers only, a year ahead, UTC", () => {
  used.clear();
  for (const r of golden["cron_zone"]!.filter((x) => "agents" in x)) {
    replay(CRON_AGENTS_WRAPPED, `${r["cron"]} | ${iso(r["after"])}`, r["agents"], nextRun(r["cron"], r["after"]));
  }
  assert.deepEqual(unused(CRON_AGENTS_WRAPPED), []);
  assert.equal(agentsParse("5 4 * * sun"), null, "names are not routine syntax (routines.test.ts)");
  assert.equal(agentsParse("@daily"), null);
});

test("every fire of 2026, walked through the three parsers, except the gap and repeat days", () => {
  for (const w of golden["cron_walk"]!) {
    const key = `${w.cron} | ${w.zone}`;
    const walk = (f: (after: number) => number | undefined | null): number[] => {
      const out: number[] = [];
      for (let at = w.from; ; ) {
        const t = f(at);
        if (t === undefined || t === null || t >= w.until) return out;
        out.push(t);
        at = t;
      }
    };
    const a = autoParse(w.cron)!;
    const s = schedParse(w.cron)!;
    const viaAutomations = walk((x) => autoNext(a, w.zone, x));
    assert.deepEqual(
      viaAutomations,
      walk((x) => schedNext(s, w.zone, x)),
      `${key}: the two parsers walk the same year`,
    );
    const edit = WALKS[key];
    if (edit === undefined) assert.deepEqual(viaAutomations, w.automations, `${key}: a day of 2026 moved`);
    else {
      const missing = new Set(edit.missing.map(utc));
      const expected = [...w.automations.filter((t: number) => !missing.has(t)), ...edit.extra.map(utc)].sort(
        (x: number, y: number) => x - y,
      );
      assert.deepEqual(viaAutomations, expected, `${key}: not the hand-edited year (${edit.why[0]})`);
    }
    if (w.agents)
      assert.deepEqual(
        walk((x) => nextRun(w.cron, x)),
        w.agents,
        `${key}: the routines parser walks the same year`,
      );
  }
});

const goal = (over: Partial<Pick<Goal, "rhythm" | "zone" | "quiet">>): Pick<Goal, "rhythm" | "zone" | "quiet"> => ({
  rhythm: { every: "day", at: "09:00" },
  zone: "UTC",
  quiet: null,
  ...over,
});

test("goals: nextAt, instant, local and offsetAt answer as recorded, except the gap and repeat rules", () => {
  used.clear();
  for (const r of golden["goal_next_at"]!)
    replay(
      GOAL_NEXT_AT,
      `${r["zone"]} | ${r["time"]} | ${r["day"] ?? "any"} | ${iso(r["after"])}`,
      r["got"],
      nextAt(r["after"], r["zone"], r["time"], r["day"]),
    );
  for (const r of golden["goal_instant"]!)
    replay(
      GOAL_INSTANT,
      `${r["zone"]} | ${r["y"]}-${r["mo"]}-${r["d"]} ${r["h"]}:${r["mi"]}`,
      r["got"],
      instant(r["y"], r["mo"], r["d"], r["h"], r["mi"], r["zone"]),
    );
  for (const r of golden["goal_local"]!) {
    assert.deepEqual(local(r["at"], r["zone"]), r["got"], `${r["zone"]} at ${iso(r["at"])}`);
    assert.equal(offsetAt(r["at"], r["zone"]), r["offsetMs"], `${r["zone"]} offset at ${iso(r["at"])}`);
  }
  assert.deepEqual(unused(GOAL_NEXT_AT), []);
  assert.deepEqual(unused(GOAL_INSTANT), []);
});

test("goals: the end of quiet hours (except one that ends in a gap) and the next check-in answer as recorded", () => {
  // both are goals' own logic over the clock, with the recorded quiet hours
  used.clear();
  for (const r of golden["goal_after_quiet"]!)
    replay(
      GOAL_AFTER_QUIET,
      `${r["zone"]} | ${r["quiet"].from}-${r["quiet"].to} | ${iso(r["at"])}`,
      r["got"],
      afterQuiet(r["at"], goal({ zone: r["zone"], quiet: r["quiet"] })),
    );
  assert.deepEqual(unused(GOAL_AFTER_QUIET), []);
  for (const r of golden["goal_next_checkin"]!)
    assert.equal(
      nextCheckin(goal({ zone: r["zone"], rhythm: r["rhythm"], quiet: r["quiet"] }), r["after"]),
      r["got"],
      `${r["zone"]} ${JSON.stringify(r["rhythm"])} after ${iso(r["after"])}`,
    );
});

test("tasks: startOfDayIn answers as recorded, except the two days a year the clocks change", () => {
  used.clear();
  for (const r of golden["task_start_of_day"]!)
    replay(
      TASK_START_OF_DAY,
      `${r["zone"]} | ${iso(r["ms"])}`,
      r["got"],
      startOfDayIn(r["ms"], r["zone"] ?? undefined),
    );
  assert.deepEqual(unused(TASK_START_OF_DAY), []);
});

test("tasks: nextDue answers as recorded in UTC, and keeps the wall clock in a zone", () => {
  used.clear();
  for (const r of golden["task_next_due"]!) {
    if (r["zone"] === undefined)
      assert.equal(nextDue(r["from"], r["every"], r["n"]), r["got"], `${iso(r["from"])} ${r["every"]} ${r["n"]}`);
    else
      replay(
        TASK_NEXT_DUE,
        `${iso(r["from"])} ${r["every"]} ${r["n"]}`,
        r["got"],
        nextDue(r["from"], r["every"], r["n"], r["zone"]),
      );
  }
  assert.deepEqual(unused(TASK_NEXT_DUE), []);
  assert.equal(DAY, 86_400_000);
});

test("notifications: localClock answers as recorded", () => {
  for (const r of golden["notif_local_clock"]!)
    assert.deepEqual(localClock(r["at"], r["tz"]), r["got"], `${r["tz"]} at ${iso(r["at"])}`);
});
