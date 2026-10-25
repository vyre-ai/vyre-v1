// Streaming render (ARCH 9, perf stream_render and layout_shift): 100 deltas a second become at most one append per frame, only the open block of the markdown is parsed again, final blocks keep
// their identity so React skips them, and every box that arrives late is reserved at its final size. The browser-side numbers (frame interval under a 100 delta/s stream, layout shift 0) are the
// shots scroll probe on scripts/shots/mounts/P-L9_20.tsx; this file proves the mechanism that keeps them.
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

test("stream_render: 100 deltas a second for three seconds are at most one append per frame", () => {
  const f = manualFrames();
  const got: string[] = [];
  const c = createCoalescer((t) => got.push(t), f.scheduler);
  let sent = "";
  let n = 0;
  const FRAMES = 180; // 3 s at 60 Hz
  for (let frame = 0; frame < FRAMES; frame++) {
    // 100 deltas a second at 60 frames a second is 1 or 2 deltas a frame
    const due = Math.floor(((frame + 1) * 100) / 60) - Math.floor((frame * 100) / 60);
    for (let k = 0; k < due; k++) { const d = `w${n++} `; sent += d; c.push(d); }
    f.tick();
  }
  assert.equal(c.stats.deltas, 300);
  assert.ok(c.stats.flushes <= FRAMES, `${c.stats.flushes} flushes in ${FRAMES} frames`);
  assert.equal(c.stats.flushes, FRAMES, "a delta arrived in every frame, so every frame had exactly one flush");
  assert.equal(got.join(""), sent, "nothing lost, nothing reordered");
  assert.equal(c.waiting, false);
});

test("a burst of deltas inside one frame is one flush, and a frame with nothing waiting does nothing", () => {
  const f = manualFrames();
  const got: string[] = [];
  const c = createCoalescer((t) => got.push(t), f.scheduler);
  for (let i = 0; i < 50; i++) c.push(String(i % 10));
  assert.equal(f.pending, 1, "one frame is requested however many deltas come");
  f.tick();
  assert.equal(got.length, 1);
  assert.equal(got[0]?.length, 50);
  assert.equal(c.stats.maxBatch, 50);
  assert.equal(f.tick(), false, "no request, no frame");
  c.push("");
  assert.equal(f.pending, 0, "an empty delta is nothing");
  assert.equal(c.stats.deltas, 50);
});

test("flush delivers at once and the frame that was asked for delivers nothing more; cancel drops what waits", () => {
  const f = manualFrames();
  const got: string[] = [];
  const c = createCoalescer((t) => got.push(t), f.scheduler);
  c.push("ab");
  c.push("cd");
  c.flush();
  assert.deepEqual(got, ["abcd"]);
  assert.equal(f.pending, 0, "the frame request was cancelled");
  f.tick();
  assert.deepEqual(got, ["abcd"]);
  c.push("lost");
  c.cancel();
  f.tick();
  assert.deepEqual(got, ["abcd"]);
  c.push("again");
  f.tick();
  assert.deepEqual(got, ["abcd", "again"], "it works again after a cancel");
});

// ---- incremental markdown

const DOC = [
  "# Plan for the intake form",
  "",
  "The form has **three steps** and one `submit` button. Read the [guide](https://example.com/guide) first, or _skip it_.",
  "",
  "1. Collect the name",
  "2. Ask for a phone number",
  "3. Send a confirmation",
  "",
  "```ts",
  "const ok = true;",
  "",
  "if (ok) send();",
  "```",
  "",
  "> Keep it short.",
  "",
  "- first point",
  "- second point that runs on and on",
  "",
  "Done.",
  "",
].join("\n");

test("fed one character at a time, the incremental parser ends at exactly the blocks of a parse of the whole text", () => {
  const md = createIncrementalMarkdown();
  for (const ch of DOC) md.append(ch);
  md.finish();
  const whole = parseChunk(DOC, 0);
  assert.deepEqual(md.view().blocks, whole);
  assert.deepEqual(whole.map((b) => b.kind), ["h", "p", "ol", "code", "quote", "ul", "p"]);
  const code = whole.find((b) => b.kind === "code");
  assert.ok(code && code.kind === "code" && code.closed && code.text === "const ok = true;\n\nif (ok) send();", "a blank line inside a fence does not end the block");
});

