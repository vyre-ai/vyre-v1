// The terminal watcher (rc.44): one per terminal with viewers, looks only when the terminal prints, numbers its changes, gives a viewer that was away what it missed (or the whole screen), and stops when nobody watches.
import test from "node:test";
import assert from "node:assert/strict";
import { createWatcher } from "../watch.ts";
import type { Screen, ScreenMsg } from "../watch.ts";
import { applyDiff } from "../screen-diff.ts";

function rig(first: string[]) {
  let now = 0;
  const timers: Array<{ at: number; f: () => void }> = [];
  let screen: Screen = {
    text: first.join("\n"),
    cols: 80,
    rows: 24,
    cursor: { x: 0, y: first.length - 1 },
    history: 0,
    hidden: false,
  };
  let captures = 0;
  let trigger: (() => void) | null = null;
  let stopped = 0;
  const w = createWatcher(
    {
      capture: async () => {
        captures++;
        return screen;
      },
      frames: (on) => {
        trigger = on;
        return () => {
          trigger = null;
          stopped++;
        };
      },
    },
    {
      set: (f, ms) => {
        const t = { at: now + ms, f };
        timers.push(t);
        return () => void timers.splice(timers.indexOf(t) >>> 0, 1);
      },
    },
  );
  return {
    w,
    captures: () => captures,
    stopped: () => stopped,
    watching: () => trigger !== null,
    print: async (lines: string[], x = 0) => {
      screen = { ...screen, text: lines.join("\n"), cursor: { x, y: lines.length - 1 } };
      trigger?.();
      now += 30;
      for (const t of timers.splice(0)) t.f();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
  };
}

test("a new viewer gets the whole screen, then only what changes; the screen is rebuilt exactly from the messages", async () => {
  const base = Array.from({ length: 30 }, (_, i) => `old ${i}`);
  const r = rig([...base, "$ "]);
  const got: ScreenMsg[] = [];
  await r.w.subscribe((m) => got.push(m));
  assert.equal(got[0]!.t, "screen");
  let lines = (got[0] as { text: string }).text.split("\n");
  await r.print([...base, "$ ls", "a", "b", "$ "]);
  await r.print([...base, "$ ls", "a", "b", "$ echo hi"]);
  assert.equal(got.length, 3);
  for (const m of got.slice(1)) {
    assert.equal(m.t, "diff");
    if (m.t === "diff") lines = applyDiff(lines, m);
  }
  assert.deepEqual(lines, [...base, "$ ls", "a", "b", "$ echo hi"]);
  assert.deepEqual(
    got.slice(1).map((m) => (m as { rev: number }).rev),
    [1, 2],
  );
});

test("nothing is looked at while the terminal prints nothing, and an unchanged screen is not sent", async () => {
  const r = rig(["$ "]);
  const got: ScreenMsg[] = [];
  await r.w.subscribe((m) => got.push(m));
  const n = r.captures();
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(r.captures(), n, "no polling");
  await r.print(["$ "]);
  assert.equal(got.length, 1, "the same screen again says nothing");
});

test("a viewer that comes back with its number gets what it missed; one that is too far behind, or new, gets the whole screen; one that is current gets ok", async () => {
  const r = rig(["a"]);
  const first: ScreenMsg[] = [];
  const sub = await r.w.subscribe((m) => first.push(m));
  await r.print(["a", "b"]);
  await r.print(["a", "b", "c"]);
  const again: ScreenMsg[] = [];
  await r.w.subscribe((m) => again.push(m), 0);
  assert.deepEqual(
    again.map((m) => (m as { rev: number }).rev),
    [1, 2],
  );
  assert.deepEqual(
    again.map((m) => m.t),
    ["diff", "diff"],
  );
  const current: ScreenMsg[] = [];
  await r.w.subscribe((m) => current.push(m), 2);
  assert.deepEqual(current, [{ t: "ok", rev: 2 }]);
  const far: ScreenMsg[] = [];
  await r.w.subscribe((m) => far.push(m), 99);
  assert.equal(far[0]!.t, "screen");
  sub.resync();
  assert.equal(first.at(-1)!.t, "screen");
});

test("it stops watching the terminal when the last viewer leaves, and starts afresh for the next", async () => {
  const r = rig(["a"]);
  const a = await r.w.subscribe(() => undefined);
  const b = await r.w.subscribe(() => undefined);
  assert.equal(r.w.viewers(), 2);
  a.stop();
  assert.equal(r.watching(), true);
  b.stop();
  assert.equal(r.watching(), false);
  assert.equal(r.stopped(), 1);
  const got: ScreenMsg[] = [];
  await r.w.subscribe((m) => got.push(m));
  assert.equal(got[0]!.t, "screen");
  assert.equal(r.watching(), true);
});

test("a cursor move alone is a change that is sent", async () => {
  const r = rig(["$ ab"]);
  const got: ScreenMsg[] = [];
  await r.w.subscribe((m) => got.push(m));
  await r.print(["$ ab"], 0);
  assert.equal(got.length, 1, "the same screen and cursor says nothing");
  await r.print(["$ ab"], 3);
  assert.equal(got.length, 2, "the cursor moved");
  assert.deepEqual((got[1] as { cursor: unknown }).cursor, { x: 3, y: 0 });
});
