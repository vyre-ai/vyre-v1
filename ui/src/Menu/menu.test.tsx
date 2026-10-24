// ui/Menu: Report a problem is always the last item, added here and never by a module; icons are all or none.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Menu,
  REPORT_A_PROBLEM,
  clampMenu,
  iconNames,
  iconsAllOrNone,
  kitMenuEntries,
  menuEntries,
  menuTrigger,
  moveActive,
  reportProblem,
  selectableIndices,
  setReportProblemHandler,
  typeAhead,
} from "./index.tsx";
import type { KitMenuItem, MenuEntry } from "./index.tsx";
import { isItem, isReportItem, isSeparator } from "./props.ts";
import { tabMenuEntries } from "../TabStrip/index.tsx";

// KitScreenDef.menus entries, shaped as the generated screens carry them.
const KIT_MENUS: readonly { target: string; items: readonly KitMenuItem[] }[] = [
  { target: "row", items: [{ label: "Open", icon: "open", action: "open" }, { label: "Copy Link", icon: "link", action: "copy_link" }, { label: "Delete", icon: "trash", action: "delete" }] },
  { target: "header", items: [{ label: "Star", icon: "star", action: "star" }] },
  { target: "empty", items: [] },
  { target: "bare", items: [{ label: "Rename", icon: "", action: "rename" }, { label: "Move", icon: "", action: "move" }] },
];

function labels(entries: readonly MenuEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) if (isItem(entry)) out.push(entry.label);
  return out;
}

function assertEndsWithReport(entries: readonly MenuEntry[], where: string): void {
  const last = entries[entries.length - 1];
  assert.ok(last !== undefined && isReportItem(last), `${where}: last entry is Report a problem`);
  assert.equal(labels(entries).filter((l) => l === REPORT_A_PROBLEM).length, 1, `${where}: exactly one Report a problem`);
  if (entries.length > 1) {
    const before = entries[entries.length - 2];
    assert.ok(before !== undefined && isSeparator(before), `${where}: a separator sits in front of it`);
  }
}

test("every KitScreenDef.menus entry ends with Report a problem, added by the menu", () => {
  for (const group of KIT_MENUS) {
    const given = kitMenuEntries(group.items, () => undefined);
    assert.ok(!labels(given).includes(REPORT_A_PROBLEM), `${group.target}: the module did not add it`);
    assertEndsWithReport(menuEntries({ items: given }), group.target);
  }
});

test("the shared defaults (tab menu) end with Report a problem and no module added it", () => {
  const tabs = [{ key: "a", title: "A" }, { key: "b", title: "B", pinned: true }];
  for (const key of ["a", "b"]) {
    const shared = tabMenuEntries(tabs, key, [{ label: "Pin Tab", icon: "star" }], () => undefined);
    assert.ok(!labels(shared).includes(REPORT_A_PROBLEM));
    assertEndsWithReport(menuEntries({ items: shared }), `tab menu ${key}`);
  }
});

test("a module that adds Report a problem by hand does not get it twice and it still comes last", () => {
  const entries = menuEntries({ items: [{ label: REPORT_A_PROBLEM }, { label: "Open" }, { label: "Copy" }] });
  assertEndsWithReport(entries, "hand added");
  assert.deepEqual(labels(entries), ["Open", "Copy", REPORT_A_PROBLEM]);
});

test("help and shortcut menus get the item; other leaves the items alone", () => {
  const items: MenuEntry[] = [{ label: "Keyboard" }, { label: "Docs" }];
  assertEndsWithReport(menuEntries({ items, source: "help" }), "help");
  assertEndsWithReport(menuEntries({ items, source: "shortcut" }), "shortcut");
  assert.deepEqual(labels(menuEntries({ items, source: "other" })), ["Keyboard", "Docs"]);
});

test("icons are all or none, and the appended item follows", () => {
  const iconned = menuEntries({ items: [{ label: "Open", icon: "open" }, { label: "Copy", icon: "copy" }] });
  assert.ok(iconsAllOrNone(iconned));
  const last = iconned[iconned.length - 1];
  assert.ok(last !== undefined && isItem(last) && last.icon === "flag", "iconned menu: Report a problem carries an icon");
  const bare = menuEntries({ items: [{ label: "Open" }, { label: "Copy" }] });
  assert.ok(iconsAllOrNone(bare));
  const bareLast = bare[bare.length - 1];
  assert.ok(bareLast !== undefined && isItem(bareLast) && bareLast.icon === undefined, "bare menu: Report a problem has none");
  assert.equal(iconsAllOrNone([{ label: "Open", icon: "open" }, { label: "Copy" }]), false, "a mixed menu is detected");
  assert.ok(iconNames().includes("flag"));
});

test("choosing Report a problem calls the shell's handler with what was right-clicked", () => {
  const seen: string[] = [];
  const off = setReportProblemHandler((context) => seen.push(context.label ?? ""));
  try {
    const entries = menuEntries({ items: [{ label: "Open" }] }, { label: "Weekly sync" });
    const last = entries[entries.length - 1];
    assert.ok(last !== undefined && isItem(last) && last.onSelect !== undefined);
    last.onSelect();
    reportProblem({ label: "Shortcut" });
  } finally {
    off();
  }
  assert.deepEqual(seen, ["Weekly sync", "Shortcut"]);
  reportProblem({ label: "after removal" });
  assert.equal(seen.length, 2, "a removed handler is not called");
});

