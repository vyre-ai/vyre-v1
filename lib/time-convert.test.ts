// Time between zones (lib/time-convert.ts): the cases a model got wrong in its head.
import test from "node:test";
import assert from "node:assert/strict";
import { convert, describe, offsetMinutes, parseWhen, resolveZone, zonedToInstant } from "./time-convert.ts";

const NOW = Date.parse("2026-11-04T00:41:00Z");   // Wednesday 4 Nov 2026, 05:41 in Karachi
const PKT = "Asia/Karachi";

test("zones by name, abbreviation or city; unknown ones are null", () => {
  for (const [said, zone] of [["PT", "America/Los_Angeles"], ["pst", "America/Los_Angeles"], ["Pacific Time", "America/Los_Angeles"], ["PKT", PKT], ["UTC", "UTC"], ["Europe/London", "Europe/London"], ["Lisbon", "Europe/Lisbon"], ["kl", "Asia/Kuala_Lumpur"]] as const) assert.equal(resolveZone(said), zone, said);
  assert.equal(resolveZone("Narnia"), null);
  assert.equal(resolveZone(""), null);
});

test("Thursday 5 Nov 2pm PST is Friday 6 Nov 03:00 PKT: across the date line, in one step", () => {
  const c = convert({ when: "Thursday 5 Nov 2pm", from: "PST", to: [PKT], person: PKT, now: NOW });
  assert.equal(c.instantIso, "2026-11-05T22:00:00.000Z");
  assert.equal(c.given, "Thursday 5 November 2026, 14:00 (America/Los_Angeles, UTC-8)");
  assert.equal(c.zones[0]!.text, "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)");
  assert.equal(c.note, undefined, "Thursday 5 Nov 2026 is a Thursday");
});

test("a weekday that does not match its date is said", () => {
  const c = convert({ when: "Friday 5 Nov 2pm", from: "PT", to: [PKT], person: PKT, now: NOW });
  assert.match(c.note ?? "", /Friday is not the day of that date: 5 November 2026 is a Thursday/);
});

test("'tomorrow 2pm PT' said at 05:41 PKT on Wednesday is Thursday 2pm in Los Angeles, Friday 03:00 in Karachi", () => {
  const c = convert({ when: "tomorrow 2pm", from: "PT", to: [PKT], person: PKT, now: NOW });
  assert.equal(c.instantIso, "2026-11-05T22:00:00.000Z");
  assert.equal(c.given, "Thursday 5 November 2026, 14:00 (America/Los_Angeles, UTC-8)");
  assert.equal(c.person, "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)");
});

test("the other day words and relative times count from the person's now", () => {
  const p = (when: string, zone?: string) => new Date(parseWhen(when, { zone, person: PKT, now: NOW }).at).toISOString();
  assert.equal(p("today 5:30pm"), "2026-11-04T12:30:00.000Z");
  assert.equal(p("yesterday noon"), "2026-11-03T07:00:00.000Z");
  assert.equal(p("friday 9am"), "2026-11-06T04:00:00.000Z");
  assert.equal(p("wednesday 9am"), "2026-11-04T04:00:00.000Z", "a bare weekday said on that weekday is today");
  assert.equal(p("next wednesday 9am"), "2026-11-11T04:00:00.000Z");
  assert.equal(p("in 3 hours"), "2026-11-04T03:41:00.000Z");
  assert.equal(p("2026-11-05 14:00", "America/Los_Angeles"), "2026-11-05T22:00:00.000Z");
  assert.equal(p("2026-11-05T14:00:00-08:00"), "2026-11-05T22:00:00.000Z", "an offset in the time itself wins");
  assert.equal(p("5 November 2026 2:30 pm", "ET"), "2026-11-05T19:30:00.000Z");
  assert.equal(p("Nov 5 14:00", "UTC"), "2026-11-05T14:00:00.000Z");
});

