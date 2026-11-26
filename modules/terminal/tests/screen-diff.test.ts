// The change between two terminal screens (rc.44): small for a line printed at the bottom of a full scrollback, nothing for no change, whole when most of the screen changed, and applying it gives the new screen.
import test from "node:test";
import assert from "node:assert/strict";
import { applyDiff, diffLines } from "../screen-diff.ts";

const screen = (from: number, n: number): string[] => Array.from({ length: n }, (_, i) => `line ${from + i}`);

test("no change is a diff that does nothing", () => {
  const a = screen(0, 50);
  const d = diffLines(a, a)!;
  assert.deepEqual(d, { top: 0, at: 50, drop: 0, ins: [] });
  assert.deepEqual(applyDiff(a, d), a);
});

test("a line printed at the bottom of a full 2,000-line screen is one inserted line and one scrolled out, not 2,000 lines", () => {
  const a = screen(0, 2000);
  const b = screen(1, 2000);
  const d = diffLines(a, b)!;
  assert.equal(d.top, 1);
  assert.equal(d.ins.length, 1);
  assert.deepEqual(applyDiff(a, d), b);
});

test("a line that is typed on changes one line; a prompt redrawn changes the last lines", () => {
  const a = [...screen(0, 40), "$ ls"];
  const b = [...screen(0, 40), "$ ls -la"];
  const d = diffLines(a, b)!;
  assert.deepEqual(d, { top: 0, at: 40, drop: 1, ins: ["$ ls -la"] });
  assert.deepEqual(applyDiff(a, d), b);
  const c = [...screen(0, 38), "x", "y", "z"];
  assert.deepEqual(applyDiff(b, diffLines(b, c)!), c);
});

test("a screen that changed almost everywhere (clear, full-screen program) is not a diff: the caller sends it whole", () => {
  const a = screen(0, 40);
  const b = screen(1000, 40);
  assert.equal(diffLines(a, b), null);
});

test("random edits and scrolls always apply back to exactly the new screen", () => {
  let seed = 7;
  const rnd = (n: number): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  for (let round = 0; round < 300; round++) {
    let a = screen(0, 30 + rnd(300));
    for (let step = 0; step < 6; step++) {
      let b = [...a];
      const scroll = rnd(4) === 0 ? rnd(20) : 0;
      b = b.slice(scroll);
      for (let k = rnd(4); k > 0; k--)
        b.splice(rnd(b.length + 1), rnd(3), ...Array.from({ length: rnd(3) }, () => `n${rnd(1000)}`));
      for (let k = rnd(5); k > 0; k--) b.push(`tail ${rnd(100000)}`);
      const d = diffLines(a, b);
      if (d !== null) assert.deepEqual(applyDiff(a, d), b);
      a = b;
    }
  }
});

test("a diff that does not fit throws instead of drawing a wrong screen", () => {
  assert.throws(() => applyDiff(["a"], { top: 5, at: 0, drop: 0, ins: [] }));
  assert.throws(() => applyDiff(["a"], { top: 0, at: 3, drop: 1, ins: [] }));
});
