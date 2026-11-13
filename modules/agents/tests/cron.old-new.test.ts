// A routine saved on a live Space keeps its meaning (review of 13 Nov 2026): the routine cron reader that replaced the old one is compared with it over a generated set of expressions, accepting and answering.
// Any difference is a failure unless it is listed in NAMED below with its sentence. Method: the reviewer's, 60,023 expressions; here a seeded set so the test is the same every run.
import test from "node:test";
import assert from "node:assert/strict";
import { nextRun, parseCron } from "../projections.ts";
import { oldNextRun, oldParse } from "./old-cron-kit.test.ts";

/** Differences allowed, by expression, each with why. None today: the reader keeps every reading it had. */
const NAMED: Record<string, string> = {};

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const r = rng(13112026);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const num = (max: number): string => String(Math.floor(r() * (max + 2)));
function item(max: number): string {
  const kind = r();
  if (kind < 0.25) return "*";
  if (kind < 0.4) return `*/${num(5)}`;
  if (kind < 0.6) return num(max);
  if (kind < 0.8) return `${num(max)}-${num(max)}`;
  if (kind < 0.9) return `${num(max)}/${num(4)}`;
  return `${num(max)}-${num(max)}/${num(3)}`;
}
function field(max: number): string {
  const n = r() < 0.7 ? 1 : 2 + Math.floor(r() * 2);
  return Array.from({ length: n }, () => item(max)).join(",");
}
const HAND = [
  "0 9 * * 0-7",
  "0 9 * * 7/2",
  "5 * * * 7-0",
  "0 9 15 * *,1",
  "0 9 15 * 1,*",
  "0 9 * * 1-7",
  "0 9 * * 07",
  "0 9 * * 7",
  "0 9 * * 6,7",
  "0 9 * * 1,7",
  "0 9 * * 5-7",
  "0 9 * * */7",
  "5 4 * * sun",
  "@daily",
  "",
  "0 9 * *",
];
const set = new Set<string>(HAND);
while (set.size < 20000) set.add(`${field(59)} ${field(23)} ${field(31)} ${field(12)} ${field(7)}`);
const STARTS = [
  Date.UTC(2026, 0, 5, 9, 1, 30),
  Date.UTC(2026, 2, 7, 23, 59),
  Date.UTC(2026, 10, 1, 4, 30),
  Date.UTC(2028, 1, 28, 12),
  Date.UTC(2026, 6, 15, 0, 0, 0),
];

test("a routine cron reads as it always did: the same expressions are accepted and give the same next time", () => {
  let accepted = 0;
  for (const expr of set) {
    const oldOk = oldParse(expr) !== null;
    const newOk = parseCron(expr) !== null;
    if (NAMED[expr] !== undefined) continue;
    assert.equal(newOk, oldOk, `"${expr}" is ${oldOk ? "accepted" : "refused"} by the old reader`);
    if (!oldOk) continue;
    accepted += 1;
    for (const at of STARTS)
      assert.equal(nextRun(expr, at), oldNextRun(expr, at), `"${expr}" after ${new Date(at).toISOString()}`);
  }
  assert.ok(accepted > 2000, `the set held ${accepted} accepted expressions`);
});

test("the readings the review found stay as they were (and an open step in the weekday field stops at 6)", () => {
  const at = Date.UTC(2026, 10, 12, 12); // Thursday 12 Nov 2026
  assert.equal(nextRun("0 9 * * 0-7", at), Date.UTC(2026, 10, 15, 9), "0-7 is Sunday only (it was never every day)");
  assert.equal(
    nextRun("0 9 * * 7/2", at),
    Date.UTC(2026, 10, 14, 9),
    "7/2 is Sunday, Tuesday, Thursday and Saturday: next is Saturday",
  );
  assert.ok(nextRun("5 * * * 7-0", at) !== null, "7-0 is still accepted (Sunday)");
  assert.equal(
    nextRun("0 9 15 * 1,*", at),
    Date.UTC(2026, 10, 13, 9),
    "a * in a list is every value but does not make the field any day: the other day field counts, either matches",
  );
  assert.equal(parseCron("0 9 * * 1-7"), null, "1-7 was refused and still is");
  assert.equal(
    nextRun("0 9 * * 1/3", Date.UTC(2026, 10, 12, 12)),
    Date.UTC(2026, 10, 16, 9),
    "1/3 is Monday and Thursday (1 and 4), Sunday is not added: next after Thursday noon is Monday",
  );
});
