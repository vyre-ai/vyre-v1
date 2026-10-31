// The agent task kind of the AI step (work baton, item 7): a task assigned to the step's agent, carrying the brief, woken with its tools, waited on until it is Done, and read back as the step's output.
// The answer kind keeps its fast path: it never makes a task and never waits for one.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { runStep } from "../handlers/control.ts";
import { aiStep } from "../handlers/ai-step.ts";
import type { StepCall, StepNode } from "../handlers/control.ts";

type H = ReturnType<typeof harness>;
const run = (h: H, node: StepNode, c: StepCall) => runStep({ ...h.env, ai: (n, i, cl) => aiStep(h.env, n, i, cl) }, node, c);
const call = (over: Partial<StepCall> = {}): StepCall => ({ attempt: 1, key: "run_t1:work:1", outputs: { find: { rows: [{ id: "rec_c1", fields: { name: "Dana Ortiz" } }] } }, resumed: false, trigger: { name: "Dana" }, ...over } as StepCall);
const work = (input: Record<string, unknown>, ai?: Record<string, unknown>): StepNode => ({ id: "work", key: "ai", input, ai: { mode: "task", agentId: "agt_doer", ...(ai ?? {}) } });
const task = { id: "tsk_w1", state: "todo", workingNotes: {} as Record<string, string> };
function world(): H {
  const h = harness({
    "tasks.create": () => ({ task: { id: task.id, threadId: "thr_w1" } }),
    "tasks.get": () => ({ task: { ...task, workingNotes: { ...task.workingNotes } } }),
    "threads.set_mode": () => ({}),
    "chat.post": () => ({ message: {} }),
    "access.principals.list": () => ({ principals: [{ id: "usr_maya", name: "Maya" }, { id: "agt_check", name: "Checker" }] }),
    "engine.step_turn": () => { throw new Error("a task is not a quick answer"); },
  });
  task.state = "todo"; task.workingNotes = {};
  return h;
}
const calls = (h: H, cap: string) => h.log.filter((c) => c.cap === cap);

test("the step makes a work task for its agent, with the brief as its first notes, and waits on it", async () => {
  const h = world();
  const schema = { type: "object", required: ["letter"], properties: { letter: { type: "string" } } };
  const r = await run(h, work({ prompt: "Draft the engagement letter for {{ trigger.name }}.\nKeep it to one page.", outputSchema: schema, inputs: { fee: 1500 } }, { reviewer: { kind: "agent", id: "agt_check" }, approver: { kind: "person", id: "usr_maya" }, doneMeans: ["Names the client"], nudgeMinutes: 10, escalateTo: { kind: "person", id: "usr_boss" }, timeoutMinutes: 20 }), call());
  assert.deepEqual([r.wait?.reason, r.wait?.taskId, r.wait?.cancelOn], ["approval", "tsk_w1", ["task.withdrawn"]]);
  const made = calls(h, "tasks.create")[0]!.input;
  assert.equal(made.kind, "work");
  assert.equal(made.title, "Draft the engagement letter for Dana.");
  assert.deepEqual(made.assigned, { kind: "agent", id: "agt_doer" });
  assert.deepEqual(made.reviewer, { kind: "agent", id: "agt_check" });
  assert.deepEqual(made.approver, { kind: "person", id: "usr_maya" });
  assert.deepEqual(made.source, { kind: "run", id: "run_t1" });
  assert.equal(made.idempotencyKey, "run_t1:work:1:task");
  assert.equal(typeof made.due, "number");
  const notes = made.notes as Record<string, string>;
  assert.match(notes.brief!, /^## Goal\nDraft the engagement letter for Dana\./);
  assert.match(notes.brief!, /Checker reviews your work against Done means\./);
  assert.match(notes.brief!, /Maya approves it/);
  assert.match(notes.brief!, /## Finish\nEnd your turn with exactly one baton call/);
  assert.deepEqual(JSON.parse(notes.done_means!), ["Names the client"]);
  assert.deepEqual(JSON.parse(notes.output_schema!), schema);
  assert.equal(notes["baton.nudge_minutes"], "10");
  assert.deepEqual(JSON.parse(notes["baton.escalate_to"]!), { kind: "person", id: "usr_boss" });
  assert.equal(calls(h, "engine.step_turn").length, 0, "no quick answer is asked for");
  assert.equal(calls(h, "threads.set_mode")[0]!.input.mode, "auto");
  assert.equal(calls(h, "chat.post")[0]!.input.threadId, "thr_w1");
  assert.equal(calls(h, "chat.post")[0]!.input.body, notes.brief, "the brief is the first thing in the task's thread");
});

test("the assigned seat of the step wins over the agent, and a step with neither is refused", async () => {
  const h = world();
  await run(h, work({ prompt: "Do it." }, { assigned: { kind: "group", id: "grp_desk" } }), call());
  assert.deepEqual(calls(h, "tasks.create")[0]!.input.assigned, { kind: "group", id: "grp_desk" });
  const bare = world();
  await assert.rejects(run(bare, { id: "work", key: "ai", input: { prompt: "Do it." }, ai: { mode: "task" } }, call()), (e) => /needs someone to do it/.test(JSON.stringify(e)));
});

test("when the task is Done the step returns what the doer submitted, and the same key finds the same task", async () => {
  const h = world();
  const node = work({ prompt: "Draft it.", outputSchema: { type: "object" } });
  await run(h, node, call());
  assert.equal((await run(h, node, call({ resumed: true }))).wait?.taskId, "tsk_w1", "still open: wait again");
  task.state = "done";
  task.workingNotes = { outputs: JSON.stringify({ letter: "Dear Ms Ortiz" }), summary: "Drafted and checked the fee" };
  const r = await run(h, node, call({ resumed: true }));
  assert.deepEqual(r.output, { text: "Drafted and checked the fee", data: { letter: "Dear Ms Ortiz" }, keyUsed: "", modelUsed: "", taskId: "tsk_w1" });
  assert.equal(new Set(calls(h, "tasks.create").map((c) => c.input.idempotencyKey)).size, 1);
  assert.equal(calls(h, "chat.post").length, 1, "the brief is posted once, not again when the step resumes");
});

test("a task that was canceled fails the step by name", async () => {
  const h = world();
  const node = work({ prompt: "Draft it." });
  await run(h, node, call());
  task.state = "canceled";
  await assert.rejects(run(h, { ...node, title: "Draft" } as StepNode, call({ resumed: true })), (e) => /was canceled before it was finished/.test(JSON.stringify(e)));
});

test("a task whose doer handed in nothing gives no data", async () => {
  const h = world();
  const node = work({ prompt: "Do it." });
  await run(h, node, call());
  task.state = "done"; task.workingNotes = { outputs: "{}", summary: "Nothing to add" };
  assert.deepEqual((await run(h, node, call({ resumed: true }))).output, { text: "Nothing to add", keyUsed: "", modelUsed: "", taskId: "tsk_w1" });
});

test("a step without a mode is still a quick answer: one engine call, no task, no wait", async () => {
  const h = harness({ "engine.step_turn": () => ({ text: "Hello.", keyUsed: "#K", modelUsed: "m" }) });
  const r = await run(h, { id: "ask", key: "ai", input: { prompt: "Say hello." }, ai: { agentId: "agt_doer" } }, call());
  assert.deepEqual(r.output, { text: "Hello.", keyUsed: "#K", modelUsed: "m" });
  assert.deepEqual(h.log.map((c) => c.cap), ["engine.step_turn"]);
});
