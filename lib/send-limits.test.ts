// The pure rules behind the Space sending limits (lib/send-limits.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, DEFAULT_LIMITS, MINUTE, nextOpen, planSend, throttleSlot } from "./send-limits.ts";

const T = Date.UTC(2025, 9, 9, 8, 53, 0);   // Thursday 08:53 UTC
const base = { now: T, wanted: T, zone: "UTC", limits: { ...DEFAULT_LIMITS, cap: 3, perMinute: 2 }, ticks: [] as number[], bulk: true };

test("the window opens at the first quarter hour its hours allow in the zone, and 'any' is always open", () => {
  assert.equal(nextOpen(T, "UTC", "8-20"), T);
  assert.equal(nextOpen(Date.UTC(2025, 9, 9, 21, 0, 0), "UTC", "8-20"), Date.UTC(2025, 9, 10, 8, 0, 0));
  assert.equal(nextOpen(Date.UTC(2025, 9, 9, 2, 0, 0), "Asia/Kolkata", "9-17"), Date.UTC(2025, 9, 9, 3, 30, 0), "09:00 in India is 03:30 UTC");
  assert.equal(nextOpen(Date.UTC(2025, 9, 9, 23, 0, 0), "UTC", "any"), Date.UTC(2025, 9, 9, 23, 0, 0));
});

test("a full minute pushes to the start of the next one that has room", () => {
  const m = Math.floor(T / MINUTE) * MINUTE;
  assert.equal(throttleSlot([], T, 2), T);
  assert.equal(throttleSlot([m, m + 1], T, 2), m + MINUTE);
  assert.equal(throttleSlot([m, m + 1, m + MINUTE, m + MINUTE + 5], T, 2), m + 2 * MINUTE);
});

test("the daily limit refuses with the time the oldest message inside the day leaves it", () => {
  const plan = planSend({ ...base, ticks: [T - 5 * 3_600_000, T - 3_600_000, T - 60_000] });
  assert.deepEqual(plan, { ok: false, reason: "send_cap_reached", limit: 3, resetAt: T - 5 * 3_600_000 + DAY });
  assert.equal(planSend({ ...base, ticks: [T - DAY - 1, T - 3_600_000] }).ok, true, "a message older than a day no longer counts");
});

test("window and speed hold an automation but not a person, and say which held it", () => {
  const night = Date.UTC(2025, 9, 9, 22, 0, 0);
  assert.deepEqual(planSend({ ...base, now: night, wanted: night }), { ok: true, at: Date.UTC(2025, 9, 10, 8, 0, 0), held: "window" });
  assert.deepEqual(planSend({ ...base, now: night, wanted: night, bulk: false }), { ok: true, at: night, held: null });
  const m = Math.floor(T / MINUTE) * MINUTE;
  assert.deepEqual(planSend({ ...base, ticks: [m, m + 1] }), { ok: true, at: m + MINUTE, held: "throttle" });
});
