// Computer popup, P-L9b_09: Take over keeps the hand glyph while you are in control (as in the prototype, where only the pressed look changes), and taking over forwards every kind of
// input: keyboard, scroll, right click, double click and the ordinary click.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ComputerPopup } from "./ComputerPopup.tsx";
import { createForwarder } from "./actions.ts";
import type { PopupDeps } from "./actions.ts";
import { DISPLAY, DOUBLE_MS, SCROLL_MS } from "./model.ts";
import { COMPUTER, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const popup = (v: Variant): string => clean(renderToStaticMarkup(<ComputerPopup data={createSample(v).data} />));
const tagOf = (out: string, testid: string): string => {
  const i = out.indexOf(`data-testid="${testid}"`);
  assert.ok(i >= 0, testid);
  const end = out.indexOf("</svg>", i);
  assert.ok(end > i, `${testid} draws an icon`);
  return out.slice(i, end);
};
const pathsOf = (chunk: string): string[] => [...chunk.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
const deps = (s: Sample): { d: PopupDeps; notes: string[] } => {
  const notes: string[] = [];
  return { notes, d: { call: s.data.call, note: (t) => notes.push(t) } };
};
const BOX = { width: 640, height: 400 };
const caps = (s: Sample): string[] => s.calls.map((c) => c.cap);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("the Take over icon is the hand before and while you are in control; only its label and pressed look change", () => {
  const before = popup("working");
  const during = popup("takeover");
  const a = pathsOf(tagOf(before, "rail-take"));
  const b = pathsOf(tagOf(during, "rail-take"));
  assert.ok(a.length > 0, "the rail button draws an icon");
  assert.deepEqual(b, a, "the same glyph in both states");
  assert.ok(before.includes("Take over") && during.includes("Give back control"), "the label still flips");
});

test("keyboard: letters collect into one type call, combinations go as keys", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.key({ key: "h" });
  await f.key({ key: "i" });
  await f.key({ key: "Enter" });
  assert.deepEqual(s.calls.map((c) => [c.cap, c.input]), [
    ["computers.screen.type", { computerId: COMPUTER, text: "hi" }],
    ["computers.screen.key", { computerId: COMPUTER, combo: "Return" }],
  ]);
});

test("left click: one click at the matching point on the display", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.press(160, 100, BOX, 0);
  assert.deepEqual(s.calls.map((c) => c.input), [{ computerId: COMPUTER, x: 320, y: 200 }]);
});

test("double click: the second quick press carries double", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.press(10, 10, BOX, 1000);
  await f.press(10, 10, BOX, 1000 + DOUBLE_MS - 1);
  assert.deepEqual(s.calls.map((c) => (c.input as { double?: boolean }).double === true), [false, true]);
});

test("right click: a click with the right button; it never counts toward a double click", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.press(320, 200, BOX, 1000, "right");
  await f.press(320, 200, BOX, 1100, "right");
  await f.press(320, 200, BOX, 1200);
  assert.deepEqual(s.calls.map((c) => c.input), [
    { computerId: COMPUTER, x: 640, y: 400, button: "right" },
    { computerId: COMPUTER, x: 640, y: 400, button: "right" },
    { computerId: COMPUTER, x: 640, y: 400 },
  ]);
  assert.ok(caps(s).every((c) => c === "computers.screen.click"));
});

test("scroll: wheel turns close together are one scroll call at the point, down is positive", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.scroll(320, 200, BOX, 0, 40);
  await f.scroll(320, 200, BOX, 0, 40);
  await f.scroll(320, 200, BOX, 0, -10);
  assert.equal(s.calls.length, 0, "held until the next frame");
  await f.flushScroll();
  assert.deepEqual(s.calls.map((c) => [c.cap, c.input]), [["computers.screen.scroll", { computerId: COMPUTER, x: 640, y: 400, dy: 70 }]]);
  await f.flushScroll();
  assert.equal(s.calls.length, 1, "flushing again sends nothing");
});

test("scroll goes by itself after a moment, sideways turns carry dx, and a turn that cancels out sends nothing", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.scroll(0, 0, BOX, 12, 5);
  await wait(SCROLL_MS + 60);
  assert.deepEqual(s.calls.map((c) => c.input), [{ computerId: COMPUTER, x: 0, y: 0, dx: 12, dy: 5 }]);
  await f.scroll(0, 0, BOX, 0, 30);
  await f.scroll(0, 0, BOX, 0, -30);
  await f.flushScroll();
  assert.equal(s.calls.length, 1);
});

test("a press or a key sends a held scroll first, so the desktop sees them in the order you did them", async () => {
  const s = createSample("takeover");
  const f = createForwarder(deps(s).d, COMPUTER);
  await f.scroll(100, 100, BOX, 0, 60);
  await f.press(100, 100, BOX, 0);
  await f.scroll(100, 100, BOX, 0, 20);
  await f.key({ key: "End" });
  assert.deepEqual(caps(s), ["computers.screen.scroll", "computers.screen.click", "computers.screen.scroll", "computers.screen.key"]);
  assert.equal((s.calls[0]!.input as { x: number }).x, Math.round((100 / 640) * DISPLAY.width));
});

test("a failed scroll is one quiet line, not a thrown error", async () => {
  const s = createSample("takeover");
  const { d, notes } = deps(s);
  const f = createForwarder(d, COMPUTER);
  s.failNext("computers.screen.scroll");
  await f.scroll(1, 1, BOX, 0, 9);
  await f.flushScroll();
  assert.deepEqual(notes, ["Could not send that to the screen. Try again."]);
});
