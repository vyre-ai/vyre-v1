// ui/Menu: Report a problem is always the last item, added here and never by a module; icons are all or none. Rows, keys and the report hook-up are covered here.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Menu,
  REPORT_A_PROBLEM,
  anchorRightFor,
  clampMenu,
  menuLeft,
  noteAnchor,
  resetAnchor,
  iconNames,
  iconsAllOrNone,
  kitMenuEntries,
  menuEntries,
  LONG_PRESS_MS,
  EMPTY_LABEL,
  LOADING_LABEL,
  choiceRows,
  useLiveRows,
  menuTrigger,
  moveActive,
  reportProblem,
  selectableIndices,
  setReportProblemHandler,
  typeAhead,
} from "./index.tsx";
import type { KitMenuItem, MenuEntry } from "./index.tsx";
import { isItem, isReportItem, isSeparator } from "./props.ts";
import { useContextMenu } from "./context.tsx";
import { tabMenuEntries } from "../TabStrip/index.tsx";
import { createRoot } from "test-renderer";
import { installDom, mount } from "../testing/dom.ts";

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
    const shared = tabMenuEntries(tabs, key, [{ label: "Pin", icon: "star" }], () => undefined);
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

test("an error row report carries the trace id as its own field, not inside the label", () => {
  const seen: { label?: string; traceId?: string }[] = [];
  const off = setReportProblemHandler((context) => seen.push(context));
  try {
    const entries = menuEntries({ items: [{ label: "Open" }] }, { label: "Docs did not read fee-schedule.csv", traceId: "tr_5e20b4" });
    const last = entries[entries.length - 1];
    assert.ok(last !== undefined && isItem(last) && last.onSelect !== undefined);
    last.onSelect();
    reportProblem({ label: "Error row", traceId: "tr_77" });
  } finally {
    off();
  }
  assert.equal(seen[0]?.traceId, "tr_5e20b4");
  assert.equal(seen[0]?.label, "Docs did not read fee-schedule.csv");
  assert.ok(!(seen[0]?.label ?? "").includes("tr_5e20b4"), "the label never carries the trace id");
  assert.equal(seen[1]?.traceId, "tr_77");
});

test("a rendered menu lists the items in order and Report a problem last, with a separator before it", () => {
  const html = renderToStaticMarkup(<Menu items={[{ head: "File" }, { label: "Open", icon: "open" }, { label: "Delete", icon: "trash", danger: true }, { label: "Pinned", icon: "star", checked: true }]} x={40} y={40} />);
  assert.match(html, /role="menu"/);
  assert.equal(html.match(/role="menuitem"/g)?.length, 4, "three items plus Report a problem");
  const order = ["File", "Open", "Delete", "Pinned", REPORT_A_PROBLEM].map((l) => html.indexOf(`>${l}<`));
  assert.ok(order.every((n) => n >= 0), "every label is rendered");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "labels render in order");
  assert.match(html, /data-separator="true"/);
  assert.equal(html.match(/data-report="true"/g)?.length, 1);
  assert.ok(html.indexOf('data-report="true"') > html.indexOf("Pinned"));
  assert.match(html, /var\(--danger\)/, "a danger item paints the danger token");
  assert.match(html, /✓/, "a checked item shows the check");
  assert.ok(html.lastIndexOf('data-separator="true"') < html.indexOf('data-report="true"'));
});

test("nothing is lit on open: hover or an arrow key lights a row, and the lit row is filled with the accent", () => {
  const html = renderToStaticMarkup(<Menu items={[{ label: "Open" }, { label: "Copy" }]} x={0} y={0} />);
  assert.equal(html.match(/background-color:var\(--accent\)/g)?.length ?? 0, 0, "no row is filled when the menu opens");
  assert.match(html, /r-width-/, "rows carry a full width style");
});

test("the menu panel can take focus, so Escape and the arrow keys reach it even though no row is lit on open", () => {
  const html = renderToStaticMarkup(<Menu items={[{ label: "Open" }, { label: "Copy" }]} x={0} y={0} />);
  assert.match(html, /<div[^>]*role="menu"[^>]*tabindex="-1"|<div[^>]*tabindex="-1"[^>]*role="menu"/, "the panel is focusable by script, not a tab stop");
});

