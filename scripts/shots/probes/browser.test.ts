// The browser probe runner (ruling 43): warm-up discard, median of five, worst, min/max sense, no loosening, missing values fail.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs helpers without types
import { parseProbes, summarize, runTarget, budgetTable, metricLine, verdictLine } from "./browser.mjs";

const table = budgetTable({ budgets: [
  { id: "navigate", p95: 100, unit: "ms" }, { id: "prefetch", p95: 90, unit: "percent" }, { id: "layout_shift", p95: 0, unit: "cls" }, { id: "chat_open", p95: 100, unit: "ms" },
] });
const target = (probes: unknown) => ({ id: "P-X_01-nav", route: "/m/P-X_01", waitFor: "[data-testid=x]", probes });

test("the first mount is a warm-up and one slow sample among five does not fail", () => {
  const r = summarize([900, 60, 70, 65, 400, 75], { limit: 100, sense: "max" });
  assert.equal(r.warmup, 900);
  assert.equal(r.median, 70);
  assert.equal(r.worst, 400);
  assert.equal(r.ok, true);
});

test("a slow median fails; prefetch fails below its floor and passes above it", () => {
  assert.equal(summarize([1, 120, 130, 140, 90, 150], { limit: 100, sense: "max" }).ok, false);
  assert.equal(summarize([0, 95, 92, 91, 99, 100], { limit: 90, sense: "min" }).ok, true);
  const low = summarize([0, 80, 85, 70, 91, 60], { limit: 90, sense: "min" });
  assert.equal(low.ok, false);
  assert.equal(low.worst, 60);
});

test("layout_shift needs a median of exactly zero", () => {
  assert.equal(summarize([0.3, 0, 0, 0, 0.2, 0], { limit: 0, sense: "max" }).ok, true);
  assert.equal(summarize([0, 0.1, 0.1, 0.1, 0, 0], { limit: 0, sense: "max" }).ok, false);
});

test("a missing value is a breach", () => {
  assert.equal(summarize([5, 5, undefined, 5, 5, 5], { limit: 100, sense: "max" }).ok, false);
});

test("a declared budget may tighten but never loosen", () => {
  assert.equal(parseProbes(target({ navigate: { budget: 80 } }), table)[0].limit, 80);
  assert.throws(() => parseProbes(target({ navigate: { budget: 150 } }), table), /loosens/);
  assert.throws(() => parseProbes(target({ prefetch: { budget: 50 } }), table), /loosens/);
  assert.throws(() => parseProbes(target({ nope: {} }), table), /unknown probe kind/);
  assert.throws(() => parseProbes(target({ navigate: { runs: 2 } }), table), /runs/);
  assert.throws(() => parseProbes({ id: "a", route: "/", probes: { navigate: {} } }, table), /waitFor/);
  assert.deepEqual(parseProbes({ id: "a", route: "/" }, table), []);
});

test("runTarget mounts fresh runs times and judges every declared kind from window.__probes", async () => {
  let calls = 0;
  const rs = await runTarget(target({ navigate: {}, prefetch: {}, chat_open: {} }), table, {
    measure: async () => { calls += 1; return { navigate: calls === 1 ? 500 : 60, prefetch: 95, chat_open: 130, ready: true }; },
  });
  assert.equal(calls, 6);
  assert.deepEqual(rs.map((r: { kind: string; ok: boolean }) => [r.kind, r.ok]), [["navigate", true], ["prefetch", true], ["chat_open", false]]);
  assert.match(metricLine(rs[2]), /"name":"probe_chat_open"/);
  assert.match(verdictLine(rs[2]), /OVER BUDGET/);
});
