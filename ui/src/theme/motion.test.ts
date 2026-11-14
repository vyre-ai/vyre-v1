// @tsx
// One motion set, and the still copy that keeps a switch from ever showing a blank frame.
import test from "node:test";
import assert from "node:assert/strict";
import { MOTION, MOTION_CSS, QUIET_MS, holdView } from "./motion.ts";

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

test("a still copy goes over the view, stays until told, then fades once and leaves", async () => {
  const live = node();
  const swap = holdView(live, live);
  assert.ok(swap);
  const copy = live.kids[0] as ReturnType<typeof node>;
  assert.equal((copy.attrs as Record<string, string>)["data-swap"], "1");
  assert.equal((copy.style as { opacity: string }).opacity, "1", "held until the next view is ready");
  swap.fade();
  assert.equal((copy.style as { opacity: string }).opacity, "0");
  await new Promise((r) => setTimeout(r, MOTION.swap + 60));
  assert.equal(copy.removed, true);
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