test("daylight saving edges: a skipped time, a repeated time, and a conversion across the change", () => {
  // US clocks go forward on 8 Mar 2026 at 02:00 and back on 1 Nov 2026 at 02:00
  const gap = zonedToInstant(2026, 3, 8, 2, 30, "America/Los_Angeles");
  assert.equal(new Date(gap.at).toISOString(), "2026-03-08T10:30:00.000Z", "02:30 does not exist; 03:30 PDT is the first real minute that follows the same wall time");
  assert.match(gap.note ?? "", /does not exist/);
  const twice = zonedToInstant(2026, 11, 1, 1, 30, "America/Los_Angeles");
  assert.equal(new Date(twice.at).toISOString(), "2026-11-01T08:30:00.000Z", "the first 01:30, in daylight time");
  assert.match(twice.note ?? "", /happens twice/);
  assert.equal(offsetMinutes(Date.parse("2026-03-07T12:00:00Z"), "America/Los_Angeles"), -480);
  assert.equal(offsetMinutes(Date.parse("2026-03-09T12:00:00Z"), "America/Los_Angeles"), -420);
  // the same UTC hour reads differently either side of the change; Karachi has none
  assert.equal(describe(Date.parse("2026-03-07T20:00:00Z"), "America/Los_Angeles"), "Saturday 7 March 2026, 12:00 (America/Los_Angeles, UTC-8)");
  assert.equal(describe(Date.parse("2026-03-09T20:00:00Z"), "America/Los_Angeles"), "Monday 9 March 2026, 13:00 (America/Los_Angeles, UTC-7)");
  assert.equal(describe(Date.parse("2026-03-09T20:00:00Z"), PKT), "Tuesday 10 March 2026, 01:00 (Asia/Karachi, UTC+5)");
  // half-hour zones
  assert.equal(describe(Date.parse("2026-11-04T00:41:00Z"), "Asia/Kolkata"), "Wednesday 4 November 2026, 06:11 (Asia/Kolkata, UTC+5:30)");
});

test("what cannot be read, or a zone nobody knows, is a plain sentence", () => {
  assert.throws(() => parseWhen("banana", { person: PKT, now: NOW }), /could not read/);
  assert.throws(() => parseWhen("tomorrow 2pm", { zone: "Narnia", person: PKT, now: NOW }), /do not know the time zone "Narnia"/);
  assert.throws(() => convert({ when: "tomorrow 2pm", to: ["Narnia"], person: PKT, now: NOW }), /do not know the time zone "Narnia"/);
  assert.throws(() => parseWhen("25:00", { person: PKT, now: NOW }), /not a time of day/);
});

import { withLocalTimes } from "./time-convert.ts";

test("a tool result carries the person's local time next to each ISO time and each epoch time key", () => {
  const out = withLocalTimes({ event: { title: "Call", start: "2026-11-05T22:00:00Z", end: "2026-11-05T22:30:00-00:00", attendees: [{ name: "Sam", seenAt: 1_793_916_000_000 }] }, count: 1_793_916_000_000, id: "evt_1" }, PKT);
  assert.equal(out.event.startLocal, "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)");
  assert.equal(out.event.start, "2026-11-05T22:00:00Z", "the ISO time stays");
  assert.match(out.event.endLocal, /^Friday 6 November 2026, 03:30/);
  assert.match(out.event.attendees[0]!.seenAtLocal, /^Friday 6 November 2026/);
  assert.equal((out as Record<string, unknown>)["countLocal"], undefined, "a number under a key that is not a time is left alone");
  assert.equal((out as Record<string, unknown>)["idLocal"], undefined);
  const many = withLocalTimes({ rows: Array.from({ length: 10 }, (_, i) => ({ at: `2026-11-0${(i % 9) + 1}T10:00:00Z` })) }, PKT, 3);
  assert.equal(many.rows.filter((r) => "atLocal" in r).length, 3, "at most the cap");
});
