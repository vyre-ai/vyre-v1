// One tab per place, and one per chat or record (lane l-chrome2a): opening a place that already has a tab goes to that tab instead of adding a second "Chats"; two different chats are two tabs and the same chat is one;
// tabs saved with duplicates close the older ones when the Space opens, keeping the one used last.
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TABS, createTabsController, dedupeTabs, openTab, placeTab, readTabs, tabsStorageKey, writeTabs } from "./store.ts";
import type { TabEntry, TabsState, TabsStorage } from "./store.ts";

const tab = (place: TabEntry["place"], hash?: string, title?: string, at?: number): TabEntry => ({ ...placeTab(place, hash, title), ...(at !== undefined ? { at } : {}) });
const state = (tabs: TabEntry[], active: string): TabsState => ({ tabs, active });
const keys = (s: TabsState): string[] => s.tabs.map((t) => t.key);

test("opening a place that has a tab goes to it: the Chats rail while a chat tab is open adds nothing", () => {
  const s = state([tab("home"), tab("chats", "thr_1", "Chats", 1)], "home");
  const next = openTab(s, placeTab("chats"));
  assert.deepEqual(keys(next), keys(s), "no second Chats");
  assert.equal(next.active, "chats:thr_1");
});

test("with several tabs of a place, the one on screen wins, else the one used last", () => {
  const a = tab("chats", "thr_1", "Renewal", 10), b = tab("chats", "thr_2", "Intake", 50);
  assert.equal(openTab(state([tab("home"), a, b], "chats:thr_1"), placeTab("chats")).active, "chats:thr_1", "already on one: stay");
  assert.equal(openTab(state([tab("home"), a, b], "home"), placeTab("chats")).active, "chats:thr_2", "the one used last");
  assert.equal(openTab(state([tab("home"), a, b], "home"), placeTab("chats"), true).active, "home", "a background open changes nothing");
});

test("an item is one tab by what it shows: two chats are two tabs, the same chat twice is one, a new tab is never taken for a place", () => {
  let s = openTab(EMPTY_TABS, placeTab("chats", "thr_1", "Renewal"));
  s = openTab(s, placeTab("chats", "thr_2", "Intake"));
  s = openTab(s, placeTab("chats", "thr_1", "Renewal"));
  assert.deepEqual(keys(s), ["chats:thr_1", "chats:thr_2"]);
  assert.equal(s.active, "chats:thr_1");
  const plus: TabEntry = { key: "new:1", title: "New tab", place: "chats", isNew: true };
  assert.deepEqual(keys(openTab(state([plus], "new:1"), placeTab("chats"))), ["new:1", "chats"], "a + tab is not a Chats tab");
});

test("saved duplicates close on load, keeping the one used last; a place that shows 'Chats' twice keeps one", () => {
  const s = state([tab("chats", "thr_1", "Chats", 5), tab("files"), tab("chats", "thr_2", "Chats", 9), tab("chats", "thr_3", "Intake", 1)], "chats:thr_1");
  const out = dedupeTabs(s);
  assert.deepEqual(keys(out), ["files", "chats:thr_2", "chats:thr_3"], "the older unnamed Chats goes, the named chat stays");
  assert.equal(out.active, "chats:thr_2", "the selection moves to the one that stays");
  const same = state([tab("records", "r1", "Rivera", 2), { ...tab("records", "r1", "Rivera", 8), key: "records:r1" }], "records:r1");
  assert.equal(dedupeTabs({ tabs: [{ ...same.tabs[0]!, key: "x" }, same.tabs[1]!], active: "x" }).tabs.length, 1, "one tab per record");
  assert.equal(dedupeTabs(s) === s, false);
  const clean = state([tab("home"), tab("chats", "thr_1", "Renewal", 1)], "home");
  assert.equal(dedupeTabs(clean), clean, "nothing duplicated: nothing changes");
  const pinned = state([{ ...tab("chats", "thr_1", "Chats", 1), pinned: true }, tab("chats", "thr_2", "Chats", 9)], "chats:thr_2");
  assert.ok(dedupeTabs(pinned).tabs.some((t) => t.pinned === true), "a pinned tab is not closed for being old");
});

test("the controller stamps the tab in use, saves it, and cleans a saved list with two Chats when the Space opens", () => {
  const data = new Map<string, string>();
  const storage: TabsStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  const key = tabsStorageKey("mac", "irfad", "nw");
  data.set(key, writeTabs(state([tab("files", undefined, undefined, 1), tab("chats", "thr_1", "Chats", 5), tab("chats", "thr_2", "Chats", 9)], "chats:thr_1")));
  const c = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "nw", storage, start: "chats" });
  assert.deepEqual(c.state().tabs.map((t) => t.key).filter((k) => k.startsWith("chats")), ["chats:thr_2"], "one Chats left, the one used last");
  c.openPlace("chats");
  assert.equal(c.state().tabs.length, 2, "opening Chats again adds nothing");
  assert.equal(c.state().active, "chats:thr_2");
  c.openPlace("files");
  const stamped = c.state().tabs.find((t) => t.key === "files")!;
  assert.ok((stamped.at ?? 0) > 1_700_000_000_000, "the tab in use carries when it was used");
  assert.ok(readTabs(data.get(key) ?? null)!.tabs.find((t) => t.key === "files")!.at !== undefined, "and it is saved");
});
