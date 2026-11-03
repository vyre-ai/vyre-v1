// The goal page and the goal card over the sample Space's goals: what each state says, the one-tap answers and controls call the right capability, and a draft card starts the goal.
import test from "node:test";
import { act } from "react";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { GoalPage } from "./GoalPage.tsx";
import { GoalCard } from "./GoalCard.tsx";
import { goalsCall } from "./sample.ts";
import type { SampleState } from "./sample.ts";

const NOW = Date.UTC(2026, 10, 3, 5, 0);
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", agt_labdesk: "Lab Desk", agt_content: "Content", usr_aliza: "Aliza Khan" };

async function page(state: SampleState): Promise<{ root: ReturnType<typeof find>; calls: Array<{ cap: string; input: Record<string, unknown> }>; opened: string[] }> {
  installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const call = goalsCall(async (cap) => { throw new Error(`no write for ${cap}`); }, NOW, state);
  const logged = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input: input as Record<string, unknown> }); return cap.startsWith("goals.") && cap !== "goals.get" && cap !== "goals.list" ? {} : call(cap, input); };
  const root = await mount(createRoot as never, (
    <GoalPage goalId="gol_lab8" call={logged} changes={undefined} me="usr_irfad" nameOf={(id) => NAMES[id] ?? id} clock={() => ({ now: NOW, offsetMin: 300 })}
      conversationFor={() => ({}) as ConversationData} openTask={(id) => opened.push(`task:${id}`)} openAgent={(id) => opened.push(`agent:${id}`)} pane={false} />
  ));
  await flush(); await flush();
  return { root, calls, opened };
}

test("an active goal: the number Vyre read, its source, what waits on you with one-tap answers, the plan", async () => {
  const { root, calls, opened } = await page("active");
  const p = find(root!, "goal-page")!;
  assert.match(textOf(find(p, "goal-number")), /212/);
  assert.match(textOf(find(p, "goal-source")), /Luma, Lab 8 event, read/);
  assert.match(textOf(find(p, "goal-status")), /Waiting on you/);
  assert.match(textOf(find(p, "goal-waiting")), /Approve: email to 1,240 Lab 7 attendees/);
  await press(find(p, "goal-wait-tsk_hold-approve"));
  assert.deepEqual(calls.find((c) => c.cap === "tasks.act")?.input, { taskId: "tsk_hold", action: "approve" });
  await press(find(p, "goal-wait-tsk_ask-0"));
  assert.deepEqual(calls.filter((c) => c.cap === "tasks.act").at(-1)?.input, { taskId: "tsk_ask", action: "answer", answer: "Yes, them too" });
  assert.match(textOf(find(p, "goal-plan")), /Plan · 3 of 5 done/);
  await press(find(p, "goal-pause"));
  assert.ok(calls.some((c) => c.cap === "goals.pause" && c.input["goalId"] === "gol_lab8"));
  assert.deepEqual(opened, []);
});

test("stuck, paused at the budget, missed and done each say what happened and offer what to do", async () => {
  const stuck = await page("stuck");
  assert.match(textOf(find(stuck.root!, "goal-stuck")), /No new registrations in 3 check-ins/);
  await press(find(stuck.root!, "goal-stuck-stop"));
  assert.ok(stuck.calls.some((c) => c.cap === "goals.stop"));
  const paused = await page("paused");
  assert.match(textOf(find(paused.root!, "goal-budget-full")), /\$25 of \$25|151 of 200 turns/);
  await press(find(paused.root!, "goal-raise"));
  assert.deepEqual(paused.calls.find((c) => c.cap === "goals.update")?.input["budget"], { spendMicros: 37_500_000, turns: 300 });
  const missed = await page("missed");
  assert.match(textOf(find(missed.root!, "goal-ended-missed")), /Got to 268 of 300 registrations \(84%\).*The reminder waited on approval from Mon to Thu/s);
  const done = await page("done");
  assert.match(textOf(find(done.root!, "goal-ended-done")), /Reminder to Lab 7 attendees: \+41 in a day/);
  const budget = await page("budget");
  assert.match(textOf(find(budget.root!, "goal-budget-warn")), /80% of the budget is used: \$20\.50 of \$25 · 164 of 200 turns/);
});

test("a draft card starts the goal with one press, and a check-in card shows the change", async () => {
  installDom();
  const calls: string[] = [];
  let status = "draft";
  const call = async (cap: string): Promise<unknown> => { calls.push(cap); if (cap === "goals.confirm") status = "planning"; return { goal: { status, deadline: NOW + 86_400_000, progress: { tasksDone: 0, tasks: 0 } } }; };
  const block = { goalId: "gol_lab8", threadId: "thr_c", kind: "draft" as const, title: "300 registrations for Lab 8", line: "Luma registrations reach 300", status: "draft" as const, target: 300, deadline: NOW + 86_400_000, plan: ["Remind Lab 7 (31% after one reminder)"], permissions: ["Send email from the Lab template"] };
  const root = await mount(createRoot as never, <GoalCard block={block} call={call} changes={undefined} me="usr_irfad" />);
  await flush();
  assert.match(textOf(root), /First plan.*Remind Lab 7/s);
  await press(find(root!, "goal-card-start"));
  await flush();
  assert.ok(calls.includes("goals.confirm"));
  assert.match(textOf(find(root!, "goal-card-said")), /Started/);
  const update = await mount(createRoot as never, <GoalCard block={{ ...block, kind: "update", status: "active", value: 212, prev: 194, summary: "Behind pace by 30." }} call={call} changes={undefined} />);
  await flush();
  assert.match(textOf(update), /212.*\/ 300 registrations|212/s);
  assert.match(textOf(update), /\+18/);
});

