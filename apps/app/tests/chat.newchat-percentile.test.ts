// The new chat kit's percentile (the nearest-rank rule every budget walk reports by).
import test from "node:test";
import assert from "node:assert/strict";
import { pct } from "./chat.newchat-pct-kit.test.ts";

test("new chat kit: the percentile of ten runs is the slowest run (nearest rank), and an empty list has none", () => {
  assert.equal(pct([5, 1, 9, 3, 2, 8, 7, 4, 6, 10], 0.95), 10);
  assert.equal(pct([5, 1, 9, 3, 2, 8, 7, 4, 6, 10], 0.5), 5);
  assert.equal(pct([], 0.5), null);
});
