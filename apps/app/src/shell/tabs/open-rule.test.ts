// What opens where (team/v1/TABS-2026-11-15.md, D1 to D8): one rule for every place. The table the rule answers, row by row.
import test from "node:test";
import assert from "node:assert/strict";
import { openPlan } from "./open-rule.ts";
import { afterClosing, openTab, placeTab, selectTab, newTabEntry } from "./store.ts";
import type { TabsState } from "./store.ts";
import { forgetOpenHow, howOfPress, openIn, startOpenHow, takeOpenHow } from "./open-how.ts";

const keys = (s: TabsState): string[] => s.tabs.map((t) => t.key);
const base = (): TabsState => openTab({ tabs: [], active: "" }, placeTab("chats", "subject=thread:th_1", "One"));

test("a plain press on a row inside the place on screen is a step in this tab", () => {
  const p = openPlan(base(), { place: "chats", hash: "subject=thread:th_2", how: "here" });
  assert.deepEqual(p, { do: "step" });
});

test("a plain press on the item already shown opens (selects) it: nothing to step to", () => {
  assert.deepEqual(openPlan(base(), { place: "chats", hash: "subject=thread:th_1", how: "here" }), {
    do: "open",
    background: false,
  });
});

test("a thing of another place opens a tab; a link from outside is never a step", () => {
  assert.deepEqual(openPlan(base(), { place: "files", hash: "subject=file:fil_1", how: "here" }), {
    do: "open",
    background: false,
  });
  assert.deepEqual(openPlan(base(), { place: "chats", hash: "subject=thread:th_2", how: "here", link: true }), {
    do: "open",
    background: false,
  });
});

test("Cmd-press, middle-press and Open in new tab: a tab beside this one that is shown; with Shift, left behind", () => {
  assert.deepEqual(openPlan(base(), { place: "chats", hash: "subject=thread:th_2", how: "tab" }), {
    do: "open",
    background: false,
  });
  assert.deepEqual(openPlan(base(), { place: "chats", hash: "subject=thread:th_2", how: "behind" }), {
    do: "open",
    background: true,
  });
});

test("the rail goes to the place (no item); an address with no item lands on the place's own tab", () => {
  assert.deepEqual(openPlan(base(), { place: "files", hash: undefined, how: "here" }), {
    do: "open",
    background: false,
  });
  assert.deepEqual(openPlan(base(), { place: "chats", hash: "", how: "here" }), { do: "land" });
});

test("on a New tab a press is an open, never a step of the empty tab", () => {
  const s = openTab(base(), newTabEntry("chats", base()));
  assert.deepEqual(openPlan(s, { place: "chats", hash: "subject=thread:th_2", how: "here" }), {
    do: "open",
    background: false,
  });
});

test("a new tab opens beside the selected one, after the tabs it already opened; the same thing twice selects the tab", () => {
  let s = base();
  s = openTab(s, placeTab("files"));
  s = openTab(s, placeTab("records"));
  s = selectTab(s, "chats:subject=thread:th_1");
  s = openTab(s, placeTab("chats", "subject=thread:th_2", "Two"));
  s = selectTab(s, "chats:subject=thread:th_1");
  s = openTab(s, placeTab("chats", "subject=thread:th_3", "Three"));
  assert.deepEqual(keys(s), [
    "chats:subject=thread:th_1",
    "chats:subject=thread:th_2",
    "chats:subject=thread:th_3",
    "files",
    "records",
  ]);
  const again = openTab(s, placeTab("chats", "subject=thread:th_2", "Two"));
  assert.equal(again.tabs.length, s.tabs.length, "a thing already open is selected, not opened twice");
  assert.equal(again.active, "chats:subject=thread:th_2");
});

test("opened behind: beside the selected tab, the selection stays", () => {
  let s = openTab(base(), placeTab("files"));
  s = selectTab(s, "chats:subject=thread:th_1");
  const b = openTab(s, placeTab("chats", "subject=thread:th_9", "Nine"), true);
  assert.deepEqual(keys(b), ["chats:subject=thread:th_1", "chats:subject=thread:th_9", "files"]);
  assert.equal(b.active, "chats:subject=thread:th_1");
});

test("closing the selected tab selects the one you came from, else the one on its left", () => {
  const tabs = [
    { key: "a", title: "A", place: "chats" as const },
    { key: "b", title: "B", place: "files" as const },
    { key: "c", title: "C", place: "records" as const, came: "a" },
  ];
  assert.equal(afterClosing(tabs, "c", "c"), "a", "came from A");
  assert.equal(afterClosing([tabs[0]!, tabs[1]!, { ...tabs[2]!, came: "gone" }], "c", "c"), "b", "the left neighbour");
  assert.equal(afterClosing([tabs[0]!, tabs[1]!], "a", "a"), "b", "the first tab falls to the right");
  assert.equal(afterClosing(tabs, "b", "c"), "c", "closing another tab keeps the selection");
});

test("what a press asks for: Cmd or Ctrl and the middle button ask for a tab; with Shift, behind; nothing else asks", () => {
  assert.equal(howOfPress({ button: 0 }), "here");
  assert.equal(howOfPress({ button: 0, shiftKey: true }), "here", "Shift alone is a range, not an open");
  assert.equal(howOfPress({ button: 0, metaKey: true }), "tab");
  assert.equal(howOfPress({ button: 0, ctrlKey: true }), "tab");
  assert.equal(howOfPress({ button: 0, metaKey: true, shiftKey: true }), "behind");
  assert.equal(howOfPress({ button: 1 }), "tab");
  assert.equal(howOfPress({ button: 1, shiftKey: true }), "behind");
});

test("the ask is taken once by the next open and lapses after a second", () => {
  forgetOpenHow();
  let t = 1000;
  const now = (): number => t;
  openIn("tab", () => undefined, now);
  t += 400;
  assert.equal(takeOpenHow(now), "tab");
  assert.equal(takeOpenHow(now), "here", "taken once");
  openIn("behind", () => undefined, now);
  t += 1500;
  assert.equal(takeOpenHow(now), "here", "a press that opened nothing never changes a later open");
});

test("the window watcher takes the ask at the button going down, and a plain press clears it", () => {
  forgetOpenHow();
  const handlers = new Map<string, (e: unknown) => void>();
  const doc = {
    addEventListener: (t: string, f: (e: never) => void): void => void handlers.set(t, f as (e: unknown) => void),
    removeEventListener: (t: string): void => void handlers.delete(t),
  };
  const stop = startOpenHow(doc, () => 5);
  handlers.get("pointerdown")!({ button: 0, metaKey: true });
  assert.equal(
    takeOpenHow(() => 6),
    "tab",
  );
  handlers.get("pointerdown")!({ button: 0, metaKey: true, shiftKey: true });
  handlers.get("pointerdown")!({ button: 0 });
  assert.equal(
    takeOpenHow(() => 6),
    "here",
    "a plain press after it asks for nothing",
  );
  handlers.get("mousedown")!({ button: 1, preventDefault: () => undefined });
  assert.equal(
    takeOpenHow(() => 6),
    "tab",
    "the middle button asks for a tab",
  );
  let clicked = 0;
  handlers.get("auxclick")!({ button: 1, preventDefault: () => undefined, target: { click: () => void clicked++ } });
  assert.equal(clicked, 1, "without a way to send events the middle press falls back to a click");
  stop();
  assert.equal(handlers.size, 0);
});
