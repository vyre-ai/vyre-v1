// A tab never names one thing while the page shows another. A selected tab restored on an item (a task) and the app loaded at the Chats landing: the selected tab must describe the landing
// (the same-tab navigation changes that tab), and a request for a place with no item still goes to the tab the place already has, showing what that tab shows.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";
import { placeTab, tabsStorageKey, writeTabs } from "../tabs/store.ts";
import type { TabEntry } from "../tabs/store.ts";
import { readUrlIntoHub } from "../session/url.ts";

const TASK = "screen=tasks.page&taskId=tsk_1";
function restored(tabs: TabEntry[], active: string) {
  const rows = new Map<string, string>([[tabsStorageKey("web", "irfad", SEED_DEFS[0]!.spaceId), writeTabs({ tabs, active })]]);
  const storage = { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v); } };
  return createShellHub({ spaces: SEED_DEFS, openId: SEED_DEFS[0]!.spaceId, personId: "irfad", deviceId: "web", storage, skeletonMs: 0 });
}
const shown = (hub: ReturnType<typeof restored>) => {
  const t = hub.session().tabs.state();
  const sel = t.tabs.find((x) => x.key === t.active)!;
  return { place: hub.state().place, hash: hub.state().hash, tab: sel };
};

test("a restored selected task tab and a load at the Chats landing: the selected tab becomes the landing, never the task", () => {
  const task = placeTab("chats", TASK, "Sign in to olivia again");
  const hub = restored([task], task.key);
  readUrlIntoHub(hub, { pathname: "/chat", hash: "" });
  const s = shown(hub);
  assert.deepEqual([s.place, s.hash], ["chats", ""]);
  assert.equal(s.tab.key, "chats", "the selected tab is the Chats tab");
  assert.equal(s.tab.hash, undefined);
  assert.ok(!hub.session().tabs.state().tabs.some((t) => t.title === "Sign in to olivia again"), "no tab still names the task");
});

test("a load at the landing while another place is selected: the place's tab is the landing, and a tab on an item stays an item", () => {
  const home = placeTab("files"), thr = placeTab("chats", "thr_1", "Renewal");
  const hub = restored([home, thr], home.key);
  readUrlIntoHub(hub, { pathname: "/chat", hash: "" });
  const s = shown(hub);
  assert.deepEqual([s.place, s.hash, s.tab.key], ["chats", "", "chats"]);
  assert.ok(hub.session().tabs.state().tabs.some((t) => t.key === thr.key), "the chat tab is another tab and stays");
});

test("the Chats rail (a place with no item named) goes to the tab the place has and shows what it shows", () => {
  const home = placeTab("files"), thr = placeTab("chats", "thr_1", "Renewal");
  const hub = restored([home, thr], home.key);
  hub.go("chats");
  const s = shown(hub);
  assert.equal(s.tab.key, thr.key);
  assert.deepEqual([s.place, s.hash], ["chats", "thr_1"], "the page shows that tab's chat");
});

test("a link to an item that has a tab focuses that tab; closing the selected tab shows the neighbour", () => {
  const thr = placeTab("chats", "thr_1", "Renewal"), two = placeTab("chats", "thr_2", "Intake");
  const hub = restored([thr, two], thr.key);
  hub.go("chats", "thr_2");
  assert.deepEqual([shown(hub).tab.key, shown(hub).hash], [two.key, "thr_2"]);
  hub.closeTab();
  assert.deepEqual([shown(hub).tab.key, shown(hub).hash], [thr.key, "thr_1"]);
});
