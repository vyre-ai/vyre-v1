// @tsx
// One motion set, and the still copy that keeps a switch from ever showing a blank frame.
import test from "node:test";
import assert from "node:assert/strict";
import { MOTION, MOTION_CSS, QUIET_MS, holdView, keepView, showKept } from "./motion.ts";

test("one set of durations, one ease, no bounce, and reduced motion turns it all off", () => {
  assert.deepEqual([MOTION.hover, MOTION.fade, MOTION.panel, MOTION.swap], [120, 160, 220, 140]);
  assert.equal(QUIET_MS, 300);
  assert.doesNotMatch(MOTION_CSS, /infinite/, "no looping animation here");
  assert.match(MOTION_CSS, /prefers-reduced-motion:reduce/);
});

function node(scroll = 0): Record<string, unknown> & { kids: unknown[] } {
  const attrs: Record<string, string> = {};
  const n = {
    kids: [] as unknown[],
    scrollTop: scroll,
    scrollLeft: 0,
    style: { opacity: "1" },
    attrs,
    removed: false,
    querySelectorAll: () => [] as unknown[],
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
    removeAttribute: (k: string) => {
      delete attrs[k];
    },
    appendChild(c: unknown) {
      n.kids.push(c);
    },
    remove() {
      n.removed = true;
    },
    cloneNode: () => node(),
  };
  return n;
}

// Changed 15 Nov 2026 (team/v1/TABS-2026-11-15.md): the copy used to fade out over 140 ms, which drew the old view and the new one on top of each other. It now leaves in one frame.
test("a still copy goes over the view, stays until told, then leaves at once: the old view is never drawn over the new one", async () => {
  const live = node();
  const swap = holdView(live, live);
  assert.ok(swap);
  const copy = live.kids[0] as ReturnType<typeof node>;
  assert.equal((copy.attrs as Record<string, string>)["data-swap"], "1");
  assert.equal((copy.style as { opacity: string }).opacity, "1", "held until the next view is ready");
  assert.equal(copy.removed, false);
  swap.fade();
  assert.equal(copy.removed, true, "gone in the same frame, not after a fade");
  assert.equal((copy.style as { opacity: string }).opacity, "1", "it was never half shown");
  swap.fade();
  assert.equal(copy.removed, true, "a second call does nothing");
  assert.equal(holdView(null, null), null);
});

test("a quick second swap does not copy the copy still fading from the first (the cost doubled with every quick Back or Forward)", () => {
  const live = node();
  const fading = node();
  live.querySelectorAll = () => (fading.removed ? [] : [fading]);
  const first = holdView(live, live);
  assert.ok(first);
  const copy = live.kids[0] as ReturnType<typeof node>;
  live.querySelectorAll = (q: string) => (q === "[data-swap]" && !copy.removed ? [copy] : []);
  first.fade();
  const second = holdView(live, live);
  assert.ok(second);
  assert.equal(copy.removed, true, "the copy that was still fading is gone before the next one is taken");
});

test("a view is kept as a still copy and shown again over its place at once; a copy is never made of a copy", () => {
  const live = node();
  const kept = keepView(live);
  assert.ok(kept, "a view with nothing over it is kept");
  const copy = kept!.node as ReturnType<typeof node> & { attrs: Record<string, string>; removed: boolean };
  assert.equal(copy.attrs["data-swap"], "1", "the copy is marked, so nothing reads it as the live view");
  assert.equal(copy.attrs["aria-hidden"], "true");
  // shown later over its place, with the page's colour behind it so the live view never shows through
  const host = node();
  const swap = showKept(kept!, host, "rgb(1, 2, 3)");
  assert.ok(swap);
  assert.deepEqual(host.kids, [copy], "the kept copy lies over its place");
  assert.equal((copy.style as { backgroundColor?: string }).backgroundColor, "rgb(1, 2, 3)");
  swap!.fade();
  assert.equal(copy.removed, true, "and leaves in one step when the live view is ready");
  // a view that has a still copy over it is not kept: the copy would be a picture of a picture
  const busy = node() as ReturnType<typeof node> & { querySelector?: (q: string) => unknown };
  busy.querySelector = (q: string) => (q === "[data-swap]" ? {} : null);
  assert.equal(keepView(busy), null);
  assert.equal(keepView(null), null);
  assert.equal(showKept(kept!, null), null);
});
