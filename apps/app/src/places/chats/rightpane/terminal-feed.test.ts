// The client's screen built from the stream's numbered messages (rc.44): a screen replaces, a diff applies only on the number it was made against, anything else asks for the whole screen, and the result is the
// same screen the server has.
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FEED, applyFeed, parseFeed } from "./terminal-feed.ts";
import type { Feed, FeedMessage } from "./terminal-feed.ts";

const meta = { cols: 80, rows: 24, cursor: { x: 1, y: 0 }, history: 0, hidden: false };

test("a screen replaces everything; a diff on its number changes it; the capture is the screen's text with its facts", () => {
  let f: Feed = EMPTY_FEED;
  const s = applyFeed(f, { t: "screen", rev: 3, text: "a\nb\nc", ...meta });
  f = s.feed;
  assert.equal(s.capture?.text, "a\nb\nc");
  assert.equal(f.rev, 3);
  const d = applyFeed(f, {
    t: "diff",
    rev: 4,
    base: 3,
    top: 1,
    at: 2,
    drop: 0,
    ins: ["d"],
    ...meta,
    cursor: { x: 2, y: 2 },
  });
  assert.equal(d.capture?.text, "b\nc\nd");
  assert.deepEqual(d.capture?.cursor, { x: 2, y: 2 });
  assert.equal(d.feed.rev, 4);
});

test("a diff that does not follow the number the viewer has is not applied: it asks for the whole screen", () => {
  const f = applyFeed(EMPTY_FEED, { t: "screen", rev: 3, text: "a", ...meta }).feed;
  const gap = applyFeed(f, { t: "diff", rev: 6, base: 5, top: 0, at: 1, drop: 0, ins: ["x"], ...meta });
  assert.equal(gap.resync, true);
  assert.equal(gap.capture, undefined);
  assert.equal(gap.feed, f);
  const before = applyFeed(EMPTY_FEED, { t: "diff", rev: 1, base: 0, top: 0, at: 0, drop: 0, ins: [], ...meta });
  assert.equal(before.resync, true, "no screen yet");
  const misfit = applyFeed(f, { t: "diff", rev: 4, base: 3, top: 9, at: 0, drop: 0, ins: [], ...meta });
  assert.equal(misfit.resync, true, "a diff that does not fit the lines");
});

test("ok keeps the screen when current, asks again when not; refused carries the reason; unknown messages change nothing", () => {
  const f = applyFeed(EMPTY_FEED, { t: "screen", rev: 3, text: "a", ...meta }).feed;
  assert.deepEqual(applyFeed(f, { t: "ok", rev: 3 }), { feed: f });
  assert.equal(applyFeed(f, { t: "ok", rev: 9 }).resync, true);
  assert.equal(applyFeed(f, { t: "refused", reason: "no ticket" }).refused, "no ticket");
  assert.deepEqual(applyFeed(f, { t: "pong" } as FeedMessage), { feed: f });
});

test("a text frame is read only when it is a message of the stream", () => {
  assert.deepEqual(parseFeed('{"t":"ok","rev":1}'), { t: "ok", rev: 1 });
  assert.equal(parseFeed("nope"), null);
  assert.equal(parseFeed("[]"), null);
  assert.equal(parseFeed('{"x":1}'), null);
});
