// The sidebar's per-person state port and its test double: folds, pin order, the last Notes / Artifacts tab; the layout reads what the port holds.
import test from "node:test";
import assert from "node:assert/strict";
import { buildLayout } from "./layout.ts";
import type { Item } from "./layout.ts";
import { memorySideState, moved } from "./side-state.ts";

const chat = (key: string): Item => ({
  key,
  kind: "chat",
  shape: "agent",
  title: key,
  faces: [],
  unread: 0,
  mentions: 0,
  muted: false,
  draft: false,
  working: false,
  archived: false,
  ask: false,
  ended: false,
  lastAt: 1,
});

test("moved: clamps, keeps the rest in order, ignores a key that is not there", () => {
  assert.deepEqual(moved(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moved(["a", "b", "c"], "a", 99), ["b", "c", "a"]);
  assert.deepEqual(moved(["a", "b", "c"], "b", -3), ["b", "a", "c"]);
  assert.deepEqual(moved(["a", "b"], "z", 0), ["a", "b"]);
});

test("pins keep the person's order; pin moves a pinned key; unpin and unpin all", () => {
  const s = memorySideState();
  s.pin("a");
  s.pin("b");
  s.pin("c");
  s.pin("a");
  assert.deepEqual(s.pins(), ["a", "b", "c"], "pinning what is pinned changes nothing");
  s.pin("d", 0);
  assert.deepEqual(s.pins(), ["d", "a", "b", "c"]);
  s.pin("c", 1);
  assert.deepEqual(s.pins(), ["d", "c", "a", "b"], "pinning at an index moves it there");
  s.move("b", 0);
  assert.deepEqual(s.pins(), ["b", "d", "c", "a"]);
  s.unpin("d");
  assert.deepEqual(s.pins(), ["b", "c", "a"]);
  s.unpinAll();
  assert.deepEqual(s.pins(), []);
});

test("folds are remembered, and a listener hears only real changes", () => {
  const s = memorySideState();
  let n = 0;
  const off = s.subscribe(() => n++);
  s.setFold("chats", true);
  s.setFold("chats", true);
  s.setFold("needs", true);
  s.setFold("chats", false);
  s.setNotesTab("artifacts");
  s.setNotesTab("artifacts");
  off();
  s.setFold("team", true);
  assert.deepEqual([...s.folds()].sort(), ["needs", "team"]);
  assert.equal(s.notesTab(), "artifacts");
  assert.equal(n, 4);
});

test("the layout draws what the port holds: Pinned in the person's order with digits, a folded Chats", () => {
  const items = ["a", "b", "c", "d"].map(chat);
  const s = memorySideState({ pins: ["c", "a"], folds: ["chats"] });
  const l = buildLayout({ items, pins: s.pins(), filter: "all", folded: s.folds(), more: new Set(), open: null });
  const pinned = l.entries.flatMap((e) => (e.type === "row" && e.section === "pinned" ? [`${e.key}:${e.digit}`] : []));
  assert.deepEqual(pinned, ["c:1", "a:2"]);
  const head = l.entries.find((e) => e.type === "head" && e.section === "chats");
  assert.ok(head && head.type === "head" && head.folded);
});
