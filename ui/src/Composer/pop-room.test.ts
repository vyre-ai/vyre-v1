// Where a composer popover goes (F32): above when it fits there, else below when it fits there, else the larger side with a height limit; the pane's clipping edge is found, or the window.
import test from "node:test";
import assert from "node:assert/strict";
import { POP_GAP, clipBox, popPlacement } from "./pop-room.ts";

const base = { anchorTop: 400, anchorBottom: 450, paneTop: 38, paneBottom: 800 };

test("room above: the popover stays above the composer", () => {
  assert.deepEqual(popPlacement({ ...base, height: 300 }), { side: "above" });
});
test("room only below (a composer high in a short pane): it opens below", () => {
  assert.deepEqual(popPlacement({ ...base, anchorTop: 120, anchorBottom: 170, height: 300 }), { side: "below" });
});
test("room on neither side: the larger side, limited in height so it scrolls instead of being cut", () => {
  const r = popPlacement({ anchorTop: 300, anchorBottom: 350, paneTop: 38, paneBottom: 440, height: 500 });
  assert.deepEqual(r, { side: "above", maxHeight: 300 - 38 - POP_GAP }, "246 above beats 74 below");
  const small = popPlacement({ anchorTop: 100, anchorBottom: 150, paneTop: 38, paneBottom: 600, height: 700 });
  assert.deepEqual(small, { side: "below", maxHeight: 600 - 150 - POP_GAP });
});
test("a window with no clipping ancestor: the window", () => {
  assert.deepEqual(clipBox({ parentElement: null, getBoundingClientRect: () => ({ top: 0, bottom: 0 }) }), {
    top: 0,
    bottom: 0,
  });
});
