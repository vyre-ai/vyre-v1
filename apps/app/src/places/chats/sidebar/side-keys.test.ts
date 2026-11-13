// The list's keys (design 2.6): arrows, Home and End, Enter, Left and Right on heads, the Menu key, Escape, F, Cmd-1 to Cmd-9, next unread, a letter into the command bar.
import test from "node:test";
import assert from "node:assert/strict";
import { buildLayout } from "./layout.ts";
import type { Item, ItemKind, LayoutInput, SectionId } from "./layout.ts";
import { LANDS_ON, headOf, listKey, moveKey } from "./side-keys.ts";
import type { ListAction, ListKey } from "./side-keys.ts";

const ROW = { type: "row" } as const;
const HEAD_OPEN = { type: "head", folded: false } as const;
const HEAD_FOLDED = { type: "head", folded: true } as const;

const TABLE: {
  name: string;
  e: ListKey;
  at?: Parameters<typeof listKey>[1];
  want: ListAction | null;
  mac?: boolean;
}[] = [
  { name: "Down", e: { key: "ArrowDown" }, want: { do: "move", to: "down" } },
  { name: "Up", e: { key: "ArrowUp" }, want: { do: "move", to: "up" } },
  { name: "Home", e: { key: "Home" }, want: { do: "move", to: "home" } },
  { name: "End", e: { key: "End" }, want: { do: "move", to: "end" } },
  { name: "Enter", e: { key: "Enter" }, want: { do: "enter" } },
  { name: "Cmd-Enter opens a new tab", e: { key: "Enter", metaKey: true }, want: { do: "openTab" } },
  { name: "Ctrl-Enter on another platform", e: { key: "Enter", ctrlKey: true }, want: { do: "openTab" }, mac: false },
  { name: "Left on a row goes to its head", e: { key: "ArrowLeft" }, at: ROW, want: { do: "toHead" } },
  { name: "Left on an open head folds it", e: { key: "ArrowLeft" }, at: HEAD_OPEN, want: { do: "fold" } },
  { name: "Left on a folded head stays on it", e: { key: "ArrowLeft" }, at: HEAD_FOLDED, want: { do: "toHead" } },
  { name: "Right on a folded head unfolds it", e: { key: "ArrowRight" }, at: HEAD_FOLDED, want: { do: "unfold" } },
  { name: "Right on a row does nothing", e: { key: "ArrowRight" }, at: ROW, want: null },
  { name: "Space on an open head folds it", e: { key: " " }, at: HEAD_OPEN, want: { do: "fold" } },
  { name: "Space on a folded head unfolds it", e: { key: " " }, at: HEAD_FOLDED, want: { do: "unfold" } },
  { name: "Escape", e: { key: "Escape" }, want: { do: "escape" } },
  { name: "F opens the filter", e: { key: "f" }, want: { do: "filter" } },
  { name: "Cmd-3 opens the third pinned row", e: { key: "3", metaKey: true }, want: { do: "pinned", n: 3 } },
  { name: "Cmd-9", e: { key: "9", code: "Digit9", metaKey: true }, want: { do: "pinned", n: 9 } },
  {
    name: "Cmd-Shift-1 is the shell's (a Space), not a pinned row",
    e: { key: "!", code: "Digit1", metaKey: true, shiftKey: true },
    want: null,
  },
  {
    name: "Option-Shift-Down: next unread",
    e: { key: "ArrowDown", altKey: true, shiftKey: true },
    want: { do: "unread", dir: 1 },
  },
  {
    name: "Option-Shift-Up: previous unread",
    e: { key: "ArrowUp", altKey: true, shiftKey: true },
    want: { do: "unread", dir: -1 },
  },
  { name: "Shift-Cmd-C copies the link", e: { key: "C", metaKey: true, shiftKey: true }, want: { do: "copyLink" } },
  { name: "a letter opens the command bar with it", e: { key: "q" }, want: { do: "search", text: "q" } },
  { name: "a capital letter too", e: { key: "Q", shiftKey: true }, want: { do: "search", text: "Q" } },
  { name: "Tab is the browser's", e: { key: "Tab" }, want: null },
  { name: "Option alone is not ours", e: { key: "x", altKey: true }, want: null },
];
for (const c of TABLE)
  test(`list key: ${c.name}`, () => assert.deepEqual(listKey(c.e, c.at ?? null, c.mac ?? true), c.want));

test("the arrows stay inside the list: Down at the end stays, Up at the top stays, a cursor outside starts at the ends", () => {
  const keys = ["a", "b", "c"];
  assert.equal(moveKey(keys, "c", "down"), "c");
  assert.equal(moveKey(keys, "a", "up"), "a");
  assert.equal(moveKey(keys, "a", "down"), "b");
  assert.equal(moveKey(keys, null, "down"), "a");
  assert.equal(moveKey(keys, null, "up"), "c");
  assert.equal(moveKey(keys, "b", "home"), "a");
  assert.equal(moveKey(keys, "b", "end"), "c");
  assert.equal(moveKey([], "a", "down"), null);
});

test("every row, head and 'N more' is reachable by arrow; a skeleton, an error and the empty line are not", () => {
  const mk = (kind: ItemKind, n: number): Item => ({
    key: `${kind}:${n}`,
    kind,
    shape: "agent",
    title: "t",
    faces: [],
    unread: 0,
    mentions: 0,
    muted: false,
    draft: false,
    working: false,
    archived: false,
    ask: false,
    ended: false,
    lastAt: n,
  });
  const items = Array.from({ length: 10 }, (_, n) => mk("chat", n));
  const input: LayoutInput = {
    items,
    pins: [],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
    failed: new Set<SectionId>(["channels"]),
  };
  const l = buildLayout(input);
  const reach = l.entries.filter((e) => LANDS_ON.includes(e.type)).map((e) => e.type);
  assert.deepEqual(reach.slice(0, 2), ["tasks", "head"]);
  assert.ok(reach.includes("more"));
  assert.ok(!l.entries.some((e) => e.type === "error" && LANDS_ON.includes(e.type)));
  const head = l.entries.find((e) => e.type === "head")!;
  const row = l.entries.find((e) => e.type === "row")!;
  assert.equal(headOf(l.entries, row.key), head.key, "Left on a row goes to its head");
  assert.equal(headOf(l.entries, "tasks"), null);
});
