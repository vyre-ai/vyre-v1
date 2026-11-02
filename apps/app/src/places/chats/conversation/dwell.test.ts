import test from "node:test";
import assert from "node:assert/strict";
import { DWELL_MS, waitFor } from "./dwell.ts";

test("a label on screen stays 4 s: a change 0.5 s in waits 3.5 s, one past the window shows now, so changes inside the window collapse to one swap to the newest", () => {
  assert.equal(DWELL_MS, 4000);
  assert.equal(waitFor(0, 500), 3500);
  assert.equal(waitFor(0, 3999), 1);
  assert.equal(waitFor(0, 4200), 0);
});

test("a step that does appear is on screen at least a second: the dwell is the floor, far above it", () => {
  assert.ok(DWELL_MS >= 1000);
});
