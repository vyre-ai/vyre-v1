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

test("the one-line pill keeps its field at least 120 px wide and the model menu fills a composer narrower than 540 px", async () => {
  const { FIELD_MIN_LINE, PANEL_SIDE_MIN, panelFitsInline } = await import("./index.tsx");
  assert.equal(FIELD_MIN_LINE, 120);
  assert.equal(PANEL_SIDE_MIN, 540);
  for (const w of [300, 400, 539]) assert.equal(panelFitsInline(w), true, String(w));
  for (const w of [540, 700]) assert.equal(panelFitsInline(w), false, String(w));
  assert.equal(panelFitsInline(0), false, "unmeasured: the side lists");
});

test("a field is capped at about seven lines and a third of a short window, and a draft of two lines is a multi-line draft", async () => {
  const { fieldCap, MULTI_LINE } = await import("./index.tsx");
  assert.equal(fieldCap(900), 168);
  assert.equal(fieldCap(400), 120);
  assert.equal(fieldCap(100), 66);
  assert.equal(fieldCap(0), 168);
  assert.ok(MULTI_LINE > 22 && MULTI_LINE < 44, "a second line (44 px) counts, one line (22 px) does not");
});
