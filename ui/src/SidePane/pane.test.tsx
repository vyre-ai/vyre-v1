// ui/Pane and ui/SidePane: one toggle at the far left of every pane header; the side pane's width is remembered.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_PANE_WIDTH,
  PANE_HEADER_ORDER,
  Pane,
  SIDE_PANE_MAX,
  SIDE_PANE_MIN,
  SidePane,
  clampPaneWidth,
  createPaneWidthStore,
  paneToggleLabel,
  widthForKey,
} from "./index.tsx";
import type { WidthStorage } from "./index.tsx";

const TABS = [{ key: "details", title: "Details" }, { key: "history", title: "History" }];

function memoryStorage(): WidthStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function toggleCount(html: string): number {
  return html.match(/data-pane-toggle="far-left"/g)?.length ?? 0;
}

test("the header order is the toggle first, then the tabs", () => {
  assert.deepEqual([...PANE_HEADER_ORDER], ["toggle", "tabs"]);
});

test("a pane header has exactly one toggle and it comes before the tabs", () => {
  const html = renderToStaticMarkup(<Pane toggle={{ open: false }} title="Chat" tabs={TABS} activeTab="details" />);
  assert.equal(toggleCount(html), 1, "exactly one toggle");
  assert.match(html, /data-toggle-count="1"/);
  assert.ok(html.indexOf('data-pane-toggle="far-left"') < html.indexOf("Details"), "toggle sits left of the first tab");
  assert.ok(html.indexOf('data-pane-header="true"') < html.indexOf('data-pane-toggle="far-left"'));
  assert.match(html, /aria-label="Show the pane"/);
  assert.match(html, /data-inner-toggle="shown"/);
});

test("an inner pane's toggle hides while the side pane is open, and it is still the only one", () => {
  const html = renderToStaticMarkup(<Pane toggle={{ open: true }} title="Chat" />);
  assert.match(html, /data-inner-toggle="hidden"/);
  assert.match(html, /display:none/, "the hidden toggle takes no space");
  assert.equal(toggleCount(html), 1);
});

test("a side pane header has one visible toggle at the far left that says Hide the pane", () => {
  const html = renderToStaticMarkup(<SidePane paneKey="chats" toggle={{ open: true }} title="Ask" tabs={TABS} activeTab="history" />);
  assert.equal(toggleCount(html), 1);
  assert.match(html, /aria-label="Hide the pane"/);
  assert.match(html, /data-inner-toggle="shown"/);
  assert.doesNotMatch(html, /display:none/);
  assert.ok(html.indexOf('data-pane-toggle="far-left"') < html.indexOf("History"));
  assert.match(html, /data-testid="tab-history-selected"/, "the tabs are the shared strip");
});

test("a closed side pane renders nothing, so the main pane's toggle is the only one on screen", () => {
  assert.equal(renderToStaticMarkup(<SidePane paneKey="chats" toggle={{ open: false }} />), "");
  const both = renderToStaticMarkup(<div><Pane toggle={{ open: false }} title="Main" /><SidePane paneKey="chats" toggle={{ open: false }} /></div>);
  assert.equal(toggleCount(both), 1);
});

test("with the side pane open there is still one toggle on screen: the side pane's", () => {
  const both = renderToStaticMarkup(<div><Pane toggle={{ open: true }} title="Main" /><SidePane paneKey="chats" toggle={{ open: true }} /></div>);
  assert.equal(toggleCount(both), 2, "two headers, each with one toggle in the DOM");
  assert.equal(both.match(/display:none/g)?.length, 1, "exactly one of them is hidden");
});

test("the resize edge is a labelled separator with the width as its value", () => {
  const html = renderToStaticMarkup(<SidePane paneKey="chats" toggle={{ open: true }} />);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-label="Resize the side pane"/);
  assert.match(html, new RegExp(`aria-valuenow="${DEFAULT_PANE_WIDTH}"`));
  assert.match(html, /aria-valuemin="280"/);
  assert.match(html, /data-pane-key="chats"/);
});

test("labels flip with the state", () => {
  assert.equal(paneToggleLabel(true), "Hide the pane");
  assert.equal(paneToggleLabel(false), "Show the pane");
});

test("the width is clamped between the floor and 70 percent of the window", () => {
  assert.equal(SIDE_PANE_MIN, 280);
  assert.equal(SIDE_PANE_MAX, 0.7);
  assert.equal(clampPaneWidth(100, 1280), 280);
  assert.equal(clampPaneWidth(340, 1280), 340);
  assert.equal(clampPaneWidth(2000, 1280), 896);
  assert.equal(clampPaneWidth(340, 390), 280, "narrow window: the floor wins");
  assert.equal(clampPaneWidth(500.4, 1280), 500);
  assert.equal(clampPaneWidth(900, 0), 900, "window not measured yet: only the floor applies");
  assert.equal(clampPaneWidth(500, 1280, 300, 0.3), 384, "a custom floor and cap");
});

test("the width is remembered per pane key, and a reset forgets it", () => {
  const storage = memoryStorage();
  const store = createPaneWidthStore(storage);
  assert.equal(store.get("chats"), null);
  store.set("chats", 412);
  store.set("files", 300);
  assert.equal(store.get("chats"), 412);
  assert.equal(store.get("files"), 300);
  assert.equal(storage.data.get("vyre-ui:chats:w"), "412px", "stored as the prototype stores it");
  const reopened = createPaneWidthStore(storage);
  assert.equal(reopened.get("chats"), 412, "a new store (a new session) reads it back");
  assert.equal(reopened.get("files"), 300);
  reopened.reset("chats");
  assert.equal(reopened.get("chats"), null);
  assert.equal(createPaneWidthStore(storage).get("chats"), null);
  assert.equal(createPaneWidthStore(storage).get("files"), 300, "other panes keep theirs");
});

test("storage that throws or has junk falls back without breaking", () => {
  const broken: WidthStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  const store = createPaneWidthStore(broken);
  assert.equal(store.get("chats"), null);
  store.set("chats", 360);
  assert.equal(store.get("chats"), 360, "memory keeps it for the session");
  store.reset("chats");
  assert.equal(store.get("chats"), null);
  const junk = memoryStorage();
  junk.data.set("vyre-ui:chats:w", "wide");
  assert.equal(createPaneWidthStore(junk).get("chats"), null);
  assert.equal(createPaneWidthStore(null).get("chats"), null);
});

test("keys move the edge: left grows, right shrinks, Home resets, clamped", () => {
  assert.equal(widthForKey(340, "ArrowLeft", 1280), 364);
  assert.equal(widthForKey(340, "ArrowRight", 1280), 316);
  assert.equal(widthForKey(290, "ArrowRight", 1280), 280, "stops at the floor");
  assert.equal(widthForKey(890, "ArrowLeft", 1280), 896, "stops at the cap");
  assert.equal(widthForKey(340, "Home", 1280), "reset");
  assert.equal(widthForKey(340, "a", 1280), null);
});
