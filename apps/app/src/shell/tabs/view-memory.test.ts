// Back restores where the person was: the scroll of the page and of the list come back (NAV-2026-11-14 rules 1 and 7).
import test from "node:test";
import assert from "node:assert/strict";
import { bodyKey, forgetScrolls, recalled, rememberScroll, sideKey, startViewMemory } from "./view-memory.ts";

interface El {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  id: string;
  region: "body" | "side";
  getAttribute(n: string): string | null;
  closest(sel: string): unknown;
}
const el = (id: string, region: "body" | "side", top: number, height = 5000): El => ({
  scrollTop: top,
  scrollHeight: height,
  clientHeight: 500,
  id,
  region,
  getAttribute: (n) => (n === "data-testid" ? id : null),
  closest: (sel) => (sel.includes(region === "side" ? "place-sidebar" : "place-body") ? {} : null),
});

function world(els: El[]) {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const listeners = new Set<() => void>();
  let frames: (() => void)[] = [];
  let t = 0;
  const doc = {
    addEventListener: (type: string, f: (e: never) => void): void => void handlers.set(type, [...(handlers.get(type) ?? []), f as (e: unknown) => void]),
    removeEventListener: (type: string): void => void handlers.delete(type),
    querySelectorAll: (sel: string) => els.filter((e) => sel === `[data-testid="${e.id}"]`),
  };
  const at = { tab: "chats", hash: "a" };
  const stop = startViewMemory(doc, () => ({ ...at }), (l) => (listeners.add(l), () => listeners.delete(l)), {
    raf: (f) => (frames.push(f), frames.length),
    caf: () => undefined,
    now: () => t,
  });
  return {
    stop,
    go(tab: string, hash: string) {
      at.tab = tab;
      at.hash = hash;
      for (const l of [...listeners]) l();
    },
    emit(type: string, e: unknown) {
      for (const f of handlers.get(type) ?? []) f(e);
    },
    tick(n = 1, ms = 16) {
      for (let i = 0; i < n; i++) {
        t += ms;
        const run = frames;
        frames = [];
        for (const f of run) f();
      }
    },
  };
}

test("scrolling is remembered per tab and address, and per tab for the list; a view that is only filling in records nothing", () => {
  forgetScrolls();
  rememberScroll(bodyKey("chats", "a"), "stream-list#0", { scrollTop: 900, scrollHeight: 5000, clientHeight: 500 });
  const feed = el("stream-list", "body", 0);
  const list = el("sidebar-list", "side", 0);
  const w = world([feed, list]);
  feed.scrollTop = 4500; // the chat filling in jumps to its end
  w.emit("scroll", { target: feed });
  assert.deepEqual(recalled(bodyKey("chats", "a")), { "stream-list#0": { y: 900 } }, "what was remembered is kept until the person has touched the page");
  w.emit("wheel", {});
  feed.scrollTop = 1200;
  w.emit("scroll", { target: feed });
  list.scrollTop = 300;
  w.emit("scroll", { target: list });
  assert.deepEqual(recalled(bodyKey("chats", "a")), { "stream-list#0": { y: 1200 } });
  assert.deepEqual(recalled(sideKey("chats")), { "sidebar-list#0": { y: 300 } });
  w.stop();
});

test("coming back to an address puts the scrollers where they were; a list left at its end is left to follow the end", () => {
  forgetScrolls();
  const feed = el("stream-list", "body", 0);
  const list = el("sidebar-list", "side", 0);
  const w = world([feed, list]);
  w.emit("wheel", {});
  feed.scrollTop = 1200;
  w.emit("scroll", { target: feed });
  list.scrollTop = 4500;
  w.emit("scroll", { target: list });
  assert.equal(recalled(sideKey("chats"))?.["sidebar-list#0"]?.y, -1, "at the end is remembered as the end");
  w.go("files", "x");
  feed.scrollTop = 0; // another view draws, its scroller starts at the top
  w.go("chats", "a");
  w.tick(3);
  assert.equal(feed.scrollTop, 1200, "the chat is at the same place");
  assert.equal(list.scrollTop, 4500, "a list left at its end is back at its end");
  w.stop();
});

test("restoring waits for the content to be tall enough and gives up when the person scrolls", () => {
  forgetScrolls();
  rememberScroll(bodyKey("chats", "a"), "stream-list#0", { scrollTop: 2000, scrollHeight: 5000, clientHeight: 500 });
  const feed = el("stream-list", "body", 0, 600);
  const w = world([feed]);
  w.go("files", "x");
  w.go("chats", "a");
  w.tick(2);
  assert.equal(feed.scrollTop, 0, "the page is still too short");
  feed.scrollHeight = 5000;
  w.tick(1);
  assert.equal(feed.scrollTop, 2000);
  w.emit("wheel", {});
  feed.scrollTop = 100;
  w.tick(3);
  assert.equal(feed.scrollTop, 100, "a hand on the page ends the restoring");
  w.stop();
});

test("a view that does not scroll leaves nothing behind", () => {
  forgetScrolls();
  rememberScroll("k", "s#0", { scrollTop: 10, scrollHeight: 5000, clientHeight: 500 });
  rememberScroll("k", "s#0", { scrollTop: 0, scrollHeight: 400, clientHeight: 500 });
  assert.deepEqual(recalled("k"), {});
});

test("what was at the top edge is put back at the same distance, even when history has arrived above it since", () => {
  forgetScrolls();
  const feed = el("stream-list", "body", 1612);
  // the message sits at a place in the feed's content; where it shows depends on how far the feed is scrolled
  let contentY = 1612 + 30;
  const rowTop = (): number => 100 + contentY - feed.scrollTop;
  const mock = feed as unknown as Record<string, unknown>;
  mock["getBoundingClientRect"] = () => ({ top: 100, bottom: 600 });
  mock["querySelectorAll"] = () => [
    { getAttribute: () => "msg-41", getBoundingClientRect: () => ({ top: rowTop(), bottom: rowTop() + 60 }) },
  ];
  mock["querySelector"] = () => ({ getBoundingClientRect: () => ({ top: rowTop(), bottom: rowTop() + 60 }) });
  rememberScroll(bodyKey("chats", "a"), "stream-list#0", feed as never);
  assert.deepEqual(recalled(bodyKey("chats", "a")), { "stream-list#0": { y: 1612, anchor: { id: "msg-41", off: 30 } } });
  const w = world([feed]);
  w.go("files", "x");
  feed.scrollTop = 0;
  // the chat comes back with older messages drawn above: the same message now sits 400 px further down the content
  contentY += 400;
  w.go("chats", "a");
  w.tick(2);
  assert.equal(feed.scrollTop, 1612 + 400, "the page moved so the same message is where it was");
  w.stop();
});