test("a final block is parsed once and is the same object from then on; only the open block changes", () => {
  const md = createIncrementalMarkdown();
  md.append("First paragraph.\n\nSecond ");
  const a = md.view();
  assert.equal(a.closedCount, 1);
  assert.equal(a.blocks.length, 2);
  md.append("paragraph is");
  const b = md.view();
  assert.equal(b.blocks[0], a.blocks[0], "the final block is the same object");
  assert.notEqual(b.blocks[1], a.blocks[1], "the open block is new");
  md.append(" long.\n\nThird.");
  const c = md.view();
  assert.equal(c.closedCount, 2);
  assert.equal(c.blocks[0], a.blocks[0]);
  assert.equal(md.stats.closedParses, 2);
  const again = md.view();
  assert.equal(again, c, "asking twice without an append is free");
});

test("the cost of the open block follows the open block, not the message: 8,000 characters in 5-character deltas", () => {
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${"lorem ipsum dolor sit amet ".repeat(7)}`.slice(0, 200));
  const text = `${paragraphs.join("\n\n")}\n\n`;
  const md = createIncrementalMarkdown();
  let naive = 0;
  let calls = 0;
  for (let at = 0; at < text.length; at += 5) {
    md.append(text.slice(at, at + 5));
    md.view();
    calls++;
    naive += Math.min(text.length, at + 5);
  }
  assert.equal(md.stats.closedParses, 40);
  assert.equal(md.stats.openParses <= calls, true);
  assert.ok(md.stats.openChars * 10 < naive, `open parses covered ${md.stats.openChars} characters; parsing everything each time would cover ${naive}`);
});

test("unfinished markup stays text until it is finished", () => {
  const md = createIncrementalMarkdown();
  md.append("Use **bold");
  let p = md.view().blocks[0];
  assert.ok(p && p.kind === "p");
  assert.deepEqual(p.inline, [{ t: "text", v: "Use **bold" }]);
  md.append("** and `co");
  p = md.view().blocks[0];
  assert.deepEqual(p && p.kind === "p" ? p.inline : null, [{ t: "text", v: "Use " }, { t: "strong", c: [{ t: "text", v: "bold" }] }, { t: "text", v: " and `co" }]);
  md.append("de` and [a link](https://exa");
  p = md.view().blocks[0];
  assert.ok(p && p.kind === "p" && !p.inline.some((n) => n.t === "link"), "a link without its closing bracket is text");
  md.append("mple.com)");
  p = md.view().blocks[0];
  assert.ok(p && p.kind === "p" && p.inline.some((n) => n.t === "link" && n.href === "https://example.com"));
});

test("a code fence that is still open is one open block; its closing makes it final", () => {
  const md = createIncrementalMarkdown();
  md.append("Run this:\n\n```sh\nnpm test\n\nnpm run build");
  let v = md.view();
  assert.equal(v.closedCount, 1);
  const open = v.blocks[1];
  assert.ok(open && open.kind === "code" && !open.closed && open.text === "npm test\n\nnpm run build");
  md.append("\n```\n");
  v = md.view();
  assert.equal(v.closedCount, 2);
  assert.ok(v.blocks[1]?.kind === "code" && v.blocks[1].closed);
});

test("an ordered list split by a blank line keeps its numbers, and links are only web or mail addresses", () => {
  const md = createIncrementalMarkdown();
  md.append("1. one\n\n2. two\n\n");
  const kinds = md.view().blocks.map((b) => (b.kind === "ol" ? `ol${b.start}` : b.kind));
  assert.deepEqual(kinds, ["ol1", "ol2"]);
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [{ t: "text", v: "[x](javascript:alert(1))" }]);
  assert.deepEqual(parseInline("[x](https://a.example)"), [{ t: "link", href: "https://a.example", c: [{ t: "text", v: "x" }] }]);
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "text", v: "2 * 3 * 4" }]);
  assert.deepEqual(parseInline("snake_case_name"), [{ t: "text", v: "snake_case_name" }]);
  assert.deepEqual(parseInline("\\*not em\\*"), [{ t: "text", v: "*not em*" }]);
});

// ---- the store

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

test("end shows what is waiting, makes the last block final and stops the stream; reset starts again", () => {
  const f = manualFrames();
  const store = createStreamStore(f.scheduler);
  store.push("Hello ");
  store.push("world");
  store.end();
  let snap = store.getSnapshot();
  assert.equal(snap.done, true);
  assert.equal(snap.closedCount, 1, "the last paragraph is final");
  assert.equal(snap.blocks.length, 1);
  store.push("ignored");
  f.tick();
  assert.equal(store.getSnapshot(), snap);
  store.reset();
  snap = store.getSnapshot();
  assert.equal(snap.done, false);
  assert.equal(snap.blocks.length, 0);
  store.push("New");
  f.tick();
  assert.equal(store.getSnapshot().blocks.length, 1);
});

