// One tab per place, and one per chat or record (lane l-chrome2a): opening a place that already has a tab goes to that tab instead of adding a second "Chats"; two different chats are two tabs and the same chat is one;
// tabs saved with duplicates close the older ones when the Space opens, keeping the one used last.
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TABS, createTabsController, dedupeTabs, openTab, placeTab, readTabs, screenTitle, tabsStorageKey, writeTabs } from "./store.ts";
import { firstMessageTitle, titleAsk } from "./titles.ts";
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

test("saved duplicates close on load, keeping the one used last; different chats never count as duplicates", () => {
  const s = state([tab("chats", "thr_1", "Renewal", 5), tab("files"), tab("chats", "thr_1", "Renewal", 9), tab("chats", "thr_3", "Intake", 1)], "chats:thr_1");
  const out = dedupeTabs({ ...s, tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, key: "dup" } : t)) });
  assert.deepEqual(out.tabs.map((t) => t.at), [undefined, 9, 1], "the same chat twice: the one used last");
  const same = state([{ ...tab("records", "r1", "Rivera", 2), key: "x" }, tab("records", "r1", "Rivera", 8)], "x");
  assert.equal(dedupeTabs(same).tabs.length, 1, "one tab per record");
  assert.equal(dedupeTabs(same).active, "records:r1", "the selection moves to the one that stays");
  const clean = state([tab("home"), tab("chats", "thr_1", "Renewal", 1)], "home");
  assert.equal(dedupeTabs(clean), clean, "nothing duplicated: nothing changes");
  const pinned = state([{ ...tab("records", "r1", "A", 1), pinned: true, key: "p" }, tab("records", "r1", "A", 9)], "records:r1");
  assert.ok(dedupeTabs(pinned).tabs.some((t) => t.pinned === true), "a pinned tab is not closed for being old");
});

test("an unnamed chat tab is a different chat from the Chats place: both survive load, and the chat shows a real title, never Chats", () => {
  const raw = writeTabs(state([tab("chats", undefined, undefined, 20), { key: "chats:subject=thread:thr_9", title: "Chats", place: "chats", hash: "subject=thread:thr_9", at: 10 }, { key: "chats:subject=thread:thr_8", title: "Chats", place: "chats", hash: "subject=thread:thr_8", at: 5 }], "chats"));
  const read = dedupeTabs(readTabs(raw)!);
  assert.equal(read.tabs.length, 3, "nothing closed");
  assert.deepEqual(read.tabs.map((t) => t.title), ["Chats", "New chat", "New chat"]);
  assert.equal(screenTitle("subject=thread:thr_1"), "New chat");
  assert.equal(screenTitle("subject=chat:c1"), "New chat");
});

test("a chat is named for itself: its name, else its first message cut short, else New chat", () => {
  const ask = titleAsk({ type: "thread", id: "thr_1" })!;
  assert.equal(ask.name({ thread: { title: "Renewal" } }), "Renewal");
  assert.equal(ask.name({ thread: {} }), null);
  assert.equal(ask.next?.cap, "chat.messages.list");
  assert.equal(ask.empty, "New chat");
  assert.equal(firstMessageTitle({ messages: [{ body: "  " }, { body: "Can you draft the\nrenewal letter for the Rivera account before Friday?" }] }), "Can you draft the renewal lette\u2026");
  assert.equal(firstMessageTitle({ messages: [{ body: "Hello" }] }), "Hello");
  assert.equal(firstMessageTitle({ messages: [] }), null);
});

test("the controller stamps the tab in use, saves it, and closes a saved duplicate when the Space opens", () => {
  const data = new Map<string, string>();
  const storage: TabsStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  const key = tabsStorageKey("mac", "irfad", "nw");
  data.set(key, writeTabs(state([tab("files", undefined, undefined, 1), tab("chats", "thr_1", "Old name", 5), tab("chats", "thr_1", "Renewal", 9)], "chats:thr_1")));
  const c = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "nw", storage, start: "chats" });
  assert.deepEqual(c.state().tabs.filter((t) => t.key.startsWith("chats")).map((t) => t.title), ["Renewal"], "the same chat saved twice: one left, the one used last");
  c.openPlace("chats");
  assert.equal(c.state().tabs.length, 2, "opening Chats again adds nothing");
  assert.equal(c.state().active, "chats:thr_1");
  c.openPlace("files");
  const stamped = c.state().tabs.find((t) => t.key === "files")!;
  assert.ok((stamped.at ?? 0) > 1_700_000_000_000, "the tab in use carries when it was used");
  assert.ok(readTabs(data.get(key) ?? null)!.tabs.find((t) => t.key === "files")!.at !== undefined, "and it is saved");
});

test("one blank chat: starting another focuses the one that is open instead of adding a second tab", () => {
  const data = new Map<string, string>();
  const storage: TabsStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  const c = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "nw", storage, start: "chats" });
  c.openPlace("chats", "subject=thread:thr_1", "New chat");
  c.retitle("chats:subject=thread:thr_1", "New chat", true);
  c.openPlace("files");
  // a second chat is started: it opens as a tab, and once it is known to be blank too it gives way to the first
  c.openPlace("chats", "subject=thread:thr_2", "New chat");
  assert.equal(c.state().active, "chats:subject=thread:thr_2");
  c.retitle("chats:subject=thread:thr_2", "New chat", true);
  assert.deepEqual(keys(c.state()), ["chats", "chats:subject=thread:thr_1", "files"].filter((k) => keys(c.state()).includes(k)), "no second blank tab");
  assert.equal(c.state().tabs.filter((t) => t.empty === true).length, 1);
  assert.equal(c.state().active, "chats:subject=thread:thr_1", "the blank chat that was open is selected");
  // a chat that has its first message is not blank: it stays beside the blank one
  c.openPlace("chats", "subject=thread:thr_3", "New chat");
  c.retitle("chats:subject=thread:thr_3", "Can you draft the renewal", false);
  assert.ok(keys(c.state()).includes("chats:subject=thread:thr_3"));
  assert.equal(c.state().tabs.find((t) => t.key === "chats:subject=thread:thr_3")?.empty, undefined);
  // a blank chat that gets a message is no longer blank, and a later blank one may stay
  c.retitle("chats:subject=thread:thr_1", "Renewal", false);
  c.openPlace("chats", "subject=thread:thr_4", "New chat");
  c.retitle("chats:subject=thread:thr_4", "New chat", true);
  assert.ok(keys(c.state()).includes("chats:subject=thread:thr_4"));
});

test("saved blank chats close on load, keeping one: the one used last; chats with messages stay", () => {
  const blank = (id: string, at: number): TabEntry => ({ ...tab("chats", `subject=thread:${id}`, "New chat", at), empty: true });
  const s = state([tab("files"), blank("a", 5), blank("b", 9), tab("chats", "subject=thread:c", "Renewal", 1), blank("d", 2)], "chats:subject=thread:a");
  const out = dedupeTabs(s);
  assert.deepEqual(keys(out), ["files", "chats:subject=thread:b", "chats:subject=thread:c"]);
  assert.equal(out.active, "chats:subject=thread:b", "the selection moves to the blank chat that stays");
  const read = dedupeTabs(readTabs(writeTabs(s))!);
  assert.deepEqual(keys(read), keys(out), "the same after a save and a read");
});
