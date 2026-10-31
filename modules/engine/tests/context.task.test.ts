// The "Your task" section of the turn context (work baton): in a task thread the agent is told its seat, the brief, what counts as done, what was handed in, the fixes it must make, the answers it
// waited for and the one baton call to finish with; the focus skill is the task skill; a task thread's task is read as the asker, or as the server when the asker cannot see it.
import test from "node:test";
import assert from "node:assert/strict";
import { createContextBuilder, taskSection } from "../context.ts";
import type { SkillsPort } from "../context.ts";
import type { StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";

const names = { usr_olivia: "Olivia", agt_doer: "Drafter", agt_check: "Checker", usr_boss: "Boss" };
const task = (over: Record<string, unknown> = {}) => ({
  id: "tsk_t1", kind: "work", title: "Draft the engagement letter", state: "todo", assigned: { kind: "agent", id: "agt_doer" }, reviewer: { kind: "agent", id: "agt_check" }, approver: { kind: "person", id: "usr_boss" },
  reviewLoops: 0, workingNotes: { brief: "Goal\nWrite the letter.", done_means: JSON.stringify(["Names the client", "States the fee"]) }, ...over,
});

test("the doer is told its seat, the brief, what done means, and to finish with submit, ask or block", () => {
  const s = taskSection(task(), "agt_doer", names);
  assert.match(s, /^Draft the engagement letter \(taskId tsk_t1, todo\)\./);
  assert.match(s, /You are the one who does the work \(Assigned\), and it is your turn\./);
  assert.match(s, /task_submit \{taskId, outputs, summary\}[^\n]*task_ask[^\n]*task_block/);
  assert.match(s, /Brief:\nGoal\nWrite the letter\./);
  assert.match(s, /Done means:\n- Names the client\n- States the fee/);
  assert.match(s, /Next after the doer: Checker reviews, then Boss approves\./);
  assert.doesNotMatch(s, /task_review|task_decide/, "only the tools of its own seat");
  assert.doesNotMatch(s, /—/, "no em dash");
});

test("after a send back the doer sees the fixes as a numbered list, and the answers it waited for", () => {
  const s = taskSection(task({ state: "doing", reviewLoops: 1, workingNotes: { brief: "B", fixes: JSON.stringify(["Use her full name", "Cut paragraph two"]) } }), "agt_doer", names, [{ question: "Which date?", answer: "5 May" }]);
  assert.match(s, /Fixes asked for, do every one:\n1\. Use her full name\n2\. Cut paragraph two/);
  assert.match(s, /sent back 1 time\./);
  assert.match(s, /Answers to your questions:\n- Which date\? -> 5 May/);
});

test("the reviewer sees what was handed in and finishes with task_review; the approver with task_decide", () => {
  const notes = { brief: "B", summary: "Drafted and checked the dates", outputs: JSON.stringify({ letter: "Dear Ms Rivera" }) };
  const r = taskSection(task({ state: "in_review", workingNotes: notes }), "agt_check", names);
  assert.match(r, /You are the Reviewer, and it is your turn\./);
  assert.match(r, /task_review \{taskId, verdict: approve \| send_back, fixes/);
  assert.match(r, /Handed in by Drafter: Drafted and checked the dates\nOutputs: \{"letter":"Dear Ms Rivera"\}/);
  assert.doesNotMatch(r, /task_submit/);
  const a = taskSection(task({ state: "awaiting_approval", approver: { kind: "agent", id: "agt_boss" }, workingNotes: notes }), "agt_boss", names);
  assert.match(a, /You are the Approver, and it is your turn\./);
  assert.match(a, /task_decide \{taskId, verdict: approve \| reject, reason\}/);
});

test("out of turn, or not a seat, or offered to a group: the agent is told what to do instead", () => {
  assert.match(taskSection(task({ state: "in_review" }), "agt_doer", names), /It is not your move: say so in one line and end your turn\./);
  assert.match(taskSection(task(), "agt_other", names), /You are not a seat on this task/);
  const g = taskSection(task({ assigned: { kind: "group", id: "grp_desk" } }), "agt_doer", names);
  assert.match(g, /offered to a group you belong to\. Take it first with tasks_take \{taskId\}/);
});

// ---- through the builder ----

const msg = (id: string, who: string): StoredMessage => ({ id, threadId: "thr_task", threadSeq: 1, author: { kind: "person", id: who }, mentions: [], depth: 0, body: "" } as StoredMessage);
const input = (over: Partial<TurnInput> = {}): TurnInput => ({ threadId: "thr_task", turnId: "trn_1", agent: { id: "agt_doer", mode: "listen" }, history: [], listeners: [], asker: "usr_olivia", ...over, trigger: over.trigger ?? msg("m1", "usr_olivia") });
const skills: SkillsPort = {
  async index() { return [{ name: "working-in-vyre", description: "How an agent works inside Vyre.", tier: "builtin" }, { name: "working-on-tasks", description: "Work a task.", tier: "builtin" }, { name: "focus-records", description: "Records.", tier: "builtin" }]; },
  async load(name) { return { name, body: `body of ${name}` }; },
};
function fake(answers: Record<string, unknown>, seen: Array<{ cap: string; as?: string | undefined }> = []) {
  return async (cap: string, i: unknown, as?: string): Promise<unknown> => {
    seen.push({ cap, as });
    const a = answers[cap];
    if (a === undefined) throw new Error(`no such capability ${cap}`);
    return typeof a === "function" ? (a as (x: unknown, as?: string) => unknown)(i, as) : a;
  };
}
const THREAD = { thread: { kind: "thread", title: "Draft the engagement letter", scopeType: "task", scopeId: "tsk_t1", members: [{ kind: "person", id: "usr_olivia" }], agents: [{ agentId: "agt_doer", mode: "listen" }] } };
const BASE = { "agents.get": { agent: { agentId: "agt_doer", name: "Drafter" } }, "threads.get": THREAD, "access.principals.list": { principals: [{ id: "usr_olivia", name: "Olivia" }, { id: "agt_doer", name: "Drafter" }, { id: "agt_check", name: "Checker" }, { id: "usr_boss", name: "Boss" }] } };

test("in a task thread the context has the task section and the task skill is the focus skill", async () => {
  const ctx = await createContextBuilder({ call: fake({ ...BASE, "tasks.get": { task: task() } }), skills, now: () => 1 }).build(input());
  const ids = ctx.sections.map((s) => s.id);
  assert.ok(ids.indexOf("task") > ids.indexOf("can") && ids.indexOf("task") < ids.indexOf("now"), ids.join(","));
  assert.match(ctx.sections.find((s) => s.id === "task")!.text, /You are the one who does the work \(Assigned\), and it is your turn\./);
  assert.match(ctx.sections.find((s) => s.id === "focus")!.text, /^working-on-tasks\nbody of working-on-tasks/);
  assert.equal(ctx.sections.find((s) => s.id === "task")!.stable, false, "the task changes every turn");
});

test("a task the asker cannot see is read as the server, because the agent holding the baton must see its own task", async () => {
  const seen: Array<{ cap: string; as?: string | undefined }> = [];
  const call = fake({ ...BASE, "tasks.get": (_i: unknown, as?: string) => { if (as) throw new Error("not yours"); return { task: task() }; } }, seen);
  const ctx = await createContextBuilder({ call, skills, now: () => 1 }).build(input());
  assert.ok(ctx.sections.some((s) => s.id === "task"));
  const reads = seen.filter((c) => c.cap === "tasks.get").map((c) => c.as);
  assert.equal(reads.at(-1), undefined, "the last read is the server's, after the asker's reads were refused");
  assert.ok(reads.slice(0, -1).every((as) => as === "usr_olivia"));
});

test("answers to the questions a task asked come from the answered child tasks", async () => {
  const parent = task({ state: "doing", workingNotes: { brief: "B", asked: JSON.stringify([{ taskId: "tsk_q1", question: "Which date?" }, { taskId: "tsk_q2", question: "Still open?" }]) } });
  const call = fake({
    ...BASE,
    "tasks.get": (i: unknown) => ({ task: (i as { taskId: string }).taskId === "tsk_q1" ? { id: "tsk_q1", state: "done", workingNotes: { answer: JSON.stringify("5 May") } } : (i as { taskId: string }).taskId === "tsk_q2" ? { id: "tsk_q2", state: "todo", workingNotes: {} } : parent }),
  });
  const ctx = await createContextBuilder({ call, skills, now: () => 1 }).build(input());
  const text = ctx.sections.find((s) => s.id === "task")!.text;
  assert.match(text, /Answers to your questions:\n- Which date\? -> 5 May/);
  assert.doesNotMatch(text, /Still open/);
});

test("a chat that is not about a task has no task section and keeps its own focus", async () => {
  const chat = { ...BASE, "threads.get": { thread: { kind: "chat", title: "Hi", members: [], agents: [{ agentId: "agt_doer", mode: "lead" }] } } };
  const ctx = await createContextBuilder({ call: fake(chat), skills, now: () => 1 }).build(input());
  assert.ok(!ctx.sections.some((s) => s.id === "task"));
});
