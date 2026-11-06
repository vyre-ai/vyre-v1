import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BODY_LEAD, BODY_PX, COLUMN, FACE, GAP_BETWEEN, GAP_WITHIN, GUTTER, GUTTER_MIN_WIDTH, RADIUS, ROW, countLabel, gapAbove, gutterFits, headerOf } from "./calm.ts";

describe("calm tokens", () => {
  test("the numbers are the design system's", () => {
    assert.deepEqual([RADIUS, COLUMN, FACE, ROW], [12, 680, 28, 32]);
    assert.equal(BODY_LEAD / BODY_PX, 1.6);
  });
  test("20 between people, 6 inside one person's run", () => {
    assert.equal(gapAbove(true), GAP_BETWEEN);
    assert.equal(gapAbove(false), GAP_WITHIN);
    assert.deepEqual([GAP_BETWEEN, GAP_WITHIN], [20, 6]);
  });
  test("only the first message of a run carries the full header", () => {
    assert.equal(headerOf(true), "full");
    assert.equal(headerOf(false), "hover-time");
  });
  test("the gutter needs the column plus a face on each side's margin", () => {
    assert.equal(GUTTER_MIN_WIDTH, COLUMN + 2 * (GUTTER + 8));
    assert.equal(gutterFits(GUTTER_MIN_WIDTH), true);
    assert.equal(gutterFits(GUTTER_MIN_WIDTH - 1), false);
    assert.equal(gutterFits(390), false);
  });
  test("goal progress is a muted count", () => {
    assert.equal(countLabel(212, 300), "212/300");
  });
});
