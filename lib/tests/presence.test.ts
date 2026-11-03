// When a message to a teammate may go (lib/presence.ts): presence through one adapter, hours in their zone, away, urgent, next online, the end of their day.
import test from "node:test";
import assert from "node:assert/strict";
import { dueAt, dueWords, endOfDay, inHours, nextInHours, readPresence, readPublicTime } from "../presence.ts";

const THU_0853Z = Date.UTC(2025, 9, 9, 8, 53);
const office = { timezone: "UTC", hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" } };
const on = { personId: "usr_maya", state: "online" as const };

test("presence comes from devices.presence; a server without it says unknown, never a guess", async () => {
  const got = await readPresence(async () => ({ people: [{ personId: "usr_maya", state: "away", awayUntil: 5 }, { personId: "usr_x", state: "online" }] }), ["usr_maya", "usr_leo"]);
  assert.deepEqual(got.get("usr_maya"), { personId: "usr_maya", state: "away", awayUntil: 5 });
  assert.equal(got.get("usr_leo")?.state, "unknown");
  assert.equal(got.has("usr_x"), false, "only the people asked about");
  const none = await readPresence(async () => { throw new Error("no such capability"); }, ["usr_maya"]);
  assert.equal(none.get("usr_maya")?.state, "unknown");
});

test("hours are the teammate's own: an unknown zone or malformed hours are dropped", async () => {
  assert.deepEqual(await readPublicTime(async () => ({ timezone: "Asia/Karachi", hours: { days: [1, 2], from: "09:00", to: "17:00" } }), "usr_maya"), { timezone: "Asia/Karachi", hours: { days: [1, 2], from: "09:00", to: "17:00" } });
  assert.deepEqual(await readPublicTime(async () => ({ timezone: "Mars/Olympus", hours: { from: "9" } }), "usr_maya"), {});
  assert.deepEqual(await readPublicTime(async () => { throw new Error("x"); }, "usr_maya"), {});
});

test("in hours, in their zone; an overnight shift belongs to the day it starts", () => {
  assert.equal(inHours(office, THU_0853Z), false);
  assert.equal(inHours(office, THU_0853Z + 10 * 60_000), true);
  assert.equal(inHours({ timezone: "Asia/Karachi", hours: office.hours }, THU_0853Z), true, "13:53 in Karachi");
  const night = { timezone: "UTC", hours: { days: [4], from: "22:00", to: "06:00" } };
  assert.equal(inHours(night, Date.UTC(2025, 9, 9, 23, 0)), true);
  assert.equal(inHours(night, Date.UTC(2025, 9, 10, 2, 0)), true, "Friday 02:00 is Thursday's shift");
  assert.equal(inHours(night, Date.UTC(2025, 9, 10, 23, 0)), false);
  assert.equal(inHours({}, THU_0853Z), true, "no hours set: any time");
  assert.equal(nextInHours(office, THU_0853Z), Date.UTC(2025, 9, 9, 9, 0));
  assert.equal(nextInHours(office, Date.UTC(2025, 9, 10, 18, 0)), Date.UTC(2025, 9, 13, 9, 0), "Friday evening waits for Monday");
  assert.equal(nextInHours({ hours: { days: [], from: "09:00", to: "17:00" } }, THU_0853Z), null);
});

test("when it goes: now; a time picked; away until back; outside hours; urgent skips both; next online", () => {
  const now = THU_0853Z + 3_600_000;   // 09:53, in hours
  assert.deepEqual(dueAt({ timing: "now", presence: on, time: office, now }), { at: now });
  assert.deepEqual(dueAt({ timing: "at", at: now + 600_000, presence: on, time: office, now }), { at: now + 600_000, reason: "later" });
  assert.deepEqual(dueAt({ timing: "now", presence: { ...on, state: "away", awayUntil: now + 60_000 }, time: office, now }), { at: now + 60_000, reason: "away" });
  assert.deepEqual(dueAt({ timing: "now", presence: { ...on, state: "away" }, time: office, now }), { at: null, reason: "away" }, "away with no end: when they are back");
  assert.deepEqual(dueAt({ timing: "now", presence: on, time: office, now: THU_0853Z }), { at: Date.UTC(2025, 9, 9, 9, 0), reason: "after_hours" });
  assert.deepEqual(dueAt({ timing: "now", urgent: true, presence: { ...on, state: "away" }, time: office, now: THU_0853Z }), { at: THU_0853Z });
  assert.deepEqual(dueAt({ timing: "online", presence: { ...on, state: "offline" }, time: office, now }), { at: null, reason: "offline" });
  assert.deepEqual(dueAt({ timing: "online", presence: { ...on, state: "unknown" }, time: office, now }), { at: now }, "nobody knows: nothing waits for it");
  assert.equal(dueWords({ at: Date.UTC(2025, 9, 9, 9, 0), reason: "after_hours" }, "Maya Chen", "UTC", THU_0853Z), "9:00 AM their time (it is outside Maya's working hours)");
  assert.equal(dueWords({ at: Date.UTC(2025, 9, 13, 9, 0), reason: "after_hours" }, "Maya Chen", "UTC", THU_0853Z), "Mon 9:00 AM their time (it is outside Maya's working hours)");
  assert.equal(dueWords({ at: null, reason: "offline" }, "Maya Chen", undefined, THU_0853Z), "when Maya is next online (Maya is offline)");
});

test("the end of the day is local midnight in their zone", () => {
  assert.equal(endOfDay(THU_0853Z, "UTC"), Date.UTC(2025, 9, 10, 0, 0));
  assert.equal(endOfDay(THU_0853Z, "Asia/Karachi"), Date.UTC(2025, 9, 9, 19, 0), "midnight in Karachi is 19:00 UTC");
});
