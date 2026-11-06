// The goal's right-click menu (lane l-chrome2a): the facts a goal and the asker give the menu, and on the goal page right-click opens it, with Pause or Resume by state, Mark Stuck and Report Progress asking for words, Stop last.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { GoalPage } from "./GoalPage.tsx";
import { askedCall, goalMenuEntries, menuStatus } from "./goal-menu.ts";
import { goalsCall } from "./sample.ts";
import { act } from "react";
const fireUp = async (root: unknown, id: string, prop: string, event: unknown): Promise<void> => { const n = find(root as never, id) as { props: Record<string, (e: unknown) => void> } | null; assert.ok(n && typeof n.props[prop] === "function", `${id} has ${prop}`); await act(async () => { n!.props[prop]!(event); }); await flush(); };
import type { MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const NOW = Date.UTC(2026, 10, 3, 5, 0);
const labels = (e: ReturnType<typeof goalMenuEntries>): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? `# ${x.head}` : x.label));

test("menuStatus maps the goal's states to the menu's; only the owner manages", () => {
  assert.deepEqual((["active", "waiting", "planning", "stuck", "paused", "done", "missed", "stopped", "draft"] as const).map(menuStatus), ["running", "running", "running", "stuck", "paused", "done", "stopped", "stopped", "done"]);
  const d = { run: async () => true, ask: () => undefined };
  assert.deepEqual(labels(goalMenuEntries({ id: "gol_1", title: "T", status: "active", owner: "usr_me" }, "usr_me", d)).filter((x) => x !== "-"), ["Pause", "Mark Stuck…", "Report Progress…", "Copy link", "Stop Goal…"]);
  assert.deepEqual(labels(goalMenuEntries({ id: "gol_1", title: "T", status: "active", owner: "usr_other" }, "usr_me", d)).filter((x) => x !== "-"), ["Copy link"], "someone else's goal: no changing items; Open is left out without a page to open");
});

test("a typed answer becomes the capability call: stuck with its reason and two ways on, or a report", () => {
  assert.deepEqual(askedCall("stuck", "County portal is down").cap, "goals.mark_stuck");
  assert.deepEqual(askedCall("stuck", "County portal is down").input, { reason: "County portal is down", options: ["Keep going", "Stop the goal"] });
  assert.equal(askedCall("report", "On pace, 212 of 300").cap, "goals.report");
  assert.deepEqual(askedCall("report", "On pace").input, { summary: "On pace" });
});

test("right-click on the goal page: Pause calls goals.pause, Mark Stuck asks why first, Stop Goal is last", async () => {
  installDom();
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const base = goalsCall(async (cap) => { throw new Error(`no write for ${cap}`); }, NOW, "active");
  const logged = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input: input as Record<string, unknown> }); return cap.startsWith("goals.") && cap !== "goals.get" && cap !== "goals.list" ? {} : base(cap, input); };
  const root = await mount(createRoot as never, <GoalPage goalId="gol_lab8" call={logged} changes={undefined} me="usr_irfad" nameOf={(id) => id} clock={() => ({ now: NOW, offsetMin: 300 })} conversationFor={() => ({}) as ConversationData} openTask={() => undefined} openAgent={() => undefined} pane={false} />);
  await flush(); await flush();
  await fireUp(root as never, "goal-page-head", "onContextMenu", { preventDefault() {}, clientX: 5, clientY: 5, nativeEvent: {} });
  const items: string[] = []; const walk = (n: unknown): void => { const x = n as { props?: Record<string, unknown>; children?: unknown[] }; const t = x.props?.["data-testid"] ?? x.props?.["testID"]; if (typeof t === "string" && t.startsWith("menu-item-")) items.push(t.slice(10)); (x.children ?? []).forEach((c) => typeof c === "object" && walk(c)); }; walk(root);
  const names = items.filter((x) => x !== "report");
  assert.ok(names.includes("Pause") && names.includes("Mark Stuck…") && names.includes("Report Progress…"), names.join("|"));
  assert.equal(names.at(-1), "Stop Goal…");
  await press(find(root as never, "menu-item-Pause") as never); await flush();
  assert.ok(calls.some((c) => c.cap === "goals.pause" && c.input["goalId"] === "gol_lab8"));
  await fireUp(root as never, "goal-page-head", "onContextMenu", { preventDefault() {}, clientX: 5, clientY: 5, nativeEvent: {} });
  await press(find(root as never, "menu-item-Mark Stuck…") as never); await flush();
  assert.equal(calls.some((c) => c.cap === "goals.mark_stuck"), false, "it asks why first");
  await typeInto(find(root as never, "text-ask-field") as never, "County portal is down");
  await press(find(root as never, "text-ask-go") as never); await flush();
  const stuck = calls.find((c) => c.cap === "goals.mark_stuck")!;
  assert.deepEqual(stuck.input, { goalId: "gol_lab8", reason: "County portal is down", options: ["Keep going", "Stop the goal"] });
  void (undefined as unknown as MenuItem);
});
