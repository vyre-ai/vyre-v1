// The goal page and the goal card over the sample Space's goals: what each state says, the one-tap answers and controls call the right capability, and a draft card starts the goal.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { ConversationData } from "../conversation/data.tsx";
import { Activity, GoalPage } from "./GoalPage.tsx";
import { GoalCard } from "./GoalCard.tsx";
import { goalsCall } from "./sample.ts";
import type { SampleState } from "./sample.ts";

const NOW = Date.UTC(2026, 10, 3, 5, 0);
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", agt_labdesk: "Lab Desk", agt_content: "Content", usr_aliza: "Aliza Khan" };

async function page(state: SampleState, pane = false): Promise<{ root: ReturnType<typeof find>; calls: Array<{ cap: string; input: Record<string, unknown> }>; opened: string[] }> {
  installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const call = goalsCall(async (cap) => { throw new Error(`no write for ${cap}`); }, NOW, state);
  const logged = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input: input as Record<string, unknown> }); return cap.startsWith("goals.") && cap !== "goals.get" && cap !== "goals.list" ? {} : call(cap, input); };
  const root = await mount(createRoot as never, (
    <GoalPage goalId="gol_lab8" call={logged} changes={undefined} me="usr_irfad" nameOf={(id) => NAMES[id] ?? id} clock={() => ({ now: NOW, offsetMin: 300 })}
      conversationFor={() => ({}) as ConversationData} openTask={(id) => opened.push(`task:${id}`)} openAgent={(id) => opened.push(`agent:${id}`)} pane={pane} />
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

test("the Activity pane names who did it as the reader sees it: a Space agent by name, the time once in the reader's zone", async () => {
  installDom();
  const call = goalsCall(async (cap) => { throw new Error(`no write for ${cap}`); }, NOW, "active");
  const data = (await call("goals.get", { goalId: "gol_lab8" })) as unknown as import("./model.ts").GoalPageData;
  const root = await mount(createRoot as never, <Activity data={data} me="usr_irfad" nameOf={(id) => NAMES[id] ?? id} now={NOW} offsetMin={300} openTask={() => undefined} />);
  await flush();
  const text = textOf(find(root!, "goal-activity"));
  assert.match(text, /Lab Desk drafted this goal for you\./);
  assert.match(text, /Lab Desk/);
  assert.doesNotMatch(text, /Irfad Imtiaz \(Agent\)|Made by|an agent|the owner|usr_|agt_|\{at:|\{who:/);
  assert.match(text, /Started\. Due \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2}\./);
});

test("a draft card says what to do in plain words", async () => {
  const { root } = await page("draft");
  const text = textOf(find(root!, "goal-draft"));
  assert.match(text, /Nothing starts until you press Start goal\./);
  assert.doesNotMatch(text, /permission holds/);
});
