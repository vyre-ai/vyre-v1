// Main tabs (spec 3.0, 4.7): per device and per Space, restored on return, not synced. The pure state, the controller over a device's storage, and the strip.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MainTabs, tabSpecs } from "./MainTabs.tsx";
import {
  EMPTY_TABS, TABS_SYNCED, afterClosing, closeTab, createTabsController, newTabEntry, openTab, placeTab, readTabs, reorderTabs, selectTab, tabKey, tabsStorageKey, writeTabs,
} from "./store.ts";
import type { TabsStorage } from "./store.ts";

function storage(): TabsStorage & { keys(): string[] } {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, keys: () => [...data.keys()] };
}

const controller = (s: TabsStorage | null, device = "mac", space = "nw", start: "chats" | "home" = "chats") => createTabsController({ deviceId: device, personId: "irfad", spaceId: space, storage: s, start });

test("opening a tab selects it, opening it again selects the same one, background keeps the current tab", () => {
  let s = openTab(EMPTY_TABS, placeTab("chats"));
  s = openTab(s, placeTab("files"));
  assert.deepEqual(s.tabs.map((t) => t.key), ["chats", "files"]);
  assert.equal(s.active, "files");
  s = openTab(s, placeTab("chats"));
  assert.equal(s.tabs.length, 2, "no duplicate");
  assert.equal(s.active, "chats");
  s = openTab(s, placeTab("records", "pruitt", "Pruitt matter"), true);
  assert.equal(s.active, "chats", "a background tab does not take the selection");
  assert.equal(s.tabs[2]?.title, "Pruitt matter");
  assert.equal(tabKey("records", "pruitt"), "records:pruitt");
  assert.equal(tabKey("home"), "home");
});

test("closing the selected tab selects its right neighbour, else the left; a pinned tab stays", () => {
  let s = openTab(openTab(openTab(EMPTY_TABS, placeTab("home")), placeTab("chats")), placeTab("files"));
  s = selectTab(s, "chats");
  s = closeTab(s, "chats");
  assert.equal(s.active, "files");
  assert.equal(afterClosing(s.tabs, "files", "files"), "home", "the last tab falls back to the left");
  const pinned = { tabs: [{ ...placeTab("home"), pinned: true }, placeTab("chats")], active: "chats" };
  assert.equal(closeTab(pinned, "home"), pinned, "a pinned tab does not close");
  assert.equal(closeTab(s, "nope"), s);
});

test("reorder puts tabs in the given order and keeps strays at the end", () => {
  const s = openTab(openTab(openTab(EMPTY_TABS, placeTab("home")), placeTab("chats")), placeTab("files"));
  assert.deepEqual(reorderTabs(s, ["files", "home"]).tabs.map((t) => t.key), ["files", "home", "chats"]);
  assert.equal(reorderTabs(s, ["files", "home"]).active, "files");
});

test("write and read are one pair; anything malformed reads as nothing", () => {
  const s = openTab(openTab(EMPTY_TABS, placeTab("chats")), placeTab("records", "pruitt", "Pruitt matter"));
  assert.deepEqual(readTabs(writeTabs(s)), s);
  for (const bad of [null, "", "{", "[]", '{"v":2,"active":"","tabs":[]}', '{"v":1,"active":"x","tabs":[{"key":"a","title":"A","place":"nowhere"}]}']) assert.equal(readTabs(bad), null, String(bad));
  const stale = readTabs('{"v":1,"active":"gone","tabs":[{"key":"chats","title":"Chats","place":"chats"}]}');
  assert.equal(stale?.active, "chats", "a selected key that no longer exists falls to the first tab");
});

test("tabs restore per device and per Space and never leave the device", () => {
  assert.equal(TABS_SYNCED, false);
  const disk = storage();
  const a = controller(disk);
  a.openPlace("files");
  a.openPlace("records", "pruitt", "Pruitt matter");
  const saved = a.state();

  assert.deepEqual(controller(disk).state(), saved, "the same device and Space restores the tabs");
  assert.deepEqual(controller(disk, "phone").state().tabs.map((t) => t.key), ["chats"], "another device starts from the Space's start place");
  assert.deepEqual(controller(disk, "mac", "hb", "home").state().tabs.map((t) => t.key), ["home"], "another Space has its own tabs");
  assert.deepEqual(controller(disk, "mac", "me", "home").state().tabs.map((t) => t.key), ["home"]);

  for (const k of disk.keys()) assert.ok(k.startsWith("vyre.tabs.v1:mac:irfad:"), k);
  assert.equal(tabsStorageKey("mac", "irfad", "nw"), "vyre.tabs.v1:mac:irfad:nw");
  assert.deepEqual(disk.keys(), ["vyre.tabs.v1:mac:irfad:nw"], "only the tabs that changed were written, under the device key");
});

test("a storage that throws never breaks the tabs", () => {
  const broken: TabsStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  const c = controller(broken);
  c.openPlace("files");
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["chats", "files"]);
  assert.deepEqual(controller(null).state().tabs.map((t) => t.key), ["chats"]);
});

test("closing the last tab leaves the Space's start place open and a listener hears each change once", () => {
  const c = controller(null);
  let heard = 0;
  const off = c.subscribe(() => { heard += 1; });
  c.close("chats");
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["chats"], "never an empty stage");
  assert.equal(heard, 1);
  c.openPlace("files");
  c.select("chats");
  c.select("chats");
  assert.equal(heard, 3, "the close, the open and the first select; a repeated select is not a change");
  off();
  c.openPlace("inbox");
  assert.equal(heard, 3, "an unsubscribed listener hears nothing");
});

test("a new tab is a '+' tab with its own key, and a rename keeps the key", () => {
  const c = controller(null);
  const t = c.newTab("chats");
  assert.equal(t.isNew, true);
  assert.ok(t.key.startsWith("new:"));
  assert.equal(c.state().active, t.key);
  const u = newTabEntry("chats", c.state());
  assert.notEqual(u.key, t.key);
  c.openPlace("chats", "thread-1", "Thread");
  c.retitle("chats:thread-1", "Rivera intake");
  assert.equal(c.state().tabs.find((x) => x.key === "chats:thread-1")?.title, "Rivera intake");
});

test("the strip draws the Space's tabs with the selected one marked, a plus and the options button", () => {
  const c = controller(null);
  c.openPlace("files");
  c.openPlace("records", "pruitt", "Pruitt matter");
  const out = renderToStaticMarkup(<MainTabs controller={c} />).replaceAll("<!-- -->", "");
  for (const title of ["Chats", "Files", "Pruitt matter"]) assert.ok(out.includes(title), title);
  assert.ok(out.includes('data-testid="tab-records:pruitt-selected"'), "the selected tab is marked");
  assert.ok(out.includes('data-testid="tab-chats"') && out.includes('data-testid="tab-files"'));
  assert.ok(out.includes('data-testid="tab-strip-plus"') && out.includes('data-testid="tab-strip-more"'));
  assert.deepEqual(tabSpecs([{ ...placeTab("home"), pinned: true }, placeTab("chats")]), [{ key: "home", title: "Home", pinned: true }, { key: "chats", title: "Chats" }]);
});
