// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { applyScroll, captureScroll, scrollMemory } from "./scroll-memory.ts";

const box = (testid: string | null, top = 0, tall = 1000) => ({
  scrollTop: top,
  scrollLeft: 0,
  scrollHeight: tall,
  clientHeight: 300,
  getAttribute: (k: string) => (k === "data-testid" ? testid : null),
  closest: () => null,
});
const root = (els: ReturnType<typeof box>[]) => ({ querySelectorAll: () => els });

test("what is scrolled is noted and put back, found by test id or by place", () => {
  const a = box("files-list", 420),
    b = box(null, 0),
    c = box(null, 90);
  const saved = captureScroll(root([a, b, c]));
  assert.deepEqual(
    saved.map((s) => [s.id, s.top]),
    [
      ["files-list", 420],
      ["", 90],
    ],
  );
  const a2 = box("files-list"),
    b2 = box(null),
    c2 = box(null);
  assert.equal(applyScroll(root([b2, a2, c2]), saved), 0);
  assert.equal(a2.scrollTop, 420, "by test id, wherever it sits");
  assert.equal(c2.scrollTop, 90, "by place");
});

test("a box not drawn yet, or not tall enough yet, is waited for; nothing is restored into the old view's copy", () => {
  const saved = [{ id: "files-list", index: 0, top: 800, left: 0 }];
  const short = box("files-list", 0, 400);
  assert.equal(applyScroll(root([short]), saved), 1);
  assert.equal(short.scrollTop, 0);
  assert.equal(applyScroll(root([]), saved), 1);
  const copy = { ...box("files-list", 0, 2000), closest: () => ({}) };
  assert.equal(applyScroll(root([copy]), saved), 1, "the still copy is not a box");
  assert.equal(captureScroll(root([{ ...box("x", 50), closest: () => ({}) }])).length, 0);
});

test("the memory keeps the newest notes and forgets an empty one", () => {
  const m = scrollMemory();
  m.note("a", [{ id: "", index: 1, top: 5, left: 0 }]);
  m.note("a", []);
  assert.equal(m.get("a"), undefined);
});
