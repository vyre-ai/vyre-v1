// Time zone math: offsets with daylight saving, the day in a zone, the Space reading with the viewer's beside it, and the edges (the spring gap, the fall repeat, midnight).
import test from "node:test";
import assert from "node:assert/strict";
import { clockIn, dayWord, deviceZone, instantOf, localInput, offsetLabel, offsetMinAt, validZone, whenIn, titleOf, zoneChoices, zoneMatches, zoneName } from "./zones.ts";

const PT = "America/Los_Angeles", PK = "Asia/Karachi";
const at = (iso: string): number => Date.parse(iso);

test("a zone is valid when Intl knows it", () => {
  assert.equal(validZone(PT), true);
  assert.equal(validZone("UTC"), true);
  assert.equal(validZone("Mars/Olympus"), false);
  assert.equal(validZone(""), false);
  assert.equal(validZone(42), false);
  assert.equal(validZone(deviceZone()), true);
});

test("the offset follows daylight saving: Pacific is -8 in winter and -7 in summer, Karachi is +5 all year", () => {
  assert.equal(offsetMinAt(at("2026-01-15T12:00:00Z"), PT), -480);
  assert.equal(offsetMinAt(at("2026-07-15T12:00:00Z"), PT), -420);
  assert.equal(offsetMinAt(at("2026-01-15T12:00:00Z"), PK), 300);
  assert.equal(offsetMinAt(at("2026-07-15T12:00:00Z"), PK), 300);
  assert.equal(offsetLabel(at("2026-11-04T12:00:00Z"), "Asia/Kolkata"), "UTC+5:30");
});

test("the switch days: the clock jumps at 2 AM on 8 March 2026 and falls back on 1 November 2026", () => {
  assert.equal(offsetMinAt(at("2026-03-08T09:59:00Z"), PT), -480, "one minute before the jump");
  assert.equal(offsetMinAt(at("2026-03-08T10:00:00Z"), PT), -420, "the jump");
  assert.equal(offsetMinAt(at("2026-11-01T08:59:00Z"), PT), -420);
  assert.equal(offsetMinAt(at("2026-11-01T09:00:00Z"), PT), -480);
  assert.equal(clockIn(at("2026-03-08T09:59:00Z"), PT), "1:59 AM");
  assert.equal(clockIn(at("2026-03-08T10:00:00Z"), PT), "3:00 AM");
});

test("12 hour clock: midnight is 12:00 AM and noon is 12:00 PM", () => {
  assert.equal(clockIn(at("2026-11-04T08:00:00Z"), PT), "12:00 AM");
  assert.equal(clockIn(at("2026-11-04T20:00:00Z"), PT), "12:00 PM");
  assert.equal(clockIn(at("2026-11-04T17:00:00Z"), PK), "10:00 PM");
});

test("the zone name drops Standard and Daylight", () => {
  assert.equal(zoneName(PT, at("2026-01-15T12:00:00Z")), "Pacific Time");
  assert.equal(zoneName(PT, at("2026-07-15T12:00:00Z")), "Pacific Time");
  assert.match(zoneName(PK), /Pakistan/);
});

test("the Space reading comes first and the viewer's beside it: 9:00 AM Pacific is 10:00 PM in Karachi, a day on", () => {
  const now = at("2026-11-04T15:00:00Z");           // 7:00 AM Pacific, 8:00 PM Karachi
  const when = whenIn(at("2026-11-04T17:00:00Z"), now, { space: PT, viewer: PK });   // 9:00 AM Pacific today
  assert.equal(when.text, "9:00 AM");
  assert.equal(when.mine, "10:00 PM", "the same evening in Karachi, so no day word");
  const later = whenIn(at("2026-11-05T17:00:00Z"), now, { space: PT, viewer: PK });
  assert.equal(later.text, "Tomorrow 9:00 AM");
  assert.equal(later.mine, "10:00 PM", "the same date there, so no day word");
  const across = whenIn(at("2026-11-04T21:30:00Z"), now, { space: PT, viewer: PK });   // 1:30 PM Pacific, 2:30 AM Karachi next day
  assert.equal(across.text, "1:30 PM");
  assert.equal(across.mine, "Tomorrow 2:30 AM", "the viewer's day shows when it is not the Space's day");
});

