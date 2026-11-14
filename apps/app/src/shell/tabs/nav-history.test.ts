// One history per tab (NAV-2026-11-14 rules 1 and 3): a step inside a tab is remembered, Back returns to it and Forward returns again; a tab opened from another goes back to it; a screen
// opened cold goes up. These are the behaviours the owner reported missing on 14 Nov (the agent's page and a file had no way back).
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_TABS,
  HISTORY_MAX,
  backTarget,
  createTabsController,
  forwardTarget,
  goBack,
  goForward,
  moveTab,
  openTab,
  placeTab,
  readTabs,
  upHash,
  writeTabs,
} from "./store.ts";
import type { TabsState } from "./store.ts";

const AGENT = "screen=chats.agent-page&agentId=agt_1";
const FILE = "subject=file:fil_1";
const start = (): TabsState => openTab(EMPTY_TABS, placeTab("chats"));
const active = (s: TabsState) => s.tabs.find((t) => t.key === s.active)!;

test("the agent's page is a step: Back returns to the chat it was opened from, Forward returns to the page", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "Renewal");
  s = moveTab(s, "chats", AGENT, "Agent");
  assert.equal(active(s).hash, AGENT);
  assert.equal(backTarget(s)?.title, "Renewal", "the control says where it goes");
  const back = goBack(s).state;
  assert.equal(active(back).hash, "subject=thread:thr_1");
  assert.equal(forwardTarget(back)?.hash, AGENT);
  const again = goForward(back);
  assert.equal(active(again).hash, AGENT);
  assert.equal(forwardTarget(again), null);
});

test("Back goes all the way to the landing and then has nowhere to go", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "Renewal");
  s = moveTab(s, "chats", AGENT, "Agent");
  s = goBack(goBack(s).state).state;
  assert.equal(active(s).hash, undefined, "the place's landing");
  assert.equal(active(s).key, "chats", "the place's own tab keeps its key");
  assert.equal(backTarget(s), null);
});

test("a new step clears Forward", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "A");
  s = moveTab(s, "chats", AGENT, "Agent");
  s = goBack(s).state;
  s = moveTab(s, "chats", "subject=thread:thr_2", "B");
  assert.equal(forwardTarget(s), null);
  assert.equal(active(goBack(s).state).hash, "subject=thread:thr_1");
});

test("the same address again is not a step", () => {
  let s = moveTab(start(), "chats", AGENT, "Agent");
  const before = (active(s).back ?? []).length;
  s = moveTab(s, "chats", AGENT, "Agent");
  assert.equal((active(s).back ?? []).length, before);
});

test("a screen opened cold has an up: an agent's page goes to its place's landing, and Forward comes back", () => {
  const cold = openTab(EMPTY_TABS, placeTab("chats", AGENT, "Agent"));
  assert.equal(backTarget(cold)?.kind, "up");
  const up = goBack(cold).state;
  assert.equal(active(up).hash, undefined);
  assert.equal(active(goForward(up)).hash, AGENT);
});

test("a record goes up to its type's list, a list goes up to the place", () => {
  assert.equal(upHash("subject=record:rec_1&type=Matter"), "type=Matter");
  assert.equal(upHash("type=Matter"), "");
  assert.equal(upHash(FILE), "");
  assert.equal(upHash(undefined), null);
  assert.equal(upHash(""), null);
});

test("an item opened from another tab goes back to that tab and the item's tab goes; reopening brings it back", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.openPlace("chats", "subject=thread:thr_1", "Renewal");
  c.openPlace("files", FILE, "Quote.pdf");
  assert.equal(c.state().active, `files:subject=file:fil_1`);
  assert.equal(c.state().tabs.find((t) => t.key === c.state().active)?.from, "chats:subject=thread:thr_1");
  assert.equal(c.back(), true);
  assert.equal(c.state().active, "chats:subject=thread:thr_1");
  assert.ok(!c.state().tabs.some((t) => t.place === "files"));
  assert.equal(c.canReopen(), true);
});

test("Back skips a step another tab already shows", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "A");
  s = moveTab(s, "chats", "subject=thread:thr_2", "B");
  s = moveTab(s, "chats", AGENT, "Agent");
  // the person opens thread 2 in its own tab elsewhere: it is not ours to step back into
  s = { tabs: [...s.tabs, placeTab("chats", "subject=thread:thr_2", "B")], active: s.active };
  const back = goBack(s).state;
  assert.equal(active(back).hash, "subject=thread:thr_1");
});

test("the history is kept when tabs are saved and read, and is capped", () => {
  let s = start();
  for (let i = 0; i < HISTORY_MAX + 10; i++) s = moveTab(s, "chats", `subject=thread:t${i}`, `T${i}`);
  assert.equal((active(s).back ?? []).length, HISTORY_MAX);
  const read = readTabs(writeTabs(s))!;
  assert.deepEqual(active(read).back, active(s).back);
  assert.equal(backTarget(read)?.kind, "step");
});

test("a pinned tab opened from another stays when Back returns to the opener", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.openPlace("files", FILE, "Quote.pdf");
  c.pin(c.state().active, true);
  assert.equal(c.back(), true);
  assert.ok(
    c.state().tabs.some((t) => t.place === "files"),
    "a pinned tab is never closed by Back",
  );
});
