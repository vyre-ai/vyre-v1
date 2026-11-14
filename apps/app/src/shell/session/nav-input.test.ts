// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { matchShortcut } from "../keyboard/map.ts";
import { SWIPE_DISTANCE, scrollsSideways, startNavInput, swipeTracker } from "./nav-input.ts";
import type { ShellHub } from "../spaces/hub.ts";

test("Cmd-[ and Cmd-] are Back and Forward on a Mac; Alt-Left, Alt-Right and Ctrl-[ elsewhere; a terminal and a Mac Alt-Left keep their own meaning", () => {
  assert.equal(matchShortcut({ key: "[", metaKey: true }, "mac")?.id, "nav.back");
  assert.equal(matchShortcut({ key: "]", metaKey: true }, "mac")?.id, "nav.forward");
  assert.equal(matchShortcut({ key: "ArrowLeft", altKey: true }, "other")?.id, "nav.back");
  assert.equal(matchShortcut({ key: "ArrowRight", altKey: true }, "other")?.id, "nav.forward");
  assert.equal(matchShortcut({ key: "[", ctrlKey: true }, "other")?.id, "nav.back");
  assert.equal(matchShortcut({ key: "ArrowLeft", altKey: true }, "mac"), null, "a word move in a Mac text field");
  assert.equal(matchShortcut({ key: "[", metaKey: true }, "mac", { inTerminal: true }), null);
  assert.equal(matchShortcut({ key: "ArrowLeft", altKey: true }, "other", { inTerminal: true }), null);
});

test("a swipe sideways is one step per gesture; a scroll down is not", () => {
  const swipe = swipeTracker();
  let t = 0;
  const out: (string | null)[] = [];
  for (let i = 0; i < 12; i++) out.push(swipe({ deltaX: -20, deltaY: 1, at: (t += 16) }));
  assert.equal(out.filter((x) => x === "back").length, 1, "once, not on every wheel event");
  assert.ok(12 * 20 >= SWIPE_DISTANCE);
  const next = swipeTracker();
  assert.equal(next({ deltaX: -200, deltaY: 300, at: 0 }), null, "mostly vertical is a scroll");
  // a new gesture after quiet counts again
  const again = swipeTracker();
  again({ deltaX: 200, deltaY: 0, at: 0 });
  assert.equal(again({ deltaX: 200, deltaY: 0, at: 1000 }), "forward");
});

test("something that can still scroll sideways under the pointer takes the swipe", () => {
  const strip = { scrollLeft: 40, scrollWidth: 800, clientWidth: 300, parentElement: null };
  assert.equal(scrollsSideways({ scrollLeft: 0, scrollWidth: 10, clientWidth: 10, parentElement: strip }, -50), true);
  assert.equal(scrollsSideways({ scrollLeft: 0, scrollWidth: 10, clientWidth: 10, parentElement: null }, -50), false);
  assert.equal(
    scrollsSideways({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300, parentElement: null }, -50),
    false,
    "at its left edge, Back is the swipe's",
  );
});

test("the mouse's back button is one step: a real browser fires mousedown, mouseup and auxclick", () => {
  const on = new Map<string, (e: never) => void>();
  const doc = {
    addEventListener: (t: string, f: (e: never) => void) => on.set(t, f),
    removeEventListener: (t: string) => on.delete(t),
  };
  let backs = 0;
  const hub = { back: () => (backs++, true), forward: () => true } as unknown as ShellHub;
  const stop = startNavInput(hub, doc, { desktop: true, platform: "other" });
  let prevented = 0;
  for (const t of ["mousedown", "mouseup", "auxclick"])
    on.get(t)?.({ button: 3, preventDefault: () => prevented++ } as never);
  assert.equal(backs, 1, "one step per press");
  assert.ok(prevented >= 2, "the browser's own Back is kept off");
  stop();
});