test("a row that cannot be chosen (the Loading row) tells assistive tech it is disabled", () => {
  const html = renderToStaticMarkup(<Menu items={choiceRows([{ label: "Acme" }], true)} x={0} y={0} />);
  assert.match(html, /aria-disabled="true"[^>]*aria-label="Loading…"|aria-label="Loading…"[^>]*aria-disabled="true"/);
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
  assert.deepEqual(clampMenu(1270, 790, 220, 100, 1280, 800), { left: 1052, top: 692 });
  assert.deepEqual(clampMenu(-5, -5, 220, 100, 390, 844), { left: 8, top: 8 });
  assert.deepEqual(clampMenu(380, 20, 220, 100, 390, 844), { left: 162, top: 20 }, "phone width");
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

test("a finger held on a surface opens its menu on a phone's browser; moving, lifting early or a mouse does not; the click the lift makes is swallowed", async () => {
  const opened: string[] = [];
  const t = menuTrigger((x, y) => opened.push(`${x},${y}`));
  const down = t["onPointerDown"] as (e: { pointerType: string; clientX: number; clientY: number }) => void;
  const move = t["onPointerMove"] as (e: { clientX: number; clientY: number }) => void;
  const up = t["onPointerUp"] as () => void;
  const click = t["onClickCapture"] as (e: { stopPropagation: () => void; preventDefault: () => void }) => void;
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  down({ pointerType: "touch", clientX: 30, clientY: 40 }); await wait(LONG_PRESS_MS + 60);
  assert.deepEqual(opened, ["30,40"], "held still: it opens at the finger");
  let swallowed = 0;
  click({ stopPropagation: () => { swallowed += 1; }, preventDefault: () => { swallowed += 1; } });
  assert.equal(swallowed, 2, "the click after the lift does not press the row");
  let late = 0;
  click({ stopPropagation: () => { late += 1; }, preventDefault: () => undefined });
  assert.equal(late, 0, "only that one click");
  down({ pointerType: "touch", clientX: 5, clientY: 5 }); move({ clientX: 40, clientY: 5 }); await wait(LONG_PRESS_MS + 60);
  down({ pointerType: "touch", clientX: 5, clientY: 5 }); await wait(100); up(); await wait(LONG_PRESS_MS);
  down({ pointerType: "mouse", clientX: 5, clientY: 5 }); await wait(LONG_PRESS_MS + 60);
  assert.deepEqual(opened, ["30,40"], "a moved finger, an early lift and a mouse open nothing");
});

test("useContextMenu: one set of props opens the menu by right-click and the Menu key, and a hint key runs its item on the row, but never inside a field", () => {
  const ran: string[] = [];
  const entries = (): MenuEntry[] => [{ label: "Open", hint: "Enter", onSelect: () => ran.push("open") }, { separator: true }, { label: "Star", hint: "S", onSelect: () => ran.push("star") }, { label: "Delete", danger: true, hint: "\u2318\u232b", onSelect: () => ran.push("delete") }];
  let ctx: ReturnType<typeof useContextMenu> | null = null;
  const Probe = (): null => { ctx = useContextMenu(); return null; };
  renderToStaticMarkup(<Probe />);
  const props = ctx!.on(entries, { label: "Rivera intake" }) as Record<string, (e: unknown) => void>;
  assert.equal(typeof props["onContextMenu"], "function");
  assert.equal(typeof props["onPointerDown"], "function", "long press is there too");
  const key = (k: string, o: object = {}): void => props["onKeyDown"]!({ key: k, preventDefault: () => undefined, stopPropagation: () => undefined, currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) }, ...o });
  key("s"); key("S"); key("Backspace", { metaKey: true });
  assert.deepEqual(ran, ["star", "star", "delete"]);
  key("s", { target: { tagName: "INPUT" } }); key("s", { target: { isContentEditable: true } });
  key("x"); key("Enter");
  assert.deepEqual(ran, ["star", "star", "delete"], "typing in a field, an unknown key and plain Enter run nothing");
});

test("a count sits in its own quiet right-aligned column, never in the label", () => {
  const html = renderToStaticMarkup(<Menu items={[{ label: "Email", count: 8, checked: true }, { label: "Text", count: 4 }]} x={0} y={0} />);
  assert.match(html, /data-testid="menu-count-Email"[^>]*>8</, "the count renders as its own element");
  assert.ok(!html.includes("Email (8)"), "the label stays plain");
  assert.ok(html.indexOf(">8<") < html.indexOf("✓"), "the count comes before the check");
  assert.ok(!html.includes("background-color:var(--accent)"), "no row is lit on open");
});

