// The Board and Timeline keys: what a key means, where an arrow lands, and which card takes Tab.
import test from "node:test";
import assert from "node:assert/strict";
import { gridStep, rowStep, tabStop, taskKey } from "./keys.ts";

test("arrows move, Enter opens, Space or S changes status, Esc lets go, and Cmd or Ctrl keys are left alone", () => {
  assert.deepEqual(taskKey({ key: "ArrowLeft" }), { t: "move", dir: "left" });
  assert.deepEqual(taskKey({ key: "Enter" }), { t: "open" });
  assert.deepEqual(taskKey({ key: " " }), { t: "status" });
  assert.deepEqual(taskKey({ key: "s" }), { t: "status" });
  assert.deepEqual(taskKey({ key: "Escape" }), { t: "close" });
  assert.equal(taskKey({ key: "Enter", metaKey: true }), null);
  assert.equal(taskKey({ key: "x" }), null);
});

test("on the board, up and down walk a column and left and right cross to the next column that holds a card", () => {
  const cols = [["a1", "a2", "a3"], [], ["c1", "c2"], ["d1"]];
  assert.equal(gridStep(cols, "a1", "down"), "a2");
  assert.equal(gridStep(cols, "a3", "down"), null);
  assert.equal(gridStep(cols, "a1", "up"), null);
  assert.equal(gridStep(cols, "a2", "right"), "c2", "the empty column is skipped, the same height is kept");
  assert.equal(gridStep(cols, "a3", "right"), "c2", "the last card when the next column is shorter");
  assert.equal(gridStep(cols, "c1", "left"), "a1");
  assert.equal(gridStep(cols, "d1", "right"), null);
  assert.equal(gridStep(cols, null, "down"), "a1");
});

test("on the timeline, up and down walk the rows; left and right do nothing", () => {
  assert.equal(rowStep(["r1", "r2", "r3"], "r1", "down"), "r2");
  assert.equal(rowStep(["r1", "r2", "r3"], "r3", "down"), null);
  assert.equal(rowStep(["r1", "r2", "r3"], "r2", "up"), "r1");
  assert.equal(rowStep(["r1", "r2", "r3"], "r2", "left"), null);
});

test("exactly one card takes Tab: the active one while it is there, else the first", () => {
  const cols = [[], ["b1", "b2"], ["c1"]];
  assert.equal(tabStop(cols, null), "b1");
  assert.equal(tabStop(cols, "c1"), "c1");
  assert.equal(tabStop(cols, "gone"), "b1");
  assert.equal(tabStop([[], []], null), null);
});