test("a rendered menu lists the items in order and Report a problem last, with a separator before it", () => {
  const html = renderToStaticMarkup(<Menu items={[{ head: "File" }, { label: "Open", icon: "open" }, { label: "Delete", icon: "trash", danger: true }, { label: "Pinned", icon: "star", checked: true }]} x={40} y={40} />);
  assert.match(html, /role="menu"/);
  assert.equal(html.match(/role="menuitem"/g)?.length, 4, "three items plus Report a problem");
  const order = ["File", "Open", "Delete", "Pinned", REPORT_A_PROBLEM].map((l) => html.indexOf(l));
  assert.ok(order.every((n) => n >= 0), "every label is rendered");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "labels render in order");
  assert.match(html, /data-separator="true"/);
  assert.equal(html.match(/data-report="true"/g)?.length, 1);
  assert.ok(html.indexOf('data-report="true"') > html.indexOf("Pinned"));
  assert.match(html, /var\(--danger\)/, "a danger item paints the danger token");
  assert.match(html, /✓/, "a checked item shows the check");
  assert.ok(html.lastIndexOf('data-separator="true"') < html.indexOf('data-report="true"'));
});

test("the first item is lit on open (hover and focus paint the whole row)", () => {
  const html = renderToStaticMarkup(<Menu items={[{ label: "Open" }, { label: "Copy" }]} x={0} y={0} />);
  assert.equal(html.match(/background-color:var\(--accent\)/g)?.length, 1, "exactly one lit row");
  assert.match(html, /r-width-/, "rows carry a full width style");
});

test("arrow keys wrap over actionable items only", () => {
  const entries = menuEntries({ items: [{ head: "A" }, { label: "One" }, { separator: true }, { label: "Two" }] });
  const pick = selectableIndices(entries);
  assert.deepEqual(pick, [1, 3, 5]);
  assert.equal(moveActive(entries, -1, "ArrowDown"), 1);
  assert.equal(moveActive(entries, 1, "ArrowDown"), 3);
  assert.equal(moveActive(entries, 5, "ArrowDown"), 1, "wraps to the top");
  assert.equal(moveActive(entries, 1, "ArrowUp"), 5, "wraps to the bottom");
  assert.equal(moveActive(entries, -1, "ArrowUp"), 5);
  assert.equal(moveActive(entries, 3, "Home"), 1);
  assert.equal(moveActive(entries, 1, "End"), 5);
  assert.equal(moveActive([], 0, "ArrowDown"), -1);
});

test("type-ahead finds the next label that starts with the typed text", () => {
  const entries = menuEntries({ items: [{ label: "Copy" }, { label: "Close Tab" }, { label: "Close All Tabs" }], source: "other" });
  assert.equal(typeAhead(entries, 0, "c"), 1, "next C after the first");
  assert.equal(typeAhead(entries, 1, "c"), 2);
  assert.equal(typeAhead(entries, 2, "c"), 0, "wraps");
  assert.equal(typeAhead(entries, 0, "close a", true), 2);
  assert.equal(typeAhead(entries, 0, "z"), -1);
});

test("the menu stays inside the window", () => {
  assert.deepEqual(clampMenu(10, 10, 220, 100, 1280, 800), { left: 10, top: 10 });
  assert.deepEqual(clampMenu(1270, 790, 220, 100, 1280, 800), { left: 1054, top: 694 });
  assert.deepEqual(clampMenu(-5, -5, 220, 100, 390, 844), { left: 6, top: 6 });
  assert.deepEqual(clampMenu(380, 20, 220, 100, 390, 844), { left: 164, top: 20 }, "phone width");
});

test("a right-click opens the menu at the pointer and stops the browser's own menu; the menu key opens it under the surface", () => {
  const opened: string[] = [];
  const trigger = menuTrigger((x, y) => opened.push(`${x},${y}`));
  const onContext = trigger["onContextMenu"] as (e: { clientX: number; clientY: number; preventDefault: () => void }) => void;
  let prevented = 0;
  onContext({ clientX: 120, clientY: 80, preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 1);
  const onKey = trigger["onKeyDown"] as (e: { key: string; shiftKey?: boolean; preventDefault: () => void; currentTarget: { getBoundingClientRect: () => { left: number; bottom: number } } }) => void;
  const target = { getBoundingClientRect: () => ({ left: 10, bottom: 50 }) };
  onKey({ key: "ContextMenu", preventDefault: () => undefined, currentTarget: target });
  onKey({ key: "F10", shiftKey: true, preventDefault: () => undefined, currentTarget: target });
  onKey({ key: "F10", preventDefault: () => undefined, currentTarget: target });
  onKey({ key: "a", preventDefault: () => undefined, currentTarget: target });
  assert.deepEqual(opened, ["120,80", "10,50", "10,50"]);
});
