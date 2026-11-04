// The tab's right-click menu (lane l-chrome2a): Close, Close Other Tabs, Close Tabs to the Right, Pin and Unpin, Copy Link and Reopen Closed Tab, built from the controller's real state; a closed tab comes back, a pinned tab stays and
// Close does not take it; two tabs never show the same thing, so there is no Duplicate.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { MainTabs } from "./MainTabs.tsx";
import { createTabsController, keysToTheRight, pinTab } from "./store.ts";
import type { TabsState } from "./store.ts";

installDom();
const ctl = () => createTabsController({ deviceId: "mac", personId: "irfad", spaceId: "nw", storage: null, start: "home" });
const labelsOf = (root: unknown): string[] => { const out: string[] = []; const walk = (n: unknown): void => { const x = n as { props?: Record<string, unknown>; children?: unknown[] }; const t = x.props?.["data-testid"] ?? x.props?.["testID"]; if (typeof t === "string" && t.startsWith("menu-item-")) out.push(t.slice(10)); (x.children ?? []).forEach((c) => typeof c === "object" && walk(c)); }; walk(root); return out.filter((l) => l !== "report"); };
const contextMenu = async (root: unknown, key: string): Promise<void> => {
  const nodes: { props: Record<string, unknown> }[] = [];
  const walk = (n: unknown): void => { const x = n as { props?: Record<string, unknown>; children?: unknown[] }; if (x.props && typeof x.props["onContextMenu"] === "function" && String(x.props["data-testid"] ?? x.props["testID"] ?? "").includes(key)) nodes.push(x as never); (x.children ?? []).forEach((c) => typeof c === "object" && walk(c)); };
  walk(root);
  assert.ok(nodes[0], `a tab ${key}`);
  await act(async () => { (nodes[0]!.props["onContextMenu"] as (e: unknown) => void)({ preventDefault() {}, clientX: 4, clientY: 4, nativeEvent: {} }); });
  await flush();
};

test("pinning puts a tab at the left and Close leaves it; unpinning lets it go; Close to the Right names only unpinned tabs", () => {
  const c = ctl();
  c.openPlace("chats"); c.openPlace("files"); c.openPlace("records", "pruitt", "Pruitt matter");
  c.pin("files", true);
  assert.deepEqual(c.state().tabs.map((t) => [t.key, t.pinned === true]), [["files", true], ["home", false], ["chats", false], ["records:pruitt", false]]);
  c.close("files");
  assert.ok(c.state().tabs.some((t) => t.key === "files"), "a pinned tab stays");
  assert.deepEqual(keysToTheRight(c.state() as TabsState, "home"), ["chats", "records:pruitt"]);
  c.closeRight("home");
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["files", "home"]);
  c.pin("files", false);
  assert.equal(c.state().tabs.find((t) => t.key === "files")!.pinned, undefined);
  assert.equal(pinTab(c.state(), "home", false), c.state(), "nothing to change");
});

test("a closed tab comes back, the last closed first; a tab that was never closed has nothing to reopen", () => {
  const c = ctl();
  c.openPlace("chats"); c.openPlace("files");
  assert.equal(c.canReopen(), false);
  c.close("files"); c.close("chats");
  assert.equal(c.canReopen(), true);
  c.reopen();
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["home", "chats"]);
  c.reopen();
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["home", "chats", "files"]);
  assert.equal(c.canReopen(), false);
});

test("right-click on a tab: the menu follows the state, and Pin Tab, Close Tabs to the Right and Reopen Closed Tab act on the controller", async () => {
  const c = ctl();
  c.openPlace("chats"); c.openPlace("files");
  c.select("home");
  const moved: string[] = [];
  const root = await mount(createRoot as never, <MainTabs controller={c} onNavigate={(t) => void moved.push(t.key)} />);
  await flush();
  await contextMenu(root, "home");
  const first = labelsOf(root);
  assert.deepEqual(first, ["Close", "Close Other Tabs", "Close Tabs to the Right", "Pin Tab"], first.join("|"));
  await press(find(root as never, "menu-item-Pin Tab") as never); await flush();
  assert.equal(c.state().tabs[0]!.pinned, true);
  await contextMenu(root, "home");
  assert.ok(labelsOf(root).includes("Unpin Tab"), "the words follow the state");
  await press(find(root as never, "menu-item-Close Tabs to the Right") as never); await flush();
  assert.deepEqual(c.state().tabs.map((t) => t.key), ["home"]);
  assert.equal(c.canReopen(), true);
  await contextMenu(root, "home");
  assert.ok(labelsOf(root).includes("Reopen Closed Tab"));
  await press(find(root as never, "menu-item-Reopen Closed Tab") as never); await flush();
  assert.equal(c.state().tabs.length, 2);
  assert.ok(moved.length > 0, "the shell is told where the selection went");
});
