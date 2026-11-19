// @tsx
// The alive line and the Still need these card (lane r42-alive): the words are built from counts, never a zero, and say which day the line reaches back to.
import test from "node:test";
import assert from "node:assert/strict";
import { aliveWords, sinceWords } from "./Living.tsx";

const NOW = Date.UTC(2026, 10, 19, 10);
const DAY = 86_400_000;

test("the alive line names only what happened", () => {
  const items = (n: number) => Array.from({ length: n }, () => ({})) as never;
  assert.equal(aliveWords({ items: items(3), fresh: 2 }), "3 put away, 2 new for you");
  assert.equal(aliveWords({ items: items(1), fresh: 0 }), "1 put away");
  assert.equal(aliveWords({ items: items(0), fresh: 4 }), "4 new for you");
  assert.equal(aliveWords({ items: items(0), fresh: 0 }), "");
});

test("it says which day it reaches back to", () => {
  assert.equal(sinceWords(NOW - 2 * 3_600_000, NOW), "Since this morning");
  assert.match(sinceWords(NOW - 3 * DAY, NOW), /^Since (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w{3}$/);
});
