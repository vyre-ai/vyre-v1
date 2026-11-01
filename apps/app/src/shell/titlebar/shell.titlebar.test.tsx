// The title bar (spec 3.0): title, tiny confirmations with Undo, the sync chip, Search, the skin dropdown (15 skins plus Vyre, eight dark and seven light).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { isHead, isItem } from "../../../../../ui/src/Menu/props.ts";
import { createShellHub, titleText } from "../spaces/hub.ts";
import { SEED_DEFS } from "../spaces/model.ts";
import { Toast } from "../spaces/Toast.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { ResumeContext } from "../../onboarding/resume-context.ts";
import { ResumeChip } from "../../onboarding/ResumeChip.tsx";
import type { TitleBarProps } from "./TitleBar.tsx";
import { skins } from "../../../../../ui/src/tokens/skins.ts";
import { SYSTEM_SKIN, skinMenuEntries, skinName, syncLabel } from "./model.ts";

const props = (over: Partial<TitleBarProps> = {}): TitleBarProps => ({
  title: "Vyre · Northwind · Chats", status: null, onUndo: () => undefined, online: true, waiting: 0, onOpenWaiting: () => undefined, onSearch: () => undefined, skin: "paper", onSkin: () => undefined, ...over,
});
const html = (p: TitleBarProps): string => renderToStaticMarkup(<TitleBar {...p} />).replaceAll("<!-- -->", "");

test("the sync chip says Connected, Sending or Offline with the count, and only a pending state opens Waiting and Conflicts", () => {
  assert.deepEqual(syncLabel(true, 0), { text: "Connected", tone: "ok", opens: false });
  assert.deepEqual(syncLabel(true, 2), { text: "Sending 2 changes", tone: "busy", opens: true });
  assert.deepEqual(syncLabel(true, 1), { text: "Sending 1 change", tone: "busy", opens: true });
  assert.deepEqual(syncLabel(false, 3), { text: "Offline, 3 changes waiting", tone: "offline", opens: true });
  assert.deepEqual(syncLabel(false, 1), { text: "Offline, 1 change waiting", tone: "offline", opens: true });
  assert.deepEqual(syncLabel(false, 0), { text: "Offline", tone: "offline", opens: false });
});

test("a calm bar is one search field; the connection shows only when it is broken, and the title is for screen readers", () => {
  const out = html(props());
  assert.ok(out.includes('aria-label="Vyre · Northwind · Chats"'));
  assert.ok(out.includes("Search or run a command") && out.includes("⌘K"));
  assert.ok(!out.includes("Connected") && !out.includes('data-testid="title-sync"'), "never shown while fine");
  assert.ok(!out.includes('data-testid="title-skin"'), "the skin lives in Settings and Cmd-K");
  assert.ok(html(props({ online: false, waiting: 3 })).includes("Offline, 3 changes waiting"));
  assert.ok(html(props({ waiting: 2 })).includes("Sending 2 changes"));
});

test("a confirmation is a toast with Undo when it can be taken back, not a line in the title bar", () => {
  const plain = renderToStaticMarkup(<Toast status={{ id: 1, text: "Saved", undo: false }} onUndo={() => undefined} />);
  assert.ok(plain.includes("Saved") && !plain.includes('data-testid="toast-undo"'));
  const undo = renderToStaticMarkup(<Toast status={{ id: 2, text: "Task moved to Friday", undo: true }} onUndo={() => undefined} />);
  assert.ok(undo.includes("Task moved to Friday") && undo.includes('data-testid="toast-undo"'));
  assert.equal(renderToStaticMarkup(<Toast status={null} onUndo={() => undefined} />), "");
});

test("a phone-width window keeps the icon and drops the words", () => {
  const out = html(props({ compact: true }));
  assert.ok(!out.includes("Search or run a command") && !out.includes("⌘K"));
  assert.ok(out.includes('data-testid="title-search"'));
});

test("the skin menu lists Vyre, eight dark skins, seven light skins, checks the open one and applies a choice", () => {
  const chosen: string[] = [];
  const entries = skinMenuEntries("graphite", (id) => chosen.push(id), { space: "Northwind", onMore: () => chosen.push("more") });
  const heads = entries.filter(isHead).map((e) => e.head);
  assert.deepEqual(heads, ["Your skin in Northwind", "Dark", "Light"]);
  const items = entries.filter(isItem);
  assert.equal(items.length, 17, "Vyre, fifteen skins and More in Appearance");
  assert.equal(items[16]?.label, "More in Appearance");
  assert.equal(items[0]?.label, "Vyre");
  assert.equal(entries.findIndex((e) => isHead(e) && e.head === "Dark") < entries.findIndex((e) => isHead(e) && e.head === "Light"), true, "dark skins first");
  const dark = items.slice(1, 9).map((e) => e.label);
  const light = items.slice(9, 16).map((e) => e.label);
  assert.equal(dark.length, 8);
  assert.equal(dark[0], "Vyre Black");
  assert.equal(light[0], "Vyre Light");
  assert.equal(light.length, 7);
  assert.ok(dark.includes("Graphite") && light.includes("Paper"));
  assert.deepEqual(items.filter((e) => e.checked === true).map((e) => e.label), ["Graphite"]);
  assert.ok(items.every((e) => typeof e.icon === "string" && e.icon.startsWith("<svg")), "every row has an icon, System included");
  assert.ok(items[0]?.icon?.includes("M8 2.5v11"), "System is the half-filled circle");
  const graphite = items.find((e) => e.label === "Graphite")?.icon ?? "";
  assert.ok(graphite.includes(skins.find((k) => k.id === "graphite")!.palette.accent) && !/<style|style=/.test(graphite), "a swatch carries the skin's colours as attributes only");
  items.find((e) => e.label === "Paper")?.onSelect?.();
  assert.deepEqual(chosen, ["paper"]);
  assert.equal(skinName("graphite"), "Graphite");
  assert.equal(skinName("unknown"), "Vyre");
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

test("unfinished setup is a pill in the title bar, not a floating chip over the rail: it sits in the bar's flow and never takes a position", () => {
  const pill = <ResumeChip flow="personal" progress={{ ai: "done" }} device="mac" compact={false} onOpen={() => undefined} />;
  const withSetup = renderToStaticMarkup(<ResumeContext.Provider value={{ handled: 1, total: 6, open: () => undefined, pill }}><TitleBar {...props()} /></ResumeContext.Provider>).replaceAll("<!-- -->", "");
  assert.ok(withSetup.includes('data-testid="title-setup"') && withSetup.includes("Finish setup, 1 of"), "the bar carries the entry");
  const bar = withSetup.slice(withSetup.indexOf('data-testid="shell-titlebar"'));
  assert.ok(bar.indexOf('data-testid="title-setup"') < bar.indexOf('data-testid="title-search"'), "it sits left of the search, inside the bar");
  assert.ok(!/position:\s*absolute/.test(withSetup.slice(withSetup.indexOf('data-testid="title-setup"'), withSetup.indexOf('data-testid="title-search"'))), "nothing in it is positioned over the page");
  assert.ok(!html(props()).includes("title-setup"), "no unfinished setup, no entry");
});