test("the checked item (the current Space, a chosen filter) says it is current for assistive tech and for a click gate", () => {
  const html = renderToStaticMarkup(<Menu items={[{ label: "Fresh Co", checked: true }, { label: "Other" }]} x={0} y={0} />);
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1, "only the checked item");
  assert.match(html, /aria-current="true"[^>]*data-testid="menu-item-Fresh Co"|data-testid="menu-item-Fresh Co"[^>]*aria-current="true"/);
});

test("a disabled item is drawn but cannot be landed on, and keeps its reason for the hover text", () => {
  const entries: MenuEntry[] = [{ label: "Rename" }, { label: "Delete", disabled: true, reason: "Built in record types cannot be deleted" }, { label: "Copy" }];
  assert.deepEqual(selectableIndices(entries), [0, 2]);
  assert.equal(moveActive(entries, 0, "ArrowDown"), 2);
});

// ---- search, leading element, pinned row (the step picker)

test("a typed search keeps matching rows, drops a group with none, matches keywords and always keeps a pinned row", async () => {
  const { filterMenuEntries } = await import("./props.ts");
  const items: MenuEntry[] = [
    { head: "Vyre" }, { label: "Find records" }, { label: "Create task" },
    { head: "Your connectors" }, { label: "Acme: List invoices", keywords: "acme invoicing" },
    { head: "AI and code" }, { label: "Run code" },
    { separator: true }, { label: "Build a connector", pinned: true },
  ];
  const labels = (q: string): string[] => filterMenuEntries(items, q).map((e) => ("head" in e ? `# ${e.head}` : "separator" in e ? "---" : e.label));
  assert.equal(labels("").length, items.length);
  assert.deepEqual(labels("task"), ["# Vyre", "Create task", "---", "Build a connector"]);
  assert.deepEqual(labels("invoicing"), ["# Your connectors", "Acme: List invoices", "---", "Build a connector"]);
  assert.deepEqual(labels("zzz"), ["Build a connector"], "only the pinned row, and no stray separator");
});

test("a menu with search draws the field, a leading element and the pinned row", () => {
  const html = renderToStaticMarkup(<Menu source="other" search="Search steps" width={320} items={[{ head: "Vyre" }, { label: "Find records", leading: <span data-logo="x" /> }, { label: "Build a connector", pinned: true }]} />);
  assert.match(html, /placeholder="Search steps"/);
  assert.match(html, /data-logo="x"/);
  assert.match(html, /Build a connector/);
});

test("an entry with a mark draws a small dot whose text is its tooltip and label", () => {
  const html = renderToStaticMarkup(<Menu source="other" items={[{ label: "Acme: Create invoice", mark: "Untested" }, { label: "Acme: List invoices" }]} />);
  assert.match(html, /title="Untested"/);
  assert.equal((html.match(/data-mark="true"/g) ?? []).length, 1);
});

test("a menu opened from a button near the right edge lines up with the button's right edge, then stays 8 px inside the window", () => {
  resetAnchor();
  // a trigger 96 wide at x 1090 in a 1280 window; the menu is 220 wide and will not fit to its right
  noteAnchor({ getBoundingClientRect: () => ({ left: 1090, right: 1186, bottom: 40 }) });
  const right = anchorRightFor(1090);
  assert.equal(right, 1186, "a menu opened at the control's left edge knows the control's right edge");
  assert.equal(menuLeft(1090, 220, 1280, right) + 220, 1186, "the menu's right edge is the trigger's");
  // a trigger so close to the edge that lining up would leave the window: clamp to 8
  noteAnchor({ getBoundingClientRect: () => ({ left: 1250, right: 1274, bottom: 40 }) });
  assert.equal(menuLeft(1250, 220, 1280, anchorRightFor(1250)), 1280 - 220 - 8);
  // "under the pressed button" (-1) also flips; a right-click at the pointer does not
  assert.equal(anchorRightFor(-1), 1274);
  assert.equal(anchorRightFor(900), undefined);
  // room on the right: no flip
  assert.equal(menuLeft(100, 220, 1280, 160), 100);
  resetAnchor();
});

