// ui/TabStrip: one strip for main tabs and side panes. Select, close, reorder, menu and keyboard behaviour. Roving tab order, reorder and the tab menu are covered here.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TAB_STRIP_HEIGHT, TabStrip, afterClose, closableKeys, reorderKeys, stepKey, tabMenuEntries } from "./index.tsx";
import type { TabSpec } from "./index.tsx";
import { isItem, isSeparator } from "../Menu/props.ts";

const TABS: readonly TabSpec[] = [
  { key: "home", title: "Home", pinned: true },
  { key: "a", title: "Weekly sync", icon: "star" },
  { key: "b", title: "Launch checklist" },
  { key: "c", title: "Inbox review" },
];

test("each tab renders with its title, the active one is selected, pinned tabs have no close button", () => {
  const html = renderToStaticMarkup(<TabStrip tabs={TABS} active="b" />);
  assert.match(html, /role="tablist"/);
  assert.equal(html.match(/role="tab"/g)?.length, 4);
  for (const tab of TABS) assert.ok(html.includes(tab.title), `title ${tab.title}`);
  assert.match(html, /data-testid="tab-b-selected"/);
  assert.equal(html.match(/aria-selected="true"/g)?.length, 1, "exactly one tab is selected");
  assert.doesNotMatch(html, /tab-close-home/, "pinned tab has no close");
  assert.match(html, /tab-close-a/);
  assert.match(html, /tab-close-c/);
});

test("the active tab is the only one in the tab order (roving tabindex)", () => {
  const html = renderToStaticMarkup(<TabStrip tabs={TABS} active="a" />);
  const tag = (id: string): string => new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  assert.match(tag("tab-a-selected"), /tabindex="0"/);
  assert.match(tag("tab-c"), /tabindex="-1"/);
});

test("the plus button shows only when the caller can open something, with its title", () => {
  assert.doesNotMatch(renderToStaticMarkup(<TabStrip tabs={TABS} active="a" />), /tab-strip-plus/);
  const html = renderToStaticMarkup(<TabStrip tabs={TABS} active="a" onPlus={() => undefined} plusTitle="New tab" />);
  assert.match(html, /data-testid="tab-strip-plus"/);
  assert.match(html, /aria-label="New tab"/);
  assert.match(html, /aria-label="Tab options"/, "the options button is always there");
});

test("the strip is 38 high and paints the side token with a hairline under it", () => {
  assert.equal(TAB_STRIP_HEIGHT, 38);
  const html = renderToStaticMarkup(<TabStrip tabs={TABS} active="a" />);
  assert.match(html, /data-testid="tab-strip"/);
});

test("reorder moves one tab and never a pinned one", () => {
  assert.deepEqual(reorderKeys(TABS, "a", "c"), ["home", "b", "c", "a"]);
  assert.deepEqual(reorderKeys(TABS, "c", "a"), ["home", "c", "a", "b"]);
  assert.deepEqual(reorderKeys(TABS, "home", "c"), ["home", "a", "b", "c"], "a pinned tab does not move");
  assert.deepEqual(reorderKeys(TABS, "a", "home"), ["home", "a", "b", "c"], "nothing moves in front of a pinned tab");
  assert.deepEqual(reorderKeys(TABS, "a", "a"), ["home", "a", "b", "c"]);
  assert.deepEqual(reorderKeys(TABS, "a", "zzz"), ["home", "a", "b", "c"]);
});

test("arrows step between tabs and stop at the ends", () => {
  assert.equal(stepKey(TABS, "a", "right"), "b");
  assert.equal(stepKey(TABS, "a", "left"), "home");
  assert.equal(stepKey(TABS, "home", "left"), undefined);
  assert.equal(stepKey(TABS, "c", "right"), undefined);
  assert.equal(stepKey(TABS, "b", "first"), "home");
  assert.equal(stepKey(TABS, "b", "last"), "c");
  assert.equal(stepKey([], "b", "first"), undefined);
});

test("closing the active tab activates the right neighbour, else the left one", () => {
  assert.equal(afterClose(TABS, "b", "b"), "c");
  assert.equal(afterClose(TABS, "c", "c"), "b");
  assert.equal(afterClose(TABS, "a", "b"), "b", "closing another tab keeps the active one");
});

test("close others and close all keep pinned tabs", () => {
  assert.deepEqual(closableKeys(TABS, "closeOthers", "b"), ["a", "c"]);
  assert.deepEqual(closableKeys(TABS, "closeAll", "b"), ["a", "b", "c"]);
  assert.deepEqual(closableKeys(TABS, "close", "b"), ["b"]);
  assert.deepEqual(closableKeys(TABS, "close", "home"), [], "a pinned tab is never closed");
});

test("the tab menu: extras first, then the close commands, icons all or none", () => {
  const ran: string[] = [];
  const entries = tabMenuEntries(TABS, "a", [{ label: "Pin Tab", icon: "star" }], (op, key) => ran.push(`${op}:${key}`));
  const labels = entries.filter(isItem).map((e) => e.label);
  assert.deepEqual(labels, ["Pin Tab", "Close Tab", "Close Other Tabs", "Close All Tabs"]);
  assert.ok(entries.some(isSeparator), "a separator splits extras from the close commands");
  assert.ok(entries.filter(isItem).every((e) => typeof e.icon === "string" && e.icon.length > 0), "all have icons");
  for (const entry of entries) if (isItem(entry) && entry.label !== "Pin Tab") entry.onSelect?.();
  assert.deepEqual(ran, ["close:a", "closeOthers:a", "closeAll:a"]);

  const mixed = tabMenuEntries(TABS, "a", [{ label: "Pin Tab" }], () => undefined);
  assert.ok(mixed.filter(isItem).every((e) => e.icon === undefined), "one extra without an icon drops every icon");

  const pinned = tabMenuEntries(TABS, "home", [], () => undefined).filter(isItem).map((e) => e.label);
  assert.deepEqual(pinned, ["Close Other Tabs", "Close All Tabs"], "no Close Tab for a pinned tab");
  const strip = tabMenuEntries(TABS, undefined, [], () => undefined).filter(isItem).map((e) => e.label);
  assert.deepEqual(strip, ["Close Other Tabs", "Close All Tabs"]);
});

test("an extra's own handler is kept", () => {
  let hit = 0;
  const entries = tabMenuEntries(TABS, "a", [{ label: "Pin Tab", icon: "star", onSelect: () => { hit += 1; } }], () => undefined);
  const first = entries[0];
  assert.ok(first !== undefined && isItem(first));
  first.onSelect?.();
  assert.equal(hit, 1);
});
