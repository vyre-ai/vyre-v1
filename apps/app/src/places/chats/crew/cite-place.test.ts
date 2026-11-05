// Where the citation card opens (owner, 5 Nov 2026): above the chip with a gap when its real height fits, below when it does not, the side with more room when neither fits, and always inside the viewport.
import test from "node:test";
import assert from "node:assert/strict";
import { cardPlace } from "./cite.tsx";

const view = { w: 1440, h: 900 };

test("room above: the card opens above the chip", () => {
  assert.equal(cardPlace({ top: 400, bottom: 419, left: 600 }, { w: 262, h: 110 }, view).side, "above");
});

test("no room above: it opens below", () => {
  assert.equal(cardPlace({ top: 60, bottom: 79, left: 600 }, { w: 262, h: 110 }, view).side, "below");
});

test("a tall card with room on neither side takes the larger side", () => {
  assert.equal(cardPlace({ top: 300, bottom: 319, left: 600 }, { w: 262, h: 700 }, view).side, "below");
  assert.equal(cardPlace({ top: 600, bottom: 619, left: 600 }, { w: 262, h: 700 }, view).side, "above");
});

test("it stays inside the viewport sideways", () => {
  const right = cardPlace({ top: 400, bottom: 419, left: 1400 }, { w: 262, h: 110 }, view);
  assert.equal(1400 + right.left + 262 <= 1440 - 8, true);
  const left = cardPlace({ top: 400, bottom: 419, left: 2 }, { w: 262, h: 110 }, view);
  assert.equal(2 + left.left >= 8, true);
});
