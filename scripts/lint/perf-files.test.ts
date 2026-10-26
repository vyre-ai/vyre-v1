import test from "node:test";
import assert from "node:assert/strict";
import { checkPerfFile, topLevelTests } from "./perf-files.ts";

const src = [
  'import test from "node:test";',
  'test("perf boot: median under 100 ms", () => { const t0 = performance.now(); work(); assert.ok(performance.now() - t0 < 100); });',
  'test("the shape is frozen", () => { assert.equal(shape(), "abc"); });',
  'test("p95 under 50 ms", () => { assert.ok(p95 < 50); });',
  'test("later work", { todo: "not yet" }, () => { assert.fail("x"); });',
].join("\n");

test("perf-files: a test without a timing or budget assertion in a perf file is a finding with its line", () => {
  const hits = checkPerfFile("a.perf.test.ts", src);
  assert.deepEqual(hits.map((h) => [h.line, h.test]), [[3, "the shape is frozen"]]);
});

test("perf-files: tests are found by name and line; todo and skip tests are not judged", () => {
  const ts = topLevelTests(src);
  assert.deepEqual(ts.map((t) => t.name), ["perf boot: median under 100 ms", "the shape is frozen", "p95 under 50 ms", "later work"]);
  assert.equal(ts[3]!.parked, true);
  assert.deepEqual(checkPerfFile("b.test.ts", 'test("fast and correct", () => { assert.equal(1, 1); });'), [{ file: "b.test.ts", line: 1, test: "fast and correct" }]);
});