test("a reader that unsubscribes is not called again", () => {
  const f = manualFrames();
  const store = createStreamStore(f.scheduler);
  let calls = 0;
  const off = store.subscribe(() => { calls++; });
  store.push("a");
  f.tick();
  off();
  store.push("b");
  f.tick();
  assert.equal(calls, 1);
});

// ---- drawing

test("the caret is drawn once, at the end of the open block, and not on final blocks", () => {
  const md = createIncrementalMarkdown();
  md.append("Done paragraph.\n\nStill writing **bo");
  const v = md.view();
  const html = renderToStaticMarkup(<MarkdownBlocks blocks={v.blocks} streaming />);
  assert.equal(html.match(new RegExp(CARET, "g"))?.length, 1);
  assert.ok(html.indexOf("Done paragraph.") < html.indexOf(CARET));
  assert.ok(html.indexOf(CARET) > html.indexOf("Still writing"));
  assert.doesNotMatch(html, /stream-caret/, "the caret is a character of the text, not an element that could move and shift the layout");
  const finished = renderToStaticMarkup(<MarkdownBlocks blocks={v.blocks} />);
  assert.doesNotMatch(finished, new RegExp(CARET));
});

test("StreamText reads the store's snapshot", () => {
  const f = manualFrames();
  const store = createStreamStore(f.scheduler);
  store.push("# Title\n\nBody text");
  f.tick();
  const html = renderToStaticMarkup(<StreamText store={store} />);
  assert.match(html, /Title/);
  assert.match(html, /Body text/);
  assert.match(html, new RegExp(CARET));
  store.end();
  assert.doesNotMatch(renderToStaticMarkup(<StreamText store={store} />), new RegExp(CARET));
});

test("markdown blocks draw lists with their numbers, quotes and code", () => {
  const html = renderToStaticMarkup(<MarkdownBlocks blocks={parseChunk("3. three\n4. four\n\n> quoted\n\n```\ncode here\n```\n\n- a\n- b", 0)} />);
  assert.match(html, />3\.</);
  assert.match(html, />4\.</);
  assert.match(html, /quoted/);
  assert.match(html, /code here/);
  assert.equal(html.match(/•/g)?.length, 2);
});

// ---- reserved sizes

test("layout_shift: an image, an avatar and a skeleton have their size before anything arrives", () => {
  const img = renderToStaticMarkup(<ReservedImage uri="https://example.com/a.png" width={600} height={400} label="Floor plan" />);
  assert.match(img, /aspect-ratio:\s*1\.5/);
  assert.match(img, /max-width:\s*600px/);
  const av = renderToStaticMarkup(<AvatarSlot label="Intake" />);
  assert.match(av, new RegExp(`width:${AVATAR_SIZE}px`));
  assert.match(av, new RegExp(`height:${AVATAR_SIZE}px`));
  assert.match(av, />I</);
  const sk = renderToStaticMarkup(<SkeletonMessage lines={3} />);
  assert.match(sk, new RegExp(`height:${messageHeight(3)}px`));
  assert.equal(messageHeight(3), HEADER_HEIGHT + 3 * BODY_LINE);
  assert.equal(messageHeight(0, false), BODY_LINE, "at least one line");
  const bare = renderToStaticMarkup(<SkeletonMessage lines={2} withHeader={false} />);
  assert.match(bare, new RegExp(`height:${2 * BODY_LINE}px`));
});

test("a one-paragraph message and the skeleton that stood in for it are the same height", () => {
  assert.equal(messageHeight(1), HEADER_HEIGHT + BODY_LINE);
  assert.equal(HEADER_HEIGHT, 26);
  assert.equal(BODY_LINE, 24);
});

test("following the end: at the end within 24 px, away beyond it", () => {
  assert.equal(isAtEnd(1000, 600, 1600), true);
  assert.equal(isAtEnd(980, 600, 1600), true);
  assert.equal(isAtEnd(900, 600, 1600), false);
  assert.equal(isAtEnd(0, 600, 500), true, "content shorter than the viewport is at its end");
});
