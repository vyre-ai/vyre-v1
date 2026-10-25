// The title bar (spec 3.0): title, tiny confirmations with Undo, the sync chip, Search, the skin dropdown (13 skins plus System, seven dark and six light).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { isHead, isItem } from "../../../../../ui/src/Menu/props.ts";
import { createShellHub, titleText } from "../spaces/hub.ts";
import { SEED_DEFS } from "../spaces/model.ts";
import { TitleBar } from "./TitleBar.tsx";
import type { TitleBarProps } from "./TitleBar.tsx";
import { SYSTEM_SKIN, skinMenuEntries, skinName, syncLabel } from "./model.ts";

const props = (over: Partial<TitleBarProps> = {}): TitleBarProps => ({
  title: "Vyre · Northwind · Chats", status: null, onUndo: () => undefined, online: true, waiting: 0, onOpenWaiting: () => undefined, onSearch: () => undefined, skin: "paper", onSkin: () => undefined, ...over,
});
const html = (p: TitleBarProps): string => renderToStaticMarkup(<TitleBar {...p} />).replaceAll("<!-- -->", "");

test("the sync chip says Synced, Sending or Offline with the count, and only a pending state opens Waiting and Conflicts", () => {
  assert.deepEqual(syncLabel(true, 0), { text: "Synced", tone: "ok", opens: false });
  assert.deepEqual(syncLabel(true, 2), { text: "Sending 2 changes", tone: "busy", opens: true });
  assert.deepEqual(syncLabel(true, 1), { text: "Sending 1 change", tone: "busy", opens: true });
  assert.deepEqual(syncLabel(false, 3), { text: "Offline, 3 changes waiting", tone: "offline", opens: true });
  assert.deepEqual(syncLabel(false, 1), { text: "Offline, 1 change waiting", tone: "offline", opens: true });
  assert.deepEqual(syncLabel(false, 0), { text: "Offline", tone: "offline", opens: false });
});

test("the bar shows the title, the sync chip, Search with its key and the skin's name", () => {
  const out = html(props());
  assert.ok(out.includes("Vyre · Northwind · Chats"));
  assert.ok(out.includes("Synced") && out.includes("Search") && out.includes("⌘K") && out.includes("Paper"));
  assert.ok(html(props({ online: false, waiting: 3 })).includes("Offline, 3 changes waiting"));
  assert.ok(html(props({ skin: SYSTEM_SKIN })).includes("System"));
});

test("a tiny confirmation replaces the title, with Undo when it can be taken back", () => {
  const plain = html(props({ status: { id: 1, text: "Saved", undo: false } }));
  assert.ok(plain.includes("Saved") && !plain.includes("Vyre · Northwind") && !plain.includes('data-testid="title-undo"'));
  const undo = html(props({ status: { id: 2, text: "Task moved to Friday", undo: true } }));
  assert.ok(undo.includes("Task moved to Friday") && undo.includes('data-testid="title-undo"'));
});

test("a phone-width window keeps the icons and drops the labels", () => {
  const out = html(props({ compact: true }));
  assert.ok(!out.includes(">Search<") && !out.includes("⌘K") && !out.includes(">Paper<"));
  assert.ok(out.includes('data-testid="title-search"') && out.includes('data-testid="title-skin"'));
});

test("the skin menu lists System, seven dark skins, six light skins, checks the open one and applies a choice", () => {
  const chosen: string[] = [];
  const entries = skinMenuEntries("graphite", (id) => chosen.push(id));
  const heads = entries.filter(isHead).map((e) => e.head);
  assert.deepEqual(heads, ["Dark", "Light"]);
  const items = entries.filter(isItem);
  assert.equal(items.length, 14, "System plus thirteen skins");
  assert.equal(items[0]?.label, "System");
  assert.equal(entries.findIndex((e) => isHead(e) && e.head === "Dark") < entries.findIndex((e) => isHead(e) && e.head === "Light"), true, "dark skins first");
  const dark = items.slice(1, 8).map((e) => e.label);
  const light = items.slice(8).map((e) => e.label);
  assert.equal(dark.length, 7);
  assert.equal(light.length, 6);
  assert.ok(dark.includes("Graphite") && light.includes("Paper"));
  assert.deepEqual(items.filter((e) => e.checked === true).map((e) => e.label), ["Graphite"]);
  items.find((e) => e.label === "Paper")?.onSelect?.();
  assert.deepEqual(chosen, ["paper"]);
  assert.equal(skinName("graphite"), "Graphite");
  assert.equal(skinName("unknown"), "System");
});

test("the title names the Space and the place, and Away when you set yourself away", () => {
  assert.equal(titleText("Northwind", "chats", false), "Vyre · Northwind · Chats");
  assert.equal(titleText("Harbor Studio", "home", true), "Vyre · Harbor Studio · Home · Away");
});

test("the hub keeps a confirmation for a moment, undo takes the action back, offline carries the count", () => {
  const timers: (() => void)[] = [];
  const hub = createShellHub({ spaces: SEED_DEFS, openId: "nw", personId: "irfad", deviceId: "mac", storage: null, later: (fn) => { timers.push(fn); return () => undefined; } });
  let undone = 0;
  hub.flash("Task moved to Friday", () => { undone += 1; });
  assert.deepEqual(hub.state().status, { id: 1, text: "Task moved to Friday", undo: true });
  hub.undoStatus();
  assert.equal(undone, 1);
  assert.equal(hub.state().status, null);
  hub.flash("Saved");
  assert.equal(hub.state().status?.text, "Saved");
  timers[timers.length - 1]?.();
  assert.equal(hub.state().status, null, "the confirmation goes away by itself");
  hub.setOnline(false, 3);
  assert.deepEqual([hub.state().online, hub.state().waiting], [false, 3]);
  assert.equal(hub.session().connection, "offline");
  hub.setAway(true);
  assert.equal(hub.state().away, true);
});
