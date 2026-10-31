// A place opens once in the tab bar: a place is one tab, an item is one tab by its subject, and a saved list with duplicates (rc.6) loads without them.
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TABS, createTabsController, openTab, placeTab, readTabs, tabKey, tabsStorageKey, writeTabs } from "./store.ts";
import type { TabsStorage } from "./store.ts";

const mem = (): TabsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

test("a place is one tab whatever screen it shows", () => {
  assert.equal(tabKey("vault", "screen=list"), "vault");
  assert.equal(tabKey("vault", "screen=item&k=v"), "vault");
  assert.equal(tabKey("chats", "screen=home"), tabKey("chats"));
  let s = openTab(EMPTY_TABS, placeTab("vault"));
  s = openTab(s, placeTab("vault", "screen=list"));
  assert.equal(s.tabs.length, 1);
  assert.equal(s.active, "vault");
  assert.equal(s.tabs[0]?.hash, "screen=list", "the tab follows the screen it moved to");
});

test("an item is one tab by its subject, a Records type by its type", () => {
  assert.equal(tabKey("chats", "subject=thread:t1"), tabKey("chats", "screen=thread&subject=thread:t1"));
  assert.notEqual(tabKey("chats", "subject=thread:t1"), tabKey("chats", "subject=thread:t2"));
  assert.equal(tabKey("records", "type=company"), tabKey("records", "screen=list&type=company"));
  assert.notEqual(tabKey("records", "type=company"), tabKey("records", "type=person"));
  assert.equal(tabKey("records", "subject=record:r1&type=company"), tabKey("records", "type=company&subject=record:r1"));
  let s = openTab(EMPTY_TABS, placeTab("chats", "subject=thread:t1"));
  s = openTab(s, placeTab("records"));
  s = openTab(s, placeTab("chats", "screen=thread&subject=thread:t1"));
  assert.equal(s.tabs.length, 2);
  assert.equal(s.active, tabKey("chats", "subject=thread:t1"));
});

test("a saved list with duplicates loads once per place and item, and keeps the selection", () => {
  const row = (key: string, place: string, hash?: string, extra = {}) => ({ key, title: place, place, ...(hash ? { hash } : {}), ...extra });
  const raw = JSON.stringify({ v: 1, active: "chats:screen=a", tabs: [
    row("home", "home"), row("records", "records"), row("records:screen=list", "records", "screen=list"),
    row("vault", "vault"), row("vault:screen=x", "vault", "screen=x", { pinned: true }),
    row("chats", "chats"), row("chats:screen=a", "chats", "screen=a"), row("new:1", "chats", undefined, { isNew: true }),
  ] });
  const got = readTabs(raw);
  assert.ok(got);
  assert.deepEqual(got.tabs.map((t) => t.key), ["home", "records", "vault", "chats", "new:1"]);
  assert.equal(got.active, "chats");
  assert.equal(got.tabs.find((t) => t.key === "vault")?.pinned, true);
  assert.equal(readTabs(writeTabs(got))?.tabs.length, 5);
});

test("the controller opens a saved list deduplicated and an open place focuses its tab", () => {
  const s = mem();
  const key = "vyre.tabs.v1:mac:irfad:me";
  s.data.set(key, JSON.stringify({ v: 1, active: "vault", tabs: [
    { key: "vault", title: "Vault", place: "vault" }, { key: "vault:screen=y", title: "Vault", place: "vault", hash: "screen=y" }, { key: "chats", title: "Chats", place: "chats" },
  ] }));
  const c = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "me", storage: s, start: "home" });
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["vault", "chats"]);
  c.openPlace("chats");
  c.openPlace("vault", "screen=z");
  assert.equal(c.state().tabs.length, 2);
  assert.equal(c.state().active, "vault");
});

test("a Personal Space never has an Apps tab, new or saved", () => {
  const s = mem();
  s.data.set("vyre.tabs.v1:mac:irfad:me", JSON.stringify({ v: 1, active: "apps", tabs: [
    { key: "home", title: "Home", place: "home" }, { key: "apps", title: "Apps", place: "apps" },
  ] }));
  const c = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "me", storage: s, start: "home", hidden: ["apps"] });
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["home"]);
  assert.equal(c.state().active, "home");
  c.openPlace("apps");
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["home"]);
  const only = mem();
  only.data.set("vyre.tabs.v1:mac:irfad:me", JSON.stringify({ v: 1, active: "apps", tabs: [{ key: "apps", title: "Apps", place: "apps" }] }));
  const d = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "me", storage: only, start: "home", hidden: ["apps"] });
  assert.deepEqual(d.state().tabs.map((t) => t.key), ["home"]);
  const team = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "nw", storage: null, start: "home" });
  team.openPlace("apps");
  assert.equal(team.state().active, "apps", "a team Space still has Apps");
});

test("a saved Join tab is dropped on load and Join never opens as a tab", () => {
  const storage = mem();
  const opts = { deviceId: "d", personId: "p", spaceId: "s", storage, start: "home" as const, hidden: ["join" as const] };
  storage.data.set(tabsStorageKey("d", "p", "s"), writeTabs({ tabs: [placeTab("home"), placeTab("join"), placeTab("chats")], active: "join" }));
  const c = createTabsController(opts);
  assert.deepEqual(c.state().tabs.map((t) => t.place), ["home", "chats"]);
  assert.notEqual(c.state().active, "join");
  c.openPlace("join");
  assert.deepEqual(c.state().tabs.map((t) => t.place), ["home", "chats"]);
});
