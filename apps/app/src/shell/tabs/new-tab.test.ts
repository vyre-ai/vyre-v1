// "+" then a place: the place takes the New tab, no empty tab is left behind (owner, 15 Nov 2026; team/v1/TABS-2026-11-15.md, D5 and D1).
import test from "node:test";
import assert from "node:assert/strict";
import { landOn, newTabEntry, openTab, placeTab, selectTab } from "./store.ts";
import type { TabsState } from "./store.ts";

const keys = (s: TabsState): string[] => s.tabs.map((t) => t.key);
const start = (): TabsState => openTab({ tabs: [], active: "" }, placeTab("chats"));
const plus = (s: TabsState): TabsState => openTab(s, newTabEntry("chats", s));

test("a place chosen from an untouched New tab takes that tab's spot; nothing empty is left", () => {
  let s = plus(start());
  const fresh = s.active;
  assert.equal(s.tabs.find((t) => t.key === fresh)?.isNew, true);
  s = landOn(s, "files");
  assert.deepEqual(keys(s), ["chats", "files"], "one tab for Chats, one for Files, no New tab");
  assert.equal(s.active, "files");
  // again, with the New tab in the middle of the strip: the place lands where the New tab was
  s = openTab(s, placeTab("records"));
  s = selectTab(s, "chats");
  const mid = newTabEntry("chats", s);
  s = { tabs: [s.tabs[0]!, mid, ...s.tabs.slice(1)], active: mid.key };
  s = landOn(s, "vault");
  assert.deepEqual(keys(s), ["chats", "vault", "files", "records"]);
  assert.equal(s.active, "vault");
});

test("a place that already has a tab: that tab is selected and the empty New tab goes", () => {
  let s = openTab(start(), placeTab("files"));
  s = plus(s);
  s = landOn(s, "files");
  assert.deepEqual(keys(s), ["chats", "files"]);
  assert.equal(s.active, "files");
});

test("an item opened from a New tab does not point back at the tab that is gone", () => {
  let s = plus(start());
  const fresh = s.active;
  s = openTab(s, placeTab("files", "subject=file:fil_1", "Notes.md"));
  assert.equal(
    s.tabs.some((t) => t.key === fresh),
    false,
  );
  assert.equal(s.tabs.find((t) => t.key === s.active)?.from, undefined);
});

test("what does NOT take the New tab: choosing another tab by hand, opening behind, and a second New tab", () => {
  let s = plus(start());
  const fresh = s.active;
  const picked = selectTab(s, "chats");
  assert.equal(
    picked.tabs.some((t) => t.key === fresh),
    true,
    "pressing another tab leaves the New tab where it is, as a browser does",
  );
  const behind = openTab(s, placeTab("files", "subject=file:fil_2", "Plan.md"), true);
  assert.equal(behind.active, fresh, "opened behind: still on the New tab");
  assert.equal(
    behind.tabs.some((t) => t.key === fresh),
    true,
  );
  const two = plus(s);
  assert.equal(two.tabs.filter((t) => t.isNew === true).length, 2);
});
