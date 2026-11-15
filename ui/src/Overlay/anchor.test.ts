import test from "node:test";
import assert from "node:assert/strict";
import { placeBeside, placeNear } from "./anchor.ts";

const win = { width: 1000, height: 700 };
const card = { width: 220, height: 80 };
const at = (left: number, top: number, w = 60, h = 14) => ({ left, top, right: left + w, bottom: top + h });

test("under the trigger, left edges aligned", () => {
  assert.deepEqual(placeNear(at(300, 200), card, win), { left: 300, top: 220, above: false });
});

test("no room below: above the trigger", () => {
  assert.deepEqual(placeNear(at(300, 640), card, win), { left: 300, top: 640 - 6 - 80, above: true });
});

test("kept inside the window by 8 px on the left and on the right", () => {
  assert.equal(placeNear(at(2, 200), card, win).left, 8);
  assert.equal(placeNear(at(950, 200), card, win).left, 1000 - 220 - 8);
});

test("no room above or below (a short window): clamped inside, never off the edge", () => {
  const r = placeNear(at(300, 50), card, { width: 1000, height: 120 });
  assert.ok(r.top >= 8 && r.top + 80 <= 120 - 8 + 0.001, JSON.stringify(r));
});

test("beside: the card touches the trigger's right edge and lines up with its top", () => {
  assert.deepEqual(placeBeside(at(100, 300, 380, 40), { width: 320, height: 200 }, win), {
    left: 480,
    top: 300,
    side: "right",
  });
});

test("beside: no room on the right, it flips to the left edge of the trigger", () => {
  assert.deepEqual(placeBeside(at(500, 300, 380, 40), { width: 320, height: 200 }, win), {
    left: 180,
    top: 300,
    side: "left",
  });
});

test("beside: near the bottom it shifts up only as far as needed to stay inside the window", () => {
  const r = placeBeside(at(100, 600, 380, 40), { width: 320, height: 200 }, win);
  assert.deepEqual([r.left, r.top], [480, 700 - 200 - 8]);
});
