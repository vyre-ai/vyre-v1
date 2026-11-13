// The live view of an agent's browser while you are in control keeps its picture between frames (13 Nov 2026, owner on rc.26: "browser also keeps flickering"). Each frame used to be a new picture
// address, so the box was blank for a moment between two frames (about one sample in ten in a real browser). Frames are now painted on one canvas by framePainter: decoded off to the side, drawn in one
// step over the last, never clearing it, skipping ahead when frames come faster than they decode.
import test from "node:test";
import assert from "node:assert/strict";
import { framePainter } from "./BrowserLive.tsx";
import type { PaintTarget } from "./BrowserLive.tsx";

const frame = (n: number): ArrayBuffer => new Uint8Array([n]).buffer;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function rig(opts: { fail?: (n: number) => boolean } = {}) {
  const drawn: number[] = [];
  const sizes: Array<[number, number]> = [];
  let clears = 0;
  let w = 300, h = 150;   // a canvas starts at 300 x 150
  const canvas: PaintTarget = {
    get width() { return w; }, set width(v: number) { if (v !== w) clears++; w = v; },
    get height() { return h; }, set height(v: number) { if (v !== h) clears++; h = v; },
    getContext: () => ({ drawImage: (src: unknown) => { drawn.push((src as { n: number }).n); } }),
  };
  const waits = new Map<number, () => void>();
  const paint = framePainter({
    target: () => canvas,
    decode: (jpeg) => { const n = new Uint8Array(jpeg)[0]!; return new Promise((resolve, reject) => { waits.set(n, () => (opts.fail?.(n) ? reject(new Error("bad jpeg")) : resolve({ n, width: 1280, height: 800 } as never))); }); },
    drawn: (s) => sizes.push([s.width, s.height]),
  });
  return { paint, drawn, sizes, waits, target: () => canvas, clears: () => clears };
}

test("frames are drawn in order, each over the last, and the canvas is sized once for the page", async () => {
  const r = rig();
  r.paint(frame(1)); r.waits.get(1)!(); await flush();
  r.paint(frame(2)); r.waits.get(2)!(); await flush();
  assert.deepEqual(r.drawn, [1, 2]);
  assert.equal(r.clears(), 2, "set to the page's size once (width and height), never again: setting a canvas size clears it, which is the blank that flickered");
  assert.deepEqual(r.sizes[1], [1280, 800], "the size the click mapping uses");
});

test("frames that arrive while one is decoding wait, and only the newest is drawn: the view skips ahead", async () => {
  const r = rig();
  r.paint(frame(1)); r.paint(frame(2)); r.paint(frame(3));
  r.waits.get(1)!(); await flush();
  assert.equal(r.waits.has(2), false, "the one that was overtaken is never decoded");
  r.waits.get(3)!(); await flush();
  assert.deepEqual(r.drawn, [1, 3]);
});

test("a frame that cannot be read is skipped and the last good picture stays", async () => {
  const r = rig({ fail: (n) => n === 2 });
  r.paint(frame(1)); r.waits.get(1)!(); await flush();
  r.paint(frame(2)); r.waits.get(2)!(); await flush();
  r.paint(frame(3)); r.waits.get(3)!(); await flush();
  assert.deepEqual(r.drawn, [1, 3]);
  assert.equal(r.clears(), 2, "nothing cleared the picture");
});

test("a burst of frames (a slow link delivers them together) decodes the first and the newest, never a backlog", async () => {
  const r = rig();
  for (let n = 1; n <= 40; n++) r.paint(frame(n));
  r.waits.get(1)!(); await flush();
  r.waits.get(40)!(); await flush();
  assert.deepEqual(r.drawn, [1, 40]);
  assert.equal(r.waits.size, 2, "the 38 in between were never decoded");
});

test("a reconnect (a new painter on the same canvas) keeps the last picture and does not clear it", async () => {
  const r = rig();
  r.paint(frame(1)); r.waits.get(1)!(); await flush();
  const before = r.clears();
  // the socket closed and opened again: a new painter, frames start from the same page size
  const again = framePainter({ target: r.target, decode: (j) => new Promise((res) => { const n = new Uint8Array(j)[0]!; r.waits.set(n + 100, () => res({ n: n + 100, width: 1280, height: 800 } as never)); }), drawn: () => undefined });
  again(frame(2)); r.waits.get(102)!(); await flush();
  assert.deepEqual(r.drawn, [1, 102]);
  assert.equal(r.clears(), before, "same page size: nothing cleared between the old connection and the new");
});