const fire = async (n: ReturnType<typeof find>, prop: string, ...args: unknown[]): Promise<void> => { await act(async () => { await (n!.props[prop] as (...a: unknown[]) => unknown)(...args); }); await flush(); };

test("a draft can be edited where it stands: title, finish line, helpers and the drafted plan each save through goals.update, with Undo", async () => {
  const { root, calls } = await page("draft");
  const p = find(root!, "goal-page")!;
  assert.match(textOf(find(p, "goal-plan")), /Remind Lab 7 attendees.*Past attendees registered at 31%.*Two short reels/s, "the drafted plan shows, not the lead agent's promise to plan");
  assert.doesNotMatch(textOf(find(p, "goal-finish")), / by /, "the deadline is said once, in its own place");
  assert.match(textOf(find(p, "goal-helpers")), /Helpers.*Content.*Aliza Khan/s);
  // the title: press it, type, leave the field
  await press(find(p, "goal-title-edit"));
  await typeInto(find(p, "goal-title-field"), "320 registrations for Lab 8");
  await fire(find(p, "goal-title-field"), "onBlur", { nativeEvent: { target: { value: "x" } }, target: { value: "x" }, currentTarget: null });
  const rename = calls.find((c) => c.cap === "goals.update" && c.input["title"]);
  assert.deepEqual(rename?.input, { goalId: "gol_lab8", title: "320 registrations for Lab 8" });
  assert.match(textOf(find(p, "goal-line")), /Renamed/);
  await press(find(p, "goal-undo"));
  assert.deepEqual(calls.filter((c) => c.cap === "goals.update").at(-1)?.input, { goalId: "gol_lab8", title: "300 registrations for Lab 8" });
  // a helper comes off with one press
  await press(find(p, "goal-helper-remove-usr_aliza"));
  assert.deepEqual(calls.filter((c) => c.cap === "goals.update").at(-1)?.input["helpers"], [{ kind: "agent", id: "agt_content" }]);
  // a step comes off the drafted plan, and a new one goes on the end
  await press(find(p, "goal-step-remove-rem"));
  const plan = calls.filter((c) => c.cap === "goals.update").at(-1)?.input["plan"] as Array<{ key: string }>;
  assert.deepEqual(plan.map((s) => s.key), ["reels"]);
  await typeInto(find(p, "goal-step-new-field"), "Ask Andrey for a quote");
  await press(find(p, "goal-step-new-add"));
  const added = calls.filter((c) => c.cap === "goals.update").at(-1)?.input["plan"] as Array<{ title: string; why: string }>;
  assert.equal(added.at(-1)?.title, "Ask Andrey for a quote");
  assert.equal(added.length, 3);
});

test("someone who does not own the goal sees it read-only", async () => {
  installDom();
  const call = goalsCall(async () => ({}), NOW, "draft");
  const root = await mount(createRoot as never, (
    <GoalPage goalId="gol_lab8" call={call} changes={undefined} me="usr_aliza" nameOf={(id) => NAMES[id] ?? id} clock={() => ({ now: NOW, offsetMin: 300 })}
      conversationFor={() => ({}) as ConversationData} openTask={() => undefined} openAgent={() => undefined} pane={false} />
  ));
  await flush(); await flush();
  const p = find(root!, "goal-page")!;
  assert.equal(find(p, "goal-title-edit"), null);
  assert.equal(find(p, "goal-add-helper"), null);
  assert.equal(find(p, "goal-step-new-field"), null);
});

test("the Details pane: every setting edits in place and saves through goals.update; nothing repeats the page", async () => {
  installDom();
  const { sampleGoals } = await import("./sample.ts");
  const { GoalSettings } = await import("./GoalSettings.tsx");
  const g = sampleGoals(NOW, "active").page.goal;
  const saved: Array<Record<string, unknown>> = [];
  const root = await mount(createRoot as never, <GoalSettings g={g} nameOf={(id) => NAMES[id] ?? id} offsetMin={300} canEdit patch={(i) => saved.push(i)} pick={() => undefined} removeHelper={() => undefined} />);
  await flush();
  const d = find(root!, "goal-details")!;
  assert.doesNotMatch(textOf(d), /Finish line/);
  assert.match(textOf(d), /Pauses and asks you at 100%/);
  await press(find(d, "goal-set-budget-change"));
  await typeInto(find(d, "goal-budget-cap"), "40");
  await press(find(d, "goal-budget-save"));
  assert.deepEqual(saved.at(-1)?.["budget"], { spendMicros: 40_000_000, turns: 200 });
  await press(find(d, "goal-perm-remove-mail.send"));
  assert.deepEqual((saved.at(-1)?.["permissions"] as Array<{ target: string }>).map((p) => p.target), ["skool"]);
  await press(find(d, "goal-set-checkins-change"));
  await press(find(d, "goal-quiet-toggle"));
  await press(find(d, "goal-rhythm-save"));
  assert.equal(saved.at(-1)?.["quiet"], null, "quiet hours switched off");
});

test("a running goal's step renames where it stands", async () => {
  const { root, calls } = await page("active");
  const p = find(root!, "goal-page")!;
  await press(find(p, "goal-task-rename-tsk_ads"));
  await typeInto(find(p, "goal-task-name-tsk_ads"), "Retarget the Lab 8 form, week two");
  await fire(find(p, "goal-task-name-tsk_ads"), "onBlur", { nativeEvent: { target: { value: "x" } }, target: { value: "x" }, currentTarget: null });
  assert.deepEqual(calls.find((c) => c.cap === "tasks.update")?.input, { taskId: "tsk_ads", title: "Retarget the Lab 8 form, week two" });
});
