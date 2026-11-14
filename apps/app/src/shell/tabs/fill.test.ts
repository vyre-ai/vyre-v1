// A "+" tab that starts a chat becomes that chat: the same tab, no second one beside it (owner, 13 Nov 2026: Enter in a new tab starts a chat).
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TABS, fillTab, moveTab, newTabEntry, openTab, placeTab, NEW_CHAT } from "./store.ts";

const withNewTab = () => {
  let s = openTab(EMPTY_TABS, placeTab("chats"));
  const tab = newTabEntry("chats", s);
  s = openTab(s, tab);
  return { s, tab };
};

test("the new tab on screen becomes the chat: one tab for it, named, selected, and no tab is left called New tab", () => {
  const { s, tab } = withNewTab();
  assert.equal(s.tabs.length, 2);
  const next = fillTab(s, "chats", "subject=thread:t1", "Heyy");
  assert.equal(next.tabs.length, 2, "no tab was added");
  assert.ok(!next.tabs.some((t) => t.key === tab.key || t.isNew === true));
  const chat = next.tabs.find((t) => t.hash === "subject=thread:t1");
  assert.equal(chat?.title, "Heyy");
  assert.equal(next.active, chat?.key);
  assert.deepEqual(next.tabs.map((t) => t.key).slice(0, 1), ["chats"], "the tabs before it keep their place");
});

test("a pinned new tab stays pinned; a chat already open in another tab is selected and the new tab goes", () => {
  let { s, tab } = withNewTab();
  s = { ...s, tabs: s.tabs.map((t) => (t.key === tab.key ? { ...t, pinned: true } : t)) };
  assert.equal(
    fillTab(s, "chats", "subject=thread:t1", "Heyy").tabs.find((t) => t.hash === "subject=thread:t1")?.pinned,
    true,
  );
  let { s: s2, tab: tab2 } = withNewTab();
  s2 = openTab(s2, placeTab("chats", "subject=thread:t9", "Nine"));
  s2 = openTab(s2, tab2);
  const next = fillTab(s2, "chats", "subject=thread:t9");
  assert.ok(!next.tabs.some((t) => t.key === tab2.key));
  assert.equal(next.tabs.filter((t) => t.hash === "subject=thread:t9").length, 1);
  assert.equal(next.active, next.tabs.find((t) => t.hash === "subject=thread:t9")?.key);
});

test("when the selected tab is not a new tab, it is an ordinary open", () => {
  const s = openTab(EMPTY_TABS, placeTab("chats"));
  const next = fillTab(s, "chats", "subject=thread:t1", "Heyy");
  assert.equal(next.tabs.length, 2);
});

test("the page reporting where the tab is (moveTab, on the same chat the tab was just filled with) keeps the tab's name; it never falls back to New chat", () => {
  const { s } = withNewTab();
  const filled = fillTab(s, "chats", "subject=thread:t1", "Heyy");
  const moved = moveTab(filled, "chats", "subject=thread:t1", NEW_CHAT);
  assert.equal(moved.tabs.length, filled.tabs.length);
  const sel = moved.tabs.find((t) => t.key === moved.active)!;
  assert.equal(sel.title, "Heyy");
  assert.notEqual(sel.empty, true);
});

test("a place's own tab whose address moved (key equals the place): going back to the landing clears the address", () => {
  let s = openTab(EMPTY_TABS, placeTab("records"));
  s = moveTab(s, "records", "type=person");
  assert.equal(s.tabs.find((t) => t.key === s.active)?.hash, "type=person");
  s = moveTab(s, "records", "");
  assert.equal(s.tabs.find((t) => t.key === s.active)?.hash, undefined);
});

test("the chat fills the tab the press came from, by its key, even when another tab is selected by the time it is ready", () => {
  let { s, tab } = withNewTab();
  const other = newTabEntry("chats", s);
  s = openTab(s, other); // the person pressed Enter in `tab`, then clicked a second "+" tab
  assert.equal(s.active, other.key);
  const next = fillTab(s, "chats", "subject=thread:t1", "Heyy", tab.key);
  const chat = next.tabs.find((t) => t.hash === "subject=thread:t1");
  assert.ok(chat, "the chat is a tab");
  assert.equal(next.tabs.length, s.tabs.length, "no tab was added");
  assert.ok(
    next.tabs.some((t) => t.key === other.key && t.isNew === true),
    "the other new tab is untouched",
  );
  assert.ok(!next.tabs.some((t) => t.key === tab.key), "the tab that pressed Enter is the chat");
  assert.equal(next.active, other.key, "the person stays where they went");
});

test("when the tab the press came from was closed, the chat opens as a tab of its own and nothing else changes", () => {
  const { s, tab } = withNewTab();
  const closed = { ...s, tabs: s.tabs.filter((t) => t.key !== tab.key) };
  const next = fillTab(closed, "chats", "subject=thread:t1", "Heyy", tab.key);
  assert.ok(next.tabs.some((t) => t.hash === "subject=thread:t1"));
});
