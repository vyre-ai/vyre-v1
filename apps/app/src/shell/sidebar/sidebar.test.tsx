// The shared place sidebar: the pure rules (collapse key and storage, phone view, search) and the slot's chrome.
// @reads ../../../../../scripts/shots/mounts/P-L9_22.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarBack, SidebarExpand, SidebarSlot, SidebarSlotProvider, collapseKey, matchRows, phoneView, readCollapsed, writeCollapsed } from "./index.ts";
import type { SidebarStorage } from "./index.ts";

const props = { deviceId: "d1", personId: "p1", spaceId: "northwind", place: "chats", epoch: 1 };

test("the collapse key names the device, the person, the Space and the place; the value round-trips and bad data reads as open", () => {
  assert.equal(collapseKey("d1", "p1", "northwind", "chats"), "vyre.sidebar.v1:d1:p1:northwind:chats");
  assert.notEqual(collapseKey("d1", "p1", "northwind", "chats"), collapseKey("d1", "p1", "harbor", "chats"));
  assert.notEqual(collapseKey("d1", "p1", "northwind", "chats"), collapseKey("d1", "p1", "northwind", "records"));
  assert.equal(readCollapsed(writeCollapsed(true)), true);
  assert.equal(readCollapsed(writeCollapsed(false)), false);
  for (const bad of [null, "", "nope", "[]", '{"collapsed":"yes"}']) assert.equal(readCollapsed(bad), false, String(bad));
});

test("the phone opens a place with a sidebar on its list; a place without one, or a computer, shows the body", () => {
  assert.equal(phoneView(true, true, false), "list");
  assert.equal(phoneView(true, true, true), "body");
  assert.equal(phoneView(false, true, false), "body");
  assert.equal(phoneView(true, false, false), "body");
});

test("search keeps rows holding every word of the query, in order; an empty query keeps all", () => {
  const rows = [{ title: "Rivera matter" }, { title: "Q4 billing", note: "Rivera invoices" }, { title: "Pruitt engagement" }];
  assert.deepEqual(matchRows(rows, "").length, 3);
  assert.deepEqual(matchRows(rows, "rivera").map((r) => r.title), ["Rivera matter", "Q4 billing"]);
  assert.deepEqual(matchRows(rows, "rivera inv").map((r) => r.title), ["Q4 billing"]);
  assert.deepEqual(matchRows(rows, "zzz"), []);
});

test("the slot draws the title, the collapse button and the search field, then an outlet; nothing without a registered place", () => {
  const html = renderToStaticMarkup(<SidebarSlotProvider {...props} compact={false} initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}><SidebarSlot /></SidebarSlotProvider>);
  for (const id of ["place-sidebar", "sidebar-collapse", "sidebar-search", "sidebar-search-input", "sidebar-outlet"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.ok(html.includes(">Chats<") && html.includes("Search chats"));
  assert.equal(renderToStaticMarkup(<SidebarSlotProvider {...props} compact={false}><SidebarSlot /></SidebarSlotProvider>), "");
});

test("a collapsed sidebar draws nothing and leaves the expand button; storage decides the first state", () => {
  const store: SidebarStorage = { getItem: (k) => (k === collapseKey("d1", "p1", "northwind", "chats") ? writeCollapsed(true) : null), setItem: () => undefined };
  const entry = { title: "Chats", searchPlaceholder: "Search chats" };
  const html = renderToStaticMarkup(<SidebarSlotProvider {...props} compact={false} storage={store} initialEntry={entry}><SidebarSlot /><SidebarExpand /></SidebarSlotProvider>);
  assert.ok(!html.includes('data-testid="place-sidebar"') && html.includes('data-testid="sidebar-expand"'));
  const open = renderToStaticMarkup(<SidebarSlotProvider {...props} place="records" compact={false} storage={store} initialEntry={entry}><SidebarSlot /><SidebarExpand /></SidebarSlotProvider>);
  assert.ok(open.includes('data-testid="place-sidebar"') && !open.includes("sidebar-expand"), "another place keeps its own choice");
});

test("on the phone the sidebar fills the screen on the list view and has no collapse button; Back shows only on the body", () => {
  const entry = { title: "Chats", searchPlaceholder: "Search chats" };
  const list = renderToStaticMarkup(<SidebarSlotProvider {...props} compact initialEntry={entry}><SidebarSlot /><SidebarBack /><SidebarExpand /></SidebarSlotProvider>);
  assert.ok(list.includes('data-testid="place-sidebar"') && !list.includes("sidebar-collapse") && !list.includes("sidebar-back") && !list.includes("sidebar-expand"));
});
