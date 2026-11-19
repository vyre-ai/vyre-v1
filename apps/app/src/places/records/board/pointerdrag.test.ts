// The one drag path: a mouse lifts after a few pixels, a finger after a hold, a swipe never lifts, Escape puts the card down, and the lane under the pointer is the one dropped on.
import test from "node:test";
import assert from "node:assert/strict";
import { beginPointerDrag } from "./pointerdrag.ts";
import type { DragHooks, Win } from "./pointerdrag.ts";

function rig(laneAt: (x: number, y: number) => string | null) {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  const appended: unknown[] = [];
  const win: Win = {
    addEventListener: (t, fn) => void handlers.set(t, [...(handlers.get(t) ?? []), fn as never]),
    removeEventListener: (t, fn) =>
      void handlers.set(
        t,
        (handlers.get(t) ?? []).filter((h) => h !== (fn as never)),
      ),
    setTimeout: (fn, ms) => timers.push({ fn, ms, id: timers.length + 1, live: true }),
    clearTimeout: (id) => {
      const t = timers.find((x) => x.id === id);
      if (t) t.live = false;
    },
    document: {
      body: { appendChild: (n) => void appended.push(n) },
      elementFromPoint: (x, y) => {
        const l = laneAt(x, y);
        return { closest: () => (l === null ? null : { dataset: { lane: l } }) };
      },
    },
  };
  const fire = (t: string, e: Record<string, unknown>): void => (handlers.get(t) ?? []).slice().forEach((h) => h(e));
  const log: string[] = [];
  const hooks: DragHooks = {
    lift: () => void log.push("lift"),
    over: (l) => void log.push(`over:${l}`),
    drop: () => void log.push("drop"),
    end: () => void log.push("end"),
    cancel: () => void log.push("cancel"),
  };
  const card = {
    cloneNode: () => ({ style: {} as Record<string, string> }),
    getBoundingClientRect: () => ({ width: 232, height: 80 }),
  };
  return { win, fire, log, hooks, card, timers, appended, handlers };
}
const down = (type: string) => ({ pointerType: type, pointerId: 1, clientX: 100, clientY: 100 });

test("a mouse lifts after a few pixels, follows the pointer over lanes and drops on the lane under it", () => {
  const r = rig((x) => (x > 300 ? "prop" : "lead"));
  beginPointerDrag(down("mouse"), r.card, r.hooks, r.win);
  r.fire("pointermove", { pointerId: 1, clientX: 102, clientY: 101 });
  assert.deepEqual(r.log, [], "two pixels is a click, not a drag");
  r.fire("pointermove", { pointerId: 1, clientX: 120, clientY: 110 });
  r.fire("pointermove", { pointerId: 1, clientX: 400, clientY: 120 });
  r.fire("pointerup", { pointerId: 1, clientX: 400, clientY: 120 });
  assert.deepEqual(r.log, ["lift", "over:lead", "over:prop", "over:prop", "drop", "end"]);
  assert.equal(r.appended.length, 1, "one tilted copy followed the pointer");
  assert.equal((r.handlers.get("pointermove") ?? []).length, 0, "nothing is left listening");
});

test("a pen drags like a mouse; a click that never moved is left alone", () => {
  const r = rig(() => "lead");
  beginPointerDrag(down("pen"), r.card, r.hooks, r.win);
  r.fire("pointerup", { pointerId: 1, clientX: 100, clientY: 100 });
  assert.deepEqual(r.log, []);
});

test("a finger lifts the card after a hold; a swipe before the hold never lifts it", () => {
  const hold = rig(() => "prop");
  beginPointerDrag(down("touch"), hold.card, hold.hooks, hold.win);
  assert.equal(hold.timers[0]!.ms, 250);
  hold.timers[0]!.fn();
  hold.fire("pointermove", { pointerId: 1, clientX: 100, clientY: 160 });
  hold.fire("pointerup", { pointerId: 1, clientX: 100, clientY: 160 });
  assert.deepEqual(hold.log, ["lift", "over:prop", "over:prop", "drop", "end"]);
  assert.equal((hold.handlers.get("touchmove") ?? []).length, 0);

  const swipe = rig(() => "prop");
  beginPointerDrag(down("touch"), swipe.card, swipe.hooks, swipe.win);
  swipe.fire("pointermove", { pointerId: 1, clientX: 100, clientY: 140 });
  assert.equal(swipe.timers[0]!.live, false, "the hold is abandoned");
  swipe.fire("pointerup", { pointerId: 1, clientX: 100, clientY: 140 });
  assert.deepEqual(swipe.log, []);
});

test("Escape and a cancelled pointer put the card down without a drop; another pointer is ignored", () => {
  const r = rig(() => "prop");
  beginPointerDrag(down("mouse"), r.card, r.hooks, r.win);
  r.fire("pointermove", { pointerId: 2, clientX: 300, clientY: 300 });
  assert.deepEqual(r.log, []);
  r.fire("pointermove", { pointerId: 1, clientX: 300, clientY: 300 });
  r.fire("keydown", { key: "Escape" });
  assert.deepEqual(r.log, ["lift", "over:prop", "cancel", "end"]);
  const c = rig(() => null);
  beginPointerDrag(down("mouse"), c.card, c.hooks, c.win);
  c.fire("pointermove", { pointerId: 1, clientX: 300, clientY: 300 });
  c.fire("pointercancel", { pointerId: 1 });
  assert.deepEqual(c.log, ["lift", "cancel", "end"]);
});

test("a mouse button let go outside the window ends the drag; a second pointer does not start a second drag", () => {
  const r = rig(() => "prop");
  const first = beginPointerDrag(down("mouse"), r.card, r.hooks, r.win);
  const second = beginPointerDrag({ ...down("touch"), pointerId: 2 }, r.card, r.hooks, r.win);
  assert.equal(second, first, "the drag that is under way is the only one");
  r.fire("pointermove", { pointerId: 1, clientX: 300, clientY: 300, buttons: 1 });
  r.fire("pointermove", { pointerId: 1, clientX: 320, clientY: 300, buttons: 0 });
  assert.deepEqual(r.log, ["lift", "over:prop", "cancel", "end"]);
  const again = rig(() => null);
  beginPointerDrag(down("mouse"), again.card, again.hooks, again.win);
  again.fire("pointerup", { pointerId: 1 });
  const next = rig(() => null);
  beginPointerDrag(down("mouse"), next.card, next.hooks, next.win);
  next.fire("pointermove", { pointerId: 1, clientX: 300, clientY: 300, buttons: 1 });
  assert.deepEqual(next.log, ["lift"], "a finished drag frees the next one");
});
