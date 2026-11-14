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
  const back = goBack(s);
  assert.equal(active(back).hash, "subject=thread:thr_1");
  assert.equal((forwardTarget(back) as { hash?: string } | null)?.hash, AGENT);
  const again = goForward(back);
  assert.equal(active(again).hash, AGENT);
  assert.equal(forwardTarget(again), null);
});

test("Back goes all the way to the landing and then has nowhere to go", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "Renewal");
  s = moveTab(s, "chats", AGENT, "Agent");
  s = goBack(goBack(s));
  assert.equal(active(s).hash, undefined, "the place's landing");
  assert.equal(active(s).key, "chats", "the place's own tab keeps its key");
  assert.equal(backTarget(s), null);
});

test("a new step clears Forward", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "A");
  s = moveTab(s, "chats", AGENT, "Agent");
  s = goBack(s);
  s = moveTab(s, "chats", "subject=thread:thr_2", "B");
  assert.equal(forwardTarget(s), null);
  assert.equal(active(goBack(s)).hash, "subject=thread:thr_1");
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
  const up = goBack(cold);
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

test("an item opened from another tab goes back to that tab, which stays; Forward returns to the item", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.openPlace("chats", "subject=thread:thr_1", "Renewal");
  c.openPlace("files", FILE, "Quote.pdf");
  const file = "files:subject=file:fil_1";
  assert.equal(c.state().active, file);
  assert.equal(c.state().tabs.find((t) => t.key === c.state().active)?.from, "chats:subject=thread:thr_1");
  assert.equal(c.back(), true);
  assert.equal(c.state().active, "chats:subject=thread:thr_1");
  assert.ok(
    c.state().tabs.some((t) => t.key === file),
    "the item's tab is not closed by Back",
  );
  assert.equal(c.forward(), true);
  assert.equal(c.state().active, file);
});

test("an item opened from a link has no opener: Back goes up to the place's tab, and Forward returns", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.openPlace("files", FILE, "Quote.pdf", false, true);
  assert.equal(c.state().tabs.find((t) => t.place === "files")?.from, undefined);
  assert.equal(c.back(), true);
  assert.equal(c.forward(), true);
  const tab = c.state().tabs.find((t) => t.key === c.state().active)!;
  assert.equal(tab.hash, FILE, "the file is on screen again");
});

test("Back skips a step another tab already shows", () => {
  let s = moveTab(start(), "chats", "subject=thread:thr_1", "A");
  s = moveTab(s, "chats", "subject=thread:thr_2", "B");
  s = moveTab(s, "chats", AGENT, "Agent");
  // the person opens thread 2 in its own tab elsewhere: it is not ours to step back into
  s = { tabs: [...s.tabs, placeTab("chats", "subject=thread:thr_2", "B")], active: s.active };
  const back = goBack(s);
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

test("switching places is undone by Back: records, files, chats, then Back, Back, Forward, Forward (the standing e2e 6d)", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "records" });
  c.openPlace("files");
  c.openPlace("chats");
  const at = () => c.state().active;
  assert.equal(at(), "chats");
  assert.equal(c.back({ up: false }), true);
  assert.equal(at(), "files");
  assert.equal(c.back({ up: false }), true);
  assert.equal(at(), "records");
  assert.equal(c.back({ up: false }), false, "nothing of Vyre's own left: the browser may leave");
  assert.equal(c.forward(), true);
  assert.equal(at(), "files");
  assert.equal(c.forward(), true);
  assert.equal(at(), "chats");
});

test("three tabs with steps in each: Back in the middle one steps that tab only", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.move("chats", "subject=thread:a1", "A1");
  c.move("chats", "subject=thread:a2", "A2");
  c.openPlace("records", "subject=record:r1&type=Matter", "R1");
  c.move("records", "subject=record:r2&type=Matter", "R2");
  c.openPlace("files", "subject=file:f1", "F1");
  c.select("records:subject=record:r2");
  assert.equal(c.back({ up: false }), true);
  const t = c.state().tabs.find((x) => x.key === c.state().active)!;
  assert.equal(t.hash, "subject=record:r1&type=Matter", "the middle tab went back one step");
  assert.equal(
    c.state().tabs.find((x) => x.place === "chats")!.hash,
    "subject=thread:a2",
    "the other tabs did not move",
  );
  assert.equal(c.state().tabs.find((x) => x.place === "files")!.hash, "subject=file:f1");
});

test("a place's own tab is named for the screen it shows: Notes, not Chats", () => {
  let s = start();
  s = moveTab(s, "chats", "screen=chats.notes", "Notes");
  assert.equal(active(s).title, "Notes");
  s = moveTab(s, "chats", undefined);
  assert.equal(active(s).title, "Chats");
});

test("selecting a tab is undone first, then the tab's own steps (no ping-pong between two tabs)", () => {
  const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "chats" });
  c.move("chats", "subject=thread:a1", "A1");
  c.move("chats", "subject=thread:a2", "A2");
  c.openPlace("files");
  c.openPlace("chats"); // back to the chats tab by the rail: the person was at A2
  const at = () => c.state().tabs.find((t) => t.key === c.state().active)!;
  assert.equal(at().place, "chats");
  assert.equal(c.back({ up: false }), true);
  assert.equal(at().place, "files", "Back undoes the selection first");
  assert.equal(c.back({ up: false }), true);
  assert.equal(at().hash, "subject=thread:a2", "then the chats tab, where the person had been");
  assert.equal(c.back({ up: false }), true);
  assert.equal(at().hash, "subject=thread:a1", "then that tab's own step");
  assert.equal(c.forward(), true);
  assert.equal(c.forward(), true);
  assert.equal(c.forward(), true);
  assert.equal(at().place, "chats");
});
