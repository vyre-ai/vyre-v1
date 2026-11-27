// A staggered scheduler spreads jobs that are added together over up to a minute after their interval, the same way on every start; a plain one keeps nextAt exactly now + everyMs.
import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler, STAGGER_MS, nameHash } from "../src/scheduler/index.ts";

const NAMES = Array.from({ length: 50 }, (_, i) => `hook.module${i}.job`);
const phases = (stagger: boolean): number[] => {
  let t = 1_000_000;
  const s = new Scheduler({ now: () => t, stagger });
  for (const n of NAMES) s.add({ name: n, schedule: { everyMs: 600_000 }, run: () => undefined });
  return s.status().map((j) => j.nextAt - (t + 600_000));
};

test("without stagger every job is due exactly at now + everyMs", () => {
  assert.ok(phases(false).every((p) => p === 0));
});

test("with stagger fifty jobs of one interval fall due over the minute after it, not in one second, and the same way on every start", () => {
  const a = phases(true);
  assert.deepEqual(phases(true), a, "stable");
  assert.ok(a.every((p) => p >= 0 && p < STAGGER_MS));
  const seconds = new Set(a.map((p) => Math.floor(p / 1000)));
  assert.ok(seconds.size >= 25, `spread over ${seconds.size} different seconds`);
  assert.ok(Math.max(...Object.values(Object.groupBy(a, (p) => Math.floor(p / 1000))).map((g) => g?.length ?? 0)) <= 4, "no second holds more than four of them");
  assert.equal(nameHash("x") === nameHash("x"), true);
});

test("an immediate job and a short interval keep their meaning under stagger", () => {
  let t = 5_000;
  const s = new Scheduler({ now: () => t, stagger: true });
  s.add({ name: "now", schedule: { everyMs: 600_000, immediate: true }, run: () => undefined });
  s.add({ name: "fast", schedule: { everyMs: 1000 }, run: () => undefined });
  const st = Object.fromEntries(s.status().map((j) => [j.name, j.nextAt]));
  assert.equal(st["now"], 5_000);
  assert.ok(st["fast"]! >= 6_000 && st["fast"]! < 7_000, "a 1 s job gets at most 1 s of phase");
});

test("a tick that starts several jobs gives the event loop a turn between them", async () => {
  let t = 0;
  const s = new Scheduler({ now: () => t });
  const order: string[] = [];
  for (const n of ["a", "b", "c"]) s.add({ name: n, schedule: { everyMs: 10 }, run: () => void order.push(n) });
  t = 100;
  let turns = 0;
  const timer = setImmediate(function again() {
    turns++;
    if (turns < 50) setImmediate(again);
  });
  void timer;
  await s.tick();
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.ok(turns >= 2, `the loop turned ${turns} times during the tick`);
});
