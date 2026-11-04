// fitInViewport: a card anchored anywhere, near any edge, ends fully inside the window.
import test from "node:test";
import assert from "node:assert/strict";
import { fitInViewport } from "./place.ts";

const WINDOWS = [{ viewW: 1440, viewH: 900 }, { viewW: 1280, viewH: 720 }, { viewW: 390, viewH: 844 }];

test("a card anchored near the bottom edge ends inside the viewport, at every window size and card height", () => {
  for (const { viewW, viewH } of WINDOWS) {
    for (const height of [120, 300, 420, 560, viewH - 16, viewH + 200]) {
      for (let y = 0; y <= viewH + 40; y += 20) {
        for (const x of [-20, 0, 8, viewW / 2, viewW - 100, viewW + 40]) {
          const width = Math.min(360, viewW - 16);
          const f = fitInViewport({ x, y, width, height, viewW, viewH });
          const h = Math.min(height, f.maxHeight);
          assert.ok(f.top >= 8, `top ${f.top} at y=${y}, h=${height}, ${viewW}x${viewH}`);
          assert.ok(f.top + h <= viewH - 8, `bottom ${f.top + h} at y=${y}, h=${height}, ${viewW}x${viewH}`);
          assert.ok(f.left >= 8 && f.left + width <= viewW - 8, `left ${f.left} at x=${x}, ${viewW}x${viewH}`);
        }
      }
    }
  }
});

test("a card with room below stays under its control; one without moves up by just enough", () => {
  assert.deepEqual(fitInViewport({ x: 100, y: 200, width: 360, height: 300, viewW: 1440, viewH: 900 }), { left: 100, top: 200, maxHeight: 884 });
  assert.equal(fitInViewport({ x: 100, y: 800, width: 360, height: 300, viewW: 1440, viewH: 900 }).top, 592, "bottom edge 8 px inside the window");
});

test("an unmeasured card (height 0) is limited by its maximum height, never by a stale size", () => {
  const f = fitInViewport({ x: 20, y: 850, width: 360, height: 0, viewW: 1440, viewH: 900 });
  assert.equal(f.maxHeight, 884);
  assert.equal(f.top, 850, "placed where asked until measured; the maximum height keeps its first frame inside after the clamp");
});

test("a very short window still gives the card a usable height", () => {
  assert.equal(fitInViewport({ x: 0, y: 0, width: 300, height: 400, viewW: 800, viewH: 200 }).maxHeight, 184);
  assert.ok(fitInViewport({ x: 0, y: 0, width: 300, height: 400, viewW: 800, viewH: 100 }).maxHeight >= 120);
});