test("a viewer in the Space's own zone, or on the same clock, sees no second reading", () => {
  const now = at("2026-11-04T15:00:00Z");
  assert.equal(whenIn(at("2026-11-04T17:00:00Z"), now, { space: PT, viewer: PT }).mine, undefined);
  assert.equal(whenIn(at("2026-11-04T17:00:00Z"), now, { space: PT, viewer: "US/Pacific" }).mine, undefined, "a link of the same zone: the same clock on every tzdata");
  // built from the runtime itself, so it holds on any tzdata: a zone this runtime puts on the same offset as the Space's reads no second time
  const same = zoneChoices(at("2026-11-04T17:00:00Z")).find((c) => c.zone !== PT && offsetMinAt(at("2026-11-04T17:00:00Z"), c.zone) === offsetMinAt(at("2026-11-04T17:00:00Z"), PT));
  assert.ok(same, "the runtime lists a zone on the Pacific offset");
  assert.equal(whenIn(at("2026-11-04T17:00:00Z"), now, { space: PT, viewer: same!.zone }).mine, undefined, `${same!.zone} has the Space's offset here`);
  assert.equal(whenIn(at("2026-11-04T17:00:00Z"), now, { space: PT, viewer: "America/Denver" }).mine, "10:00 AM");
});

test("daylight saving shifts the viewer's reading: the same Pacific 9:00 AM is 8:00 PM in London in winter and 5:00 PM in summer", () => {
  assert.equal(whenIn(at("2026-01-15T17:00:00Z"), at("2026-01-15T15:00:00Z"), { space: PT, viewer: "Europe/London" }).mine, "5:00 PM");
  assert.equal(whenIn(at("2026-07-15T16:00:00Z"), at("2026-07-15T14:00:00Z"), { space: PT, viewer: "Europe/London" }).mine, "5:00 PM");
  // a week with one zone already switched: Pacific is still on summer time on 1 Nov, Karachi never changes
  assert.equal(whenIn(at("2026-11-01T16:00:00Z"), at("2026-11-01T14:00:00Z"), { space: PT, viewer: PK }).mine, "9:00 PM");
  assert.equal(whenIn(at("2026-11-02T17:00:00Z"), at("2026-11-02T14:00:00Z"), { space: PT, viewer: PK }).mine, "10:00 PM");
});

test("hover names both zones and the full date", () => {
  const title = titleOf(at("2026-11-04T17:00:00Z"), { space: PT, viewer: PK });
  assert.match(title, /^Wed 4 Nov 2026, 9:00 AM Pacific Time\. Your time: Wed 4 Nov, 10:00 PM Pakistan/);
  assert.equal(titleOf(at("2026-11-04T17:00:00Z"), { space: PT, viewer: PT }), "Wed 4 Nov 2026, 9:00 AM Pacific Time");
});

test("day words are counted in the zone, so midnight edges land on the right day", () => {
  const now = at("2026-11-04T06:30:00Z");   // 10:30 PM on 3 Nov in Pacific, 11:30 AM on 4 Nov in Karachi
  assert.equal(dayWord(at("2026-11-04T07:30:00Z"), now, PT), "Today", "11:30 PM Pacific is still the 3rd");
  assert.equal(dayWord(at("2026-11-04T08:30:00Z"), now, PT), "Tomorrow");
  assert.equal(dayWord(at("2026-11-04T07:30:00Z"), now, PK), "Today");
});

test("a wall clock reading becomes an instant: normal, the skipped spring hour moves forward, the repeated fall hour takes the first", () => {
  assert.equal(instantOf("2026-11-07T18:00", PT), at("2026-11-08T02:00:00Z"));
  assert.equal(localInput(at("2026-11-08T02:00:00Z"), PT), "2026-11-07T18:00");
  assert.equal(clockIn(instantOf("2026-03-08T02:30", PT)!, PT), "3:30 AM", "2:30 AM does not exist on 8 March");
  assert.equal(instantOf("2026-11-01T01:30", PT), at("2026-11-01T08:30:00Z"), "1:30 AM happens twice on 1 November: the first");
  assert.equal(instantOf("nope", PT), null);
});

test("the picker lists cities with the time there, finds by city, name or id, and puts the zones in clock order", () => {
  const now = at("2026-11-04T22:28:00Z");
  const all = zoneChoices(now);
  const la = all.find((c) => c.zone === PT)!;
  assert.equal(la.label, "Pacific Time, Los Angeles, 2:28 PM");
  assert.equal(la.offset, "UTC-8");
  assert.ok(all.length > 20);
  for (let i = 1; i < all.length; i++) assert.ok(offsetMinAt(now, all[i - 1]!.zone) <= offsetMinAt(now, all[i]!.zone), "ordered by offset");
  assert.equal(all.filter((c) => zoneMatches(c, "los angeles")).some((c) => c.zone === PT), true);
  assert.equal(all.filter((c) => zoneMatches(c, "pacific")).some((c) => c.zone === PT), true);
  assert.equal(all.filter((c) => zoneMatches(c, "karachi")).length, 1);
});
