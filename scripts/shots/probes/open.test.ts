// The shared open-speed probe (ruling 43): a slow and a fast fake mount, the warm-up discard, the median of five, the worst, and a bad declaration.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs helpers without types
import { parseProbe, summarizeOpen, runOpenProbe, median, metricLine } from "./open.mjs";

const target = (probe: unknown) => ({ id: "P-X_01-open", route: "/m/P-X_01", waitFor: "[data-testid=x]", probe });

test("the first run is a warm-up: a slow first mount does not fail a fast screen", () => {
  const r = summarizeOpen([900, 80, 90, 85, 95, 88], 100);
  assert.equal(r.warmup_ms, 900);
  assert.equal(r.samples.length, 5);
  assert.equal(r.median_ms, 88);
  assert.equal(r.worst_ms, 95);
  assert.equal(r.ok, true);
});

test("one slow sample among five never fails; a slow median does", () => {
  assert.equal(summarizeOpen([50, 80, 80, 80, 80, 400], 100).ok, true);
  const slow = summarizeOpen([50, 150, 160, 170, 90, 180], 100);
  assert.equal(slow.median_ms, 160);
  assert.equal(slow.ok, false);
});

test("a mount that never appears is a breach, not a pass", () => {
  const r = summarizeOpen([80, 80, null, 80, 80, 80], 100);
  assert.equal(r.failed, true);
  assert.equal(r.ok, false);
});

test("runOpenProbe mounts the screen `runs` times through the fake mount: fast passes, slow fails", async () => {
  let calls = 0;
  const fast = await runOpenProbe(target({ kind: "open", budgetMs: 100, runs: 6 }), { time: async () => { calls += 1; return calls === 1 ? 500 : 60; } });
  assert.equal(calls, 6);
  assert.equal(fast.ok, true);
  assert.equal(fast.median_ms, 60);
  const slow = await runOpenProbe(target({ kind: "open", budgetMs: 100, runs: 6 }), { time: async () => 140 });
  assert.equal(slow.ok, false);
  assert.equal(slow.worst_ms, 140);
  assert.match(metricLine(slow), /"name":"open"/);
  assert.match(metricLine(slow), /"ok":false/);
});

test("a target without a probe is skipped; a bad declaration throws", async () => {
  assert.equal(parseProbe({ id: "a", route: "/", waitFor: "x" }), null);
  assert.equal(await runOpenProbe({ id: "a", route: "/", waitFor: "x" }, { time: async () => 1 }), null);
  assert.throws(() => parseProbe(target({ kind: "open", runs: 6 })), /budgetMs/);
  assert.throws(() => parseProbe(target({ kind: "open", budgetMs: 100, runs: 2 })), /runs/);
  assert.throws(() => parseProbe({ id: "a", route: "/", probe: { kind: "open", budgetMs: 100 } }), /waitFor/);
  assert.deepEqual(parseProbe(target({ kind: "open", budgetMs: 100 })), { budgetMs: 100, runs: 6 });
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(median([])));
});