test("choiceRows: a list still loading says so and cannot be chosen; a loaded empty list says it is empty; a loaded list is unchanged", () => {
  const rows = [{ label: "Acme" }, { label: "Birch" }];
  const loading = choiceRows(rows, true);
  assert.deepEqual(labels(loading), ["Acme", "Birch", LOADING_LABEL]);
  const last = loading[2]!;
  assert.ok(isItem(last) && last.disabled === true, "the loading row cannot be chosen");
  const none = choiceRows([], true);
  assert.deepEqual(labels(none), [LOADING_LABEL], "no rows yet still shows the loading row, never an empty list");
  const empty = choiceRows([], false);
  assert.deepEqual(labels(empty), [EMPTY_LABEL]);
  assert.ok(isItem(empty[0]!) && (empty[0] as { disabled?: boolean }).disabled === true);
  assert.deepEqual(labels(choiceRows(rows, false)), ["Acme", "Birch"]);
});

test("useLiveRows sends new rows to the open menu when the data arrives, and stays quiet while they are the same", async () => {
  const restore = installDom();
  const { act } = await import("react");
  const sent: string[][] = [];
  const update = (items: readonly MenuEntry[]): void => { sent.push(labels(items)); };
  function Probe({ rows }: { rows: MenuEntry[] }) { useLiveRows(update, rows); return null; }
  const r = createRoot();
  try {
    await act(async () => { r.render(<Probe rows={choiceRows([], true)} />); });
    assert.deepEqual(sent.at(-1), [LOADING_LABEL]);
    const before = sent.length;
    await act(async () => { r.render(<Probe rows={choiceRows([], true)} />); });
    assert.equal(sent.length, before, "same rows, nothing sent");
    await act(async () => { r.render(<Probe rows={choiceRows([{ label: "record.*" }, { label: "record.created" }], false)} />); });
    assert.deepEqual(sent.at(-1), ["record.*", "record.created"], "the loaded rows replace the loading row in place");
  } finally { restore(); }
});

test("Escape closes a menu from wherever focus is, plain or with a search field, and only that menu; the search field is the one that takes focus", async () => {
  for (const search of [undefined, "Find"] as const) {
    const html = renderToStaticMarkup(<Menu items={[{ label: "Open" }]} x={0} y={0} {...(search ? { search } : {})} />);
    assert.equal(/data-testid="menu-search"/.test(html), search !== undefined, "the search field is drawn only for a searchable menu");
    assert.match(html, /tabindex="-1"/, "the panel can take focus; a searchable menu leaves focus to its search field (autoFocus)");
  }
  const restore = installDom();
  const { act } = await import("react");
  const g = globalThis as unknown as { document: { addEventListener: (t: string, fn: (e: { key: string; preventDefault(): void; stopPropagation(): void }) => void, c?: boolean) => void; removeEventListener: (t: string, fn: unknown, c?: boolean) => void } };
  const doc = g.document;
  const was = { add: doc.addEventListener, remove: doc.removeEventListener };
  const heard: Array<(e: { key: string; preventDefault(): void; stopPropagation(): void }) => void> = [];
  doc.addEventListener = (t, fn, c) => { if (t === "keydown" && c === true) heard.push(fn); };
  doc.removeEventListener = () => undefined;
  try {
    for (const search of [undefined, "Find"] as const) {
      heard.length = 0;
      let closed = 0;
      const r = createRoot();
      await act(async () => { r.render(<Menu items={[{ label: "Open" }, { label: "Copy" }]} x={0} y={0} onClose={() => { closed++; }} {...(search ? { search } : {})} />); });
      assert.equal(heard.length, 1, "one capture-phase key listener while the menu is open");
      let stopped = 0;
      await act(async () => { heard[0]!({ key: "a", preventDefault() {}, stopPropagation() { stopped++; } }); });
      assert.equal(closed, 0, "another key does not close it");
      await act(async () => { heard[0]!({ key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } }); });
      assert.equal(closed, 1, "Escape closes it");
      assert.equal(stopped, 1, "and the key stops there, so a sheet around the menu stays open");
    }
  } finally { doc.addEventListener = was.add; doc.removeEventListener = was.remove; restore(); }
});
