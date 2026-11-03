// A place opens once in the tab bar: a place is one tab, an item is one tab by its subject, going somewhere inside a place moves its tab, and a saved list with duplicates (rc.6) loads without them.
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TABS, createTabsController, moveTab, openTab, placeTab, readTabs, tabKey, tabsStorageKey, writeTabs } from "./store.ts";
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
  assert.deepEqual(got.tabs.map((t) => t.key), ["chats", "records", "vault", "new:1"], "a saved Home tab reopens as Chats");
  assert.equal(got.active, "chats");
  assert.equal(got.tabs.find((t) => t.key === "vault")?.pinned, true);
  assert.equal(readTabs(writeTabs(got))?.tabs.length, 4);
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
  const c = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "me", storage: s, start: "chats", hidden: ["apps"] });
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["chats"]);
  assert.equal(c.state().active, "chats");
  c.openPlace("apps");
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["chats"]);
  const only = mem();
  only.data.set("vyre.tabs.v1:mac:irfad:me", JSON.stringify({ v: 1, active: "apps", tabs: [{ key: "apps", title: "Apps", place: "apps" }] }));
  const d = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "me", storage: only, start: "chats", hidden: ["apps"] });
  assert.deepEqual(d.state().tabs.map((t) => t.key), ["chats"]);
  const team = createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "nw", storage: null, start: "chats" });
  team.openPlace("apps");
  assert.equal(team.state().active, "apps", "a team Space still has Apps");
});

test("a saved Join tab is dropped on load and Join never opens as a tab", () => {
  const storage = mem();
  const opts = { deviceId: "d", personId: "p", spaceId: "s", storage, start: "chats" as const, hidden: ["join" as const] };
  storage.data.set(tabsStorageKey("d", "p", "s"), writeTabs({ tabs: [placeTab("files"), placeTab("join"), placeTab("chats")], active: "join" }));
  const c = createTabsController(opts);
  assert.deepEqual(c.state().tabs.map((t) => t.place), ["files", "chats"]);
  assert.notEqual(c.state().active, "join");
  c.openPlace("join");
  assert.deepEqual(c.state().tabs.map((t) => t.place), ["files", "chats"]);
});

test("going somewhere inside the selected tab's place moves that tab: opening conversations in Inbox and chats in Chats never makes a second Inbox or Chats", () => {
  const c = createTabsController({ deviceId: "web", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.openPlace("inbox");
  for (const id of ["cnv_1", "cnv_2", "cnv_3"]) c.move("inbox", `subject=conversation:${id}`);
  c.move("inbox", "");
  c.move("inbox", "subject=conversation:cnv_4");
  c.select("chats");
  for (const id of ["thr_1", "thr_2"]) c.move("chats", `subject=thread:${id}`);
  c.move("chats", "screen=chats.threads");
  c.move("chats", "subject=thread:thr_3");
  const s = c.state();
  assert.deepEqual(s.tabs.map((t) => [t.key, t.title]), [["chats", "Chats"], ["inbox", "Inbox"]], "one Inbox, one Chats");
  assert.equal(s.tabs.find((t) => t.key === "inbox")?.hash, "subject=conversation:cnv_4", "the Inbox tab is where the person left it");
  assert.equal(s.active, "chats");
  // the rail: an open place focuses its tab and keeps where it was
  c.openPlace("inbox");
  assert.deepEqual([c.state().tabs.length, c.state().active, c.state().tabs.find((t) => t.key === "inbox")?.hash], [2, "inbox", "subject=conversation:cnv_4"]);
  // a link to what a place's tab shows now selects that tab, never a copy of it
  c.select("chats");
  c.openPlace("inbox", "subject=conversation:cnv_4");
  assert.deepEqual([c.state().tabs.length, c.state().active], [2, "inbox"]);
});

test("an item opened as a tab of its own stays one; inside it the tab follows the person, and where another tab holds the place, that tab is selected", () => {
  let s = openTab(EMPTY_TABS, placeTab("files"));
  s = openTab(s, placeTab("files", "subject=file:f1", "Plan"));
  assert.deepEqual(s.tabs.map((t) => t.key), ["files", "files:subject=file:f1"]);
  // inside the item's tab the person opens another file: the tab becomes that file's (its name arrives later)
  s = moveTab(s, "files", "subject=file:f2");
  assert.deepEqual(s.tabs.map((t) => [t.key, t.title]), [["files", "Files"], ["files:subject=file:f2", "Files"]]);
  // and goes back to the folder list: the Files tab already shows Files, so it is selected and no second Files tab is made
  s = moveTab(s, "files", "folderId=fld_1");
  assert.deepEqual([s.tabs.map((t) => t.key), s.active, s.tabs[0]?.hash], [["files", "files:subject=file:f2"], "files", "folderId=fld_1"]);
  // moving to another place, or from a "+" tab, is an ordinary open
  s = moveTab(s, "chats", "subject=thread:t1");
  assert.deepEqual(s.tabs.map((t) => t.key), ["files", "files:subject=file:f2", "chats:subject=thread:t1"]);
  const same = moveTab(s, "chats", "subject=thread:t1");
  assert.equal(same, s, "where it already is: nothing changes");
});

test("the controller's move keeps a pinned tab pinned and never opens a hidden place", () => {
  const c = createTabsController({ deviceId: "web", personId: "p", spaceId: "s", storage: null, start: "chats", hidden: ["apps"] });
  c.move("apps", "screen=apps.forms");
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["chats"]);
  const pinned = { tabs: [{ ...placeTab("inbox"), pinned: true }], active: "inbox" };
  const moved = moveTab(pinned, "inbox", "subject=conversation:c1");
  assert.deepEqual([moved.tabs.length, moved.tabs[0]?.pinned, moved.tabs[0]?.key], [1, true, "inbox"]);
});
