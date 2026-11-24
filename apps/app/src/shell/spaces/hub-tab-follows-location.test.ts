// A tab never names one thing while the page shows another. A selected tab restored on an item (a task) and the app loaded at the Chats landing: the selected tab must describe the landing
// (the same-tab navigation changes that tab), and a request for a place with no item still goes to the tab the place already has, showing what that tab shows.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub, staleReport } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";
import { placeTab, tabsStorageKey, writeTabs } from "../tabs/store.ts";
import type { TabEntry } from "../tabs/store.ts";
import { readUrlIntoHub } from "../session/url.ts";

const TASK = "screen=tasks.page&taskId=tsk_1";
function restored(tabs: TabEntry[], active: string) {
  const rows = new Map<string, string>([
    [tabsStorageKey("web", "imran", SEED_DEFS[0]!.spaceId), writeTabs({ tabs, active })],
  ]);
  const storage = {
    getItem: (k: string) => rows.get(k) ?? null,
    setItem: (k: string, v: string) => {
      rows.set(k, v);
    },
  };
  return createShellHub({
    spaces: SEED_DEFS,
    openId: SEED_DEFS[0]!.spaceId,
    personId: "imran",
    deviceId: "web",
    storage,
    skeletonMs: 0,
  });
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
  assert.ok(
    !hub
      .session()
      .tabs.state()
      .tabs.some((t) => t.title === "Sign in to olivia again"),
    "no tab still names the task",
  );
});

test("a load at the landing while another place is selected: the place's tab is the landing, and a tab on an item stays an item", () => {
  const home = placeTab("files"),
    thr = placeTab("chats", "thr_1", "Renewal");
  const hub = restored([home, thr], home.key);
  readUrlIntoHub(hub, { pathname: "/chat", hash: "" });
  const s = shown(hub);
  assert.deepEqual([s.place, s.hash, s.tab.key], ["chats", "", "chats"]);
  assert.ok(
    hub
      .session()
      .tabs.state()
      .tabs.some((t) => t.key === thr.key),
    "the chat tab is another tab and stays",
  );
});

test("the Chats rail (a place with no item named) goes to the tab the place has and shows what it shows", () => {
  const home = placeTab("files"),
    thr = placeTab("chats", "thr_1", "Renewal");
  const hub = restored([home, thr], home.key);
  hub.go("chats");
  const s = shown(hub);
  assert.equal(s.tab.key, thr.key);
  assert.deepEqual([s.place, s.hash], ["chats", "thr_1"], "the page shows that tab's chat");
});

test("a link to an item that has a tab focuses that tab; closing the selected tab shows the neighbour", () => {
  const thr = placeTab("chats", "thr_1", "Renewal"),
    two = placeTab("chats", "thr_2", "Intake");
  const hub = restored([thr, two], thr.key);
  hub.go("chats", "thr_2");
  assert.deepEqual([shown(hub).tab.key, shown(hub).hash], [two.key, "thr_2"]);
  hub.closeTab();
  assert.deepEqual([shown(hub).tab.key, shown(hub).hash], [thr.key, "thr_1"]);
});

test("the hub counts the addresses that came from outside, never the page's own moves", () => {
  const hub = restored([], "chats");
  const at = (h: string): number => {
    readUrlIntoHub(hub, { pathname: "/chat", hash: h });
    return hub.state().links;
  };
  const a = at("screen=tasks.page&taskId=tsk_1");
  assert.equal(at("screen=tasks.page&taskId=tsk_1"), a, "the same address again is no link");
  const b = at("");
  assert.equal(b, a + 1, "an address that came from outside counts");
  assert.equal(at("screen=tasks.page&taskId=tsk_1"), b + 1, "coming back to the same address by a link counts");
  hub.move("chats", "screen=chats.notes");
  assert.equal(hub.state().links, b + 1, "the page's own move is not a link");
});

test("a tab switch, Back or any move that is not a place's own report ends the claim that the address on screen is that report: a landing tab whose address equals the last own report is never taken for its echo", () => {
  const hub = restored([], "chats");
  hub.move("chats", "", true); // the page reported the landing address
  assert.equal(hub.state().ownHash, "", "the own report is on record");
  hub.go("chats", "screen=tasks.page&taskId=tsk_1");
  assert.notEqual(hub.state().ownHash, "", "opening something else ends it");
  hub.move("chats", "", true);
  assert.equal(hub.state().ownHash, "");
  hub.back();
  assert.notEqual(hub.state().ownHash, "", "Back ends it");
  hub.move("chats", "", true);
  hub.closeTab();
  assert.notEqual(hub.state().ownHash, "", "closing a tab ends it");
});

test("a report issued by a page drawn before a move that is not its own is stale; showTab ends the own-report claim too", () => {
  const task = placeTab("chats", TASK, "Sign in to olivia again");
  const landing = placeTab("chats", "", "New chat");
  const hub = restored([landing, task], landing.key);
  const drawn = hub.state().shifts;
  hub.move("chats", "", true);
  assert.equal(hub.state().ownHash, "");
  assert.equal(
    staleReport(drawn, hub.state().shifts),
    false,
    "a place's own report does not make the next report stale",
  );
  hub.showTab(task);
  assert.notEqual(hub.state().ownHash, "", "a tab switch ends the claim");
  assert.equal(staleReport(drawn, hub.state().shifts), true, "a page drawn before the switch now reports stale");
  assert.equal(staleReport(hub.state().shifts, hub.state().shifts), false, "a page drawn after it reports normally");
});

test("every method that changes the address on screen is a shift: fill, reopenTab, newTab, showTab, go, Back and closeTab", () => {
  const task = placeTab("chats", TASK, "Sign in to olivia again");
  const hub = restored([task], task.key);
  const shifted = (name: string, run: () => void): void => {
    const before = hub.state().shifts;
    hub.move("chats", "", true); // a place's own report: not a shift
    assert.equal(hub.state().shifts, before, `${name}: an own report is not a shift`);
    run();
    assert.ok(hub.state().shifts > before, `${name} is a shift`);
    assert.notEqual(hub.state().ownHash, "", `${name} ends the own-report claim`);
  };
  shifted("showTab", () => hub.showTab(task));
  shifted("go", () => hub.go("chats", "screen=tasks.page&taskId=tsk_2"));
  shifted("newTab", () => hub.newTab());
  shifted("closeTab", () => hub.closeTab());
  shifted("reopenTab", () => hub.reopenTab());
  shifted("fill", () =>
    hub.fill("chats", "screen=tasks.page&taskId=tsk_3", "A task", hub.session().tabs.state().active),
  );
  shifted("back", () => void hub.back());
});

test("a shift is counted when the address really changes, not when a move starts: a Back with nowhere to go leaves the hub where the drawn page is, and a dropped report is counted", () => {
  const hub = restored([], "chats");
  const before = hub.state().shifts;
  assert.equal(hub.back(), false, "nowhere to go");
  assert.equal(hub.state().shifts, before, "no emit, no shift: the page drawn is not stale");
  hub.go("chats", "screen=tasks.page&taskId=tsk_9");
  assert.ok(hub.state().shifts > before, "a move that emits counts");
  const dropped = hub.state().staleDropped;
  hub.droppedStale();
  assert.equal(hub.state().staleDropped, dropped + 1, "a dropped report is counted");
});
