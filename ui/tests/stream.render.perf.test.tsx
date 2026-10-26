// The speed half of stream.render.test.tsx (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Streaming render (ARCH 9, perf stream_render and layout_shift): 100 deltas a second become at most one append per frame, only the open block of the markdown is parsed again, final blocks keep
// their identity so React skips them, and every box that arrives late is reserved at its final size. The browser-side numbers (frame interval under a 100 delta/s stream, layout shift 0) are the
// shots scroll probe on scripts/shots/mounts/P-L9_20.tsx; this file proves the mechanism that keeps them (the caret is text inside the last run, so it never moves as a box).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AVATAR_SIZE, AvatarSlot, BODY_LINE, CARET, HEADER_HEIGHT, MarkdownBlocks, ReservedImage, SkeletonMessage, StreamText, createCoalescer, createIncrementalMarkdown, createStreamStore, isAtEnd,
  messageHeight, parseChunk, parseInline,
} from "../src/stream/index.ts";
import type { FrameScheduler } from "../src/stream/index.ts";

/** Frames driven by hand: request queues a callback, tick runs the ones waiting (one frame). */
function manualFrames() {
  const waiting = new Map<number, (t: number) => void>();
  let next = 1;
  let clock = 0;
  const scheduler: FrameScheduler = {
    request(cb) { const h = next++; waiting.set(h, cb); return h; },
    cancel(h) { waiting.delete(h); },
  };
  return {
    scheduler,
    tick(ms = 16.7): boolean {
      clock += ms;
      const due = [...waiting.entries()];
      waiting.clear();
      for (const [, cb] of due) cb(clock);
      return due.length > 0;
    },
    get pending() { return waiting.size; },
  };
}

// ---- the coalescer

test("stream_render: 100 deltas a second through the store are one notification per frame, and a frame's work stays small", () => {
  const f = manualFrames();
  const store = createStreamStore(f.scheduler);
  let seen = 0;
  store.subscribe(() => { seen++; });
  const words = DOC.split(/(?<= )/);
  const FRAMES = 180;
  const times: number[] = [];
  let at = 0;
  for (let frame = 0; frame < FRAMES; frame++) {
    const due = Math.floor(((frame + 1) * 100) / 60) - Math.floor((frame * 100) / 60);
    for (let k = 0; k < due; k++) store.push(words[at++ % words.length] ?? "");
    const t0 = performance.now();
    f.tick();
    times.push(performance.now() - t0);
  }
  const s = store.stats();
  assert.equal(s.deltas, 300);
  assert.equal(s.appends, FRAMES);
  assert.equal(seen, s.notifications);
  assert.equal(s.notifications, FRAMES, "one notification per frame, not one per delta");
  assert.equal(store.getSnapshot().version, FRAMES);
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Infinity;
  assert.ok(p95 < 4, `the per-frame work (coalesce, parse the open block, notify) has p95 ${p95.toFixed(2)} ms, far under the 16.7 ms frame`);
});
