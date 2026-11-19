// Mapping the agent's point onto the live view (desk-pointer.ts): the same fit the view uses, bars and all, and a cursor that fades.
import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_SHOWN_MS, drawnAt, showsCursor } from "./desk-pointer.ts";

const P = { seq: 1, tool: "chrome_click", x: 640, y: 400, at: 1000 };
test("a point in the middle of the page is the middle of the picture, in a box of the page's own shape and in one with bars at the sides or above", () => {
  assert.deepEqual(drawnAt(P, { width: 1280, height: 800 }), { x: 640, y: 400 });
  assert.deepEqual(drawnAt(P, { width: 1600, height: 800 }), { x: 800, y: 400 });
  assert.deepEqual(drawnAt(P, { width: 640, height: 600 }), { x: 320, y: 300 });
});
test("the page's corners land on the picture's corners, not on the bars", () => {
  assert.deepEqual(drawnAt({ ...P, x: 0, y: 0 }, { width: 1600, height: 800 }), { x: 160, y: 0 });
  assert.deepEqual(drawnAt({ ...P, x: 1280, y: 800 }, { width: 640, height: 600 }), { x: 640, y: 500 });
});
test("the chosen element's box is scaled with the page and kept at least 4 px; the label rides along", () => {
  const d = drawnAt({ ...P, box: { x: 100, y: 200, w: 640, h: 2 }, label: "Send" }, { width: 640, height: 400 });
  assert.deepEqual(d, { x: 320, y: 200, ring: { left: 50, top: 100, width: 320, height: 4 }, label: "Send" });
});
test("an unmeasured box draws nothing, and a cursor shows only for a few seconds after the last action", () => {
  assert.equal(drawnAt(P, { width: 0, height: 0 }), null);
  assert.equal(showsCursor(null, 5000), false);
  assert.equal(showsCursor(P, P.at + CURSOR_SHOWN_MS - 1), true);
  assert.equal(showsCursor(P, P.at + CURSOR_SHOWN_MS), false);
});
