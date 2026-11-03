// Watching in Automations: the list is read from automations.watches.list and drawn as it came; a row's menu makes the real calls; an opened row shows what a page was and what it is.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import { everyWords, lastWords, tellWords, watchItems, watchNote } from "./read.ts";
import { WatchDetail, watchMenu } from "./WatchingView.tsx";
import { STUDIO_NAV } from "../chrome.ts";

const NOW = 1_762_000_000_000;
const raw = (over: Record<string, unknown> = {}) => ({
  watchId: "wch_a", title: "Lab 8 registrations", url: "https://lu.ma/mla-ai-lab-8", host: "lu.ma", mode: "region", region: { label: "Guest count", selector: "#going" }, everyMinutes: 30, tell: [],
  agentId: "agt_ops", runsOn: "computer", state: "on", checkNow: false, value: "3,598 going", lastCheckedAt: NOW - 5 * 60_000, changes: 4,
  lastChange: { at: NOW - 40 * 60_000, before: "3,412 going", after: "3,598 going" }, createdAt: 1, updatedAt: 2, ...over,
});
const items = (m: readonly MenuEntry[]): MenuItem[] => m.filter((e): e is MenuItem => "label" in e);

test("the list is read as it came; a reply that is not a list is rejected", () => {
  assert.equal(watchItems(null), null);
  assert.equal(watchItems({ watches: "no" }), null);
  const [w] = watchItems({ watches: [raw(), { nope: 1 }] })!;
  assert.deepEqual([w!.id, w!.region, w!.runsOn, w!.state, w!.changes, w!.lastChange?.before, w!.agentId], ["wch_a", "Guest count", "computer", "on", 4, "3,412 going", "agt_ops"]);
  assert.equal(watchItems({ watches: [raw(), { nope: 1 }] })!.length, 1);
});

test("the line under a watch says how often and when it last changed", () => {
  const [w] = watchItems({ watches: [raw()] })!;
  assert.equal(watchNote(w!, NOW), "Every 30 minutes · Changed 40 min ago");
  assert.equal(watchNote({ ...w!, lastChange: null, lastCheckedAt: NOW - 9 * 86_400_000 }, NOW), "Every 30 minutes · No change since 9 days ago");
  assert.equal(watchNote({ ...w!, state: "paused" }, NOW), "Paused");
  assert.equal(watchNote({ ...w!, state: "error", error: "timed out" }, NOW), "Can't read it: timed out");
  assert.deepEqual([everyWords(60), everyWords(1440), everyWords(2880), everyWords(360), everyWords(15)], ["Every hour", "Every day", "Every 2 days", "Every 6 hours", "Every 15 minutes"]);
});

test("the table's cells: when it last changed, and who hears of it", () => {
  const [w] = watchItems({ watches: [raw({ tell: ["usr_aliza"], tellThreads: ["thr_a", "thr_b"], goalId: "gol_1" })] })!;
  assert.equal(lastWords(w!, NOW), "Changed 40 min ago");
  assert.equal(tellWords(w!, (id) => (id === "usr_aliza" ? "Aliza" : id)), "You, Aliza, 2 channels");
  assert.equal(tellWords({ ...w!, tell: [], tellThreads: 0 }, (id) => id), "You");
  assert.equal(w!.goalId, "gol_1");
});

test("a row's menu: details, Check now (not while paused), Pause or Resume, the page, Remove", () => {
  const [w] = watchItems({ watches: [raw()] })!;
  const seen: string[] = [];
  const on = { open: () => seen.push("open"), check: () => seen.push("check"), toggle: () => seen.push("toggle"), remove: () => seen.push("remove"), page: () => seen.push("page") };
  const m = watchMenu(w!, on, false);
  assert.deepEqual(items(m).map((e) => e.label), ["Show details", "Check now", "Pause", "Open the page", "Remove"]);
  for (const e of items(m)) e.onSelect?.();
  assert.deepEqual(seen, ["open", "check", "toggle", "page", "remove"]);
  const paused = watchMenu({ ...w!, state: "paused" }, on, true);
  assert.deepEqual(items(paused).map((e) => e.label), ["Hide details", "Check now", "Resume", "Open the page", "Remove"]);
  assert.equal(items(paused)[1]!.disabled, true);
  assert.equal(items(m)[4]!.danger, true);
});

test("an opened watch shows what the page was and what it is, who checks it and where", () => {
  const [w] = watchItems({ watches: [raw()] })!;
  const html = renderToStaticMarkup(<WatchDetail w={w!} agent="Ops" />).replaceAll("<!-- -->", "");
  assert.ok(html.includes("Checks guest count on lu.ma.") && html.includes("It has changed 4 times."));
  assert.ok(html.includes("Ops checks it on their computer, signed in with the Vault."));
  assert.ok(html.includes("Before") && html.includes("3,412 going") && html.includes("Now") && html.includes("3,598 going"));
  const quiet = renderToStaticMarkup(<WatchDetail w={{ ...w!, lastChange: null, runsOn: "chrome", mode: "page", error: "timed out" }} agent="Ops" />).replaceAll("<!-- -->", "");
  assert.ok(quiet.includes("It has changed 4 times.") && quiet.includes("Checks any change on lu.ma.") && quiet.includes("Your Chrome checks it in the background") && quiet.includes("It reads: 3,598 going") && quiet.includes("timed out"));
});

test("Watching is a place view of its own, after Needs you", () => {
  const ids = STUDIO_NAV.map((n) => n.id);
  assert.equal(ids[ids.indexOf("needs") + 1], "watching");
});
