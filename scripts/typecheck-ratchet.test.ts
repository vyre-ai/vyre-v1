import test from "node:test";
import assert from "node:assert/strict";
import { countErrors, judge } from "./typecheck-ratchet.ts";

test("errors are counted per line, module-not-found ones are not", () => {
  const out = ["a.ts(1,1): error TS2322: x", "a.ts(2,1): error TS2307: Cannot find module", "b.tsx(3,4): error TS7016: no declaration", "b.tsx(9,9): error TS2339: y", "  continuation line"].join("\n");
  assert.equal(countErrors(out), 2);
});

test("more errors than the baseline fail; fewer pass and offer the lower count", () => {
  assert.equal(judge(11, 10).ok, false);
  assert.deepEqual([judge(10, 10).ok, judge(10, 10).lower], [true, false]);
  assert.deepEqual([judge(9, 10).ok, judge(9, 10).lower], [true, true]);
});
