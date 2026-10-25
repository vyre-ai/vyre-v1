import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkSlow, MAX_ENTRIES } from "./slow-check.ts";

const entry = (i: number) => ({ file: `x/f${i}.test.ts`, capSec: 60, owner: "L1", reason: "100k row snapshot", heavy: i % 2 === 0 });
const list = (n: number) => Array.from({ length: n }, (_, i) => entry(i));

test("twenty entries pass, the twenty-first fails", () => {
  assert.deepEqual(checkSlow(list(MAX_ENTRIES)), []);
  const p = checkSlow(list(MAX_ENTRIES + 1));
  assert.equal(p.length, 1);
  assert.match(p[0], /21 entries, the cap is 20/);
});
test("capSec over 120, missing owner or reason, duplicates and non-test files fail", () => {
  assert.match(checkSlow([{ ...entry(1), capSec: 121 }])[0], /capSec/);
  assert.match(checkSlow([{ ...entry(1), owner: "" }])[0], /owner/);
  assert.match(checkSlow([{ ...entry(1), reason: undefined }])[0], /reason/);
  assert.match(checkSlow([entry(1), entry(1)])[0], /listed twice/);
  assert.match(checkSlow([{ ...entry(1), file: "x/helper.ts" }])[0], /test file/);
  assert.match(checkSlow({})[0], /array/);
});
test("the committed test/slow.json is valid", () => {
  const live = JSON.parse(fs.readFileSync(new URL("../test/slow.json", import.meta.url), "utf8"));
  assert.deepEqual(checkSlow(live), []);
});

test("perf entries are not counted against the cap", () => {
  const perf = Array.from({ length: 30 }, (_, i) => ({ file: `p${i}.perf.test.ts`, capSec: 120, owner: "t", reason: "t", perf: true }));
  assert.deepEqual(checkSlow([...list(MAX_ENTRIES), ...perf]), []);
});
