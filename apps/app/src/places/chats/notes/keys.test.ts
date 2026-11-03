// Notes, the keys: single keys on a selected card, the page keys, Esc and Cmd-Enter over the layers, and the arrows moving by where the cards sit.
import test from "node:test";
import assert from "node:assert/strict";
import { cardKey, layerKey, nearest, pageKey, topLayer } from "./keys.ts";
import type { Box } from "./keys.ts";

const k = (key: string, o: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({ key, ...o });

test("a selected card: arrows move, Enter or Space opens, P L S A T R act, Delete deletes, Shift F10 opens the menu", () => {
  assert.deepEqual(cardKey(k("ArrowRight")), { t: "move", dir: "right" });
  assert.deepEqual(cardKey(k("ArrowUp")), { t: "move", dir: "up" });
  assert.deepEqual(cardKey(k("Enter")), { t: "open" });
  assert.deepEqual(cardKey(k(" ")), { t: "open" });
  for (const [key, t] of [["p", "pin"], ["l", "labels"], ["s", "share"], ["a", "ask"], ["t", "task"], ["r", "record"], ["P", "pin"]] as const) assert.deepEqual(cardKey(k(key)), { t }, key);
  assert.deepEqual(cardKey(k("Delete")), { t: "delete" });
  assert.deepEqual(cardKey(k("Backspace")), { t: "delete" });
  assert.deepEqual(cardKey(k("F10", { shiftKey: true })), { t: "menu" });
  assert.equal(cardKey(k("F10")), null);
  assert.equal(cardKey(k("p", { metaKey: true })), null, "Cmd-P is the browser's");
  assert.equal(cardKey(k("ArrowDown", { ctrlKey: true })), null);
  assert.equal(cardKey(k("x")), null);
});

test("the page: / searches, C takes a note, Cmd-Z undoes a delete; none of them while typing", () => {
  assert.deepEqual(pageKey(k("/"), false, false), { t: "search" });
  assert.deepEqual(pageKey(k("c"), false, false), { t: "take" });
  assert.equal(pageKey(k("c"), true, false), null);
  assert.equal(pageKey(k("c", { metaKey: true }), false, false), null, "Cmd-C copies");
  assert.deepEqual(pageKey(k("z", { metaKey: true }), false, true), { t: "undo" });
  assert.deepEqual(pageKey(k("z", { ctrlKey: true }), false, true), { t: "undo" });
  assert.equal(pageKey(k("z", { metaKey: true }), false, false), null, "nothing to undo");
  assert.equal(pageKey(k("z", { metaKey: true }), true, true), null, "in a field Cmd-Z undoes typing");
  assert.equal(pageKey(k("z", { metaKey: true, shiftKey: true }), false, true), null);
});

test("Esc closes the top layer; Cmd-Enter makes in a sheet, closes the opened note and saves the bar", () => {
  assert.equal(layerKey(k("Escape"), "sheet"), "close");
  assert.equal(layerKey(k("Escape"), null), null);
  assert.equal(layerKey(k("Enter", { metaKey: true }), "sheet"), "make");
  assert.equal(layerKey(k("Enter", { ctrlKey: true }), "note"), "close");
  assert.equal(layerKey(k("Enter", { metaKey: true }), "take"), "close");
  assert.equal(layerKey(k("Enter", { metaKey: true }), "share"), null);
  assert.equal(layerKey(k("Enter"), "sheet"), null);
});

test("Esc peels the layers in order: a sheet, the share sheet, the note, the bar being typed in, the Ask pane, the foot bar", () => {
  const none = { sheet: false, share: false, note: false, take: false, ask: false, bar: false };
  assert.equal(topLayer({ ...none, sheet: true, note: true, bar: true }, false, false), "sheet");
  assert.equal(topLayer({ ...none, share: true, note: true }, false, false), "share");
  assert.equal(topLayer({ ...none, note: true, ask: true }, true, false), "note");
  assert.equal(topLayer({ ...none, take: true, ask: true }, false, true), "take");
  assert.equal(topLayer({ ...none, take: true }, false, false), null, "Esc outside the open bar leaves it");
  assert.equal(topLayer({ ...none, ask: true, bar: true }, true, false), "ask");
  assert.equal(topLayer({ ...none, ask: true, bar: true }, false, false), "bar", "Esc in the grid with the pane open dismisses the line, not the pane");
  assert.equal(topLayer(none, false, false), null);
});

test("arrows move by geometry: across columns of different heights, up and down within a column", () => {
  // two columns: a (tall) and b over c on the right
  const a: Box = { id: "a", left: 0, top: 0, width: 236, height: 300 };
  const b: Box = { id: "b", left: 250, top: 0, width: 236, height: 100 };
  const c: Box = { id: "c", left: 250, top: 114, width: 236, height: 120 };
  const d: Box = { id: "d", left: 0, top: 314, width: 236, height: 80 };
  const all = [a, b, c, d];
  assert.equal(nearest(a, all, "right"), "c", "the card nearest in height wins");
  assert.equal(nearest(c, all, "left"), "a");
  assert.equal(nearest(b, all, "down"), "c", "the same column first");
  assert.equal(nearest(c, all, "down"), "d", "then the next row below");
  assert.equal(nearest(c, all, "up"), "b");
  assert.equal(nearest(a, all, "down"), "d");
  assert.equal(nearest(a, all, "up"), null, "at the top edge");
  assert.equal(nearest(b, all, "right"), null);
});
