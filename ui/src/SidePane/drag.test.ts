// The drag every pane edge shares: the width follows the pointer exactly from where it was pressed, the page cannot be selected while it holds the pointer, and letting go gives the page back.
import test from "node:test";
import assert from "node:assert/strict";
import { RESIZING_ATTR, RESIZING_CSS, bindEdge, holdPage } from "./drag.ts";

function stand() {
  const on = new Map<string, Set<(e: never) => void>>();
  const node = {
    captured: 0,
    addEventListener(t: string, l: (e: never) => void) { (on.get(t) ?? on.set(t, new Set()).get(t)!).add(l); },
    removeEventListener(t: string, l: (e: never) => void) { on.get(t)?.delete(l); },
    setPointerCapture(id: number) { this.captured = id; },
  };
  const fire = (t: string, x = 0, button = 0): { stopped: boolean } => { const box = { stopped: false }; for (const l of [...(on.get(t) ?? [])]) l({ button, clientX: x, pointerId: 7, preventDefault: () => { box.stopped = true; } } as never); return box; };
  return { node, fire, on };
}
function page() {
  const attrs = new Map<string, string>();
  let cleared = 0;
  return { attrs, cleared: () => cleared, documentElement: { setAttribute: (k: string, v: string) => { attrs.set(k, v); }, removeAttribute: (k: string) => { attrs.delete(k); } }, getSelection: () => ({ removeAllRanges: () => { cleared++; } }) };
}

test("a drag reports the pointer's exact distance from the press, every step, to the last", () => {
  const { node, fire } = stand();
  const seen: Array<string | number> = [];
  bindEdge(node as never, () => ({ onStart: () => seen.push("start"), onMove: (d) => seen.push(d), onEnd: (d) => seen.push(`end ${d}`), onCancel: () => seen.push("cancel") }), page());
  fire("pointerdown", 500);
  assert.equal(node.captured, 7, "the edge holds the pointer, so it keeps the drag over an iframe or a terminal");
  fire("pointermove", 437); fire("pointermove", 400);
  fire("pointerup", 400);
  assert.deepEqual(seen, ["start", -63, -100, "end -100"]);
  fire("pointermove", 300);
  assert.equal(seen.length, 4, "after the release the edge hears nothing");
});

test("a press never starts a text selection, and the page is held until the release", () => {
  const { node, fire } = stand();
  const p = page();
  bindEdge(node as never, () => ({ onStart: () => undefined, onMove: () => undefined, onEnd: () => undefined, onCancel: () => undefined }), p);
  assert.equal(fire("mousedown", 10).stopped, true, "the mouse press is what starts a selection");
  assert.equal(fire("pointerdown", 10).stopped, true);
  assert.equal(p.attrs.get(RESIZING_ATTR), "1");
  assert.equal(p.cleared(), 1);
  fire("pointerup", 10);
  assert.equal(p.attrs.has(RESIZING_ATTR), false, "the release gives the page back");
});

test("only the main button drags, and a cancelled drag lets go too", () => {
  const { node, fire } = stand();
  const p = page();
  const seen: string[] = [];
  bindEdge(node as never, () => ({ onStart: () => seen.push("start"), onMove: () => seen.push("move"), onEnd: () => seen.push("end"), onCancel: () => seen.push("cancel") }), p);
  fire("pointerdown", 10, 2);
  fire("pointermove", 20);
  assert.deepEqual(seen, [], "a right press is the menu's");
  fire("pointerdown", 10);
  fire("pointercancel", 10);
  assert.deepEqual(seen, ["start", "cancel"]);
  assert.equal(p.attrs.has(RESIZING_ATTR), false);
});

test("the held page cannot be selected and an iframe does not take the pointer", () => {
  assert.match(RESIZING_CSS, /user-select:none!important/);
  assert.match(RESIZING_CSS, /iframe\{pointer-events:none!important\}/);
  assert.equal(holdPage(undefined)(), undefined);
});
