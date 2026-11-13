// P1 step 2b (lead's ruling, 13 Nov 2026): a zone given as a fixed offset ("+05:00", "-03:30") may already be stored on a live Space, so it keeps its meaning everywhere: zones.ts and the clock read it the same
// way (a fixed clock, no daylight saving), and the goal deadline field and deadlineExample settle a time typed in a gap hour on the instant the gap ends.
import test from "node:test";
import assert from "node:assert/strict";
import { cronAt, nextCron, parseCron, startOfDay, zoneNamed } from "../lib/clock.ts";
import { deadlineExample, instantOf, offsetMinAt } from "../lib/zones.ts";
import { nextAt, offsetAt } from "../modules/goals/projections.ts";
import { startOfDayIn } from "../modules/tasks/projections.ts";
import { localClock } from "../modules/notifications/projections.ts";

const utc = (iso: string): number => Date.parse(iso);

test("a profile, a goal and a cron in a fixed offset give the same instants through zones.ts and through the clock", () => {
  for (const [zone, minutes] of [
    ["+05:00", 300],
    ["-03:30", -210],
  ] as const) {
    assert.equal(zoneNamed(zone), zone, "the clock reads the offset as a zone, not as UTC");
    assert.equal(offsetMinAt(utc("2026-07-01T12:00:00Z"), zone), minutes);
    assert.equal(offsetMinAt(utc("2026-01-01T12:00:00Z"), zone), minutes, "no daylight saving");
    // a goal's time of day, a profile's start of day and working-hours clock
    assert.equal(
      nextAt(utc("2026-07-01T12:00:00Z"), zone, "09:00"),
      nextCron(cronAt(9, 0), zone, utc("2026-07-01T12:00:00Z")),
    );
    assert.equal(offsetAt(utc("2026-07-01T12:00:00Z"), zone), minutes * 60_000);
    assert.equal(startOfDayIn(utc("2026-07-01T12:00:00Z"), zone), startOfDay(utc("2026-07-01T12:00:00Z"), zone));
    assert.equal(startOfDayIn(utc("2026-07-01T12:00:00Z"), zone) % 60_000, 0);
    assert.equal(localClock(utc("2026-07-01T12:00:00Z"), zone).minutes, (12 * 60 + minutes + 1440) % 1440);
  }
  assert.equal(nextCron(parseCron("0 9 * * *")!, "+05:00", utc("2026-07-01T12:00:00Z")), utc("2026-07-02T04:00:00Z"));
  assert.equal(nextCron(parseCron("0 9 * * *")!, "-03:30", utc("2026-07-01T12:00:00Z")), utc("2026-07-01T12:30:00Z"));
  assert.equal(startOfDayIn(utc("2026-07-01T12:00:00Z"), "-03:30"), utc("2026-07-01T03:30:00Z"));
});

test("a time typed in a gap hour is the instant the gap ends, in zones east and west of Greenwich (the goal deadline field and deadlineExample)", () => {
  assert.equal(instantOf("2026-03-08T02:30", "America/New_York"), utc("2026-03-08T07:00:00Z"));
  assert.equal(instantOf("2026-03-29T01:30", "Europe/London"), utc("2026-03-29T01:00:00Z"));
  assert.equal(instantOf("2026-10-04T02:30", "Australia/Sydney"), utc("2026-10-03T16:00:00Z"));
  // deadlineExample sets its sample "a week from now at 4:16 PM"; from the first of March a week lands outside any gap, and the line it returns reads the same moment in both zones
  const d = deadlineExample(utc("2026-03-01T12:00:00Z"), "America/New_York", "Europe/London");
  assert.match(d.before, /4:16 PM/);
});
