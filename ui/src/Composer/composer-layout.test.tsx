// The composer lays its controls under the field when it is narrow (its own width, not the window's), and keeps one row above that.
// The controls' vertical centres agreeing within 1 px is measured in a real browser: node scripts/shots/l-editor-composer.mjs (exits 1 when any width is off).
import test from "node:test";
import assert from "node:assert/strict";
import { isStacked } from "./index.tsx";

test("below 560 px of its own width the controls sit under the field; from 560 up they share one row with it", () => {
  for (const w of [390 - 48, 480, 559]) assert.equal(isStacked(w), true, String(w));
  for (const w of [560, 652, 1100]) assert.equal(isStacked(w), false, String(w));
  assert.equal(isStacked(0), false, "unmeasured: the single row, never a flash of two");
});
