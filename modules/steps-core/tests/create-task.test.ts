// Create a task, and wait for it (work baton, item 6): with wait the Run parks on the task and goes on when it is Done or Canceled, with what the doer handed in as the step's output.
// Without wait the step is as it was: it returns the task id at once and the Run does not wait.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, MiniRun } from "../fixtures/db.ts";
import { node } from "../fixtures/seed.ts";

function tasks(h: ReturnType<typeof harness>) {
  const task = { id: "tsk_w1", state: "todo", workingNotes: {} as Record<string, string> };
  h.callee("tasks.create", () => ({ task: { id: task.id } }));
  h.callee("tasks.get", () => ({ task: { ...task, workingNotes: { ...task.workingNotes } } }));
  return task;
}
const step = (extra: Record<string, unknown> = {}) => node("mk", "create_task", { title: "Draft the letter for {{ trigger.name }}", assigned: { kind: "agent", id: "agt_doer" }, reviewer: { kind: "person", id: "usr_maya" }, ...extra });

test("without wait the step returns the task id and the Run goes on", async () => {
  const h = harness();
  tasks(h);
  const run = await new MiniRun(h, [step(), node("after", "stop", {})], { name: "Dana" }).run();
  assert.equal(run.state, "succeeded");
  assert.deepEqual(run.outputs.mk, { taskId: "tsk_w1" });
  const made = h.only("tasks.create")[0]!.input;
  assert.equal(made.title, "Draft the letter for Dana");
  assert.ok(!("wait" in made), "wait is the step's, not the task's");
});

test("with wait the Run parks on the task, and goes on with the outputs the doer handed in", async () => {
  const h = harness();
  const t = tasks(h);
  const run = await new MiniRun(h, [step({ wait: true }), node("after", "stop", {})], { name: "Dana" }).run();
  assert.equal(run.state, "waiting");
  assert.deepEqual([run.wait!.reason, run.wait!.taskId], ["approval", "tsk_w1"]);
  assert.deepEqual(run.wait!.cancelOn, ["task.withdrawn"]);
  assert.deepEqual(h.only("tasks.create")[0]!.input.source, { kind: "run", id: "run_t1" });
  assert.ok(!("wait" in h.only("tasks.create")[0]!.input));

  await run.resume();
  assert.equal(run.state, "waiting", "resumed too early: the task is still open");

  t.state = "done";
  t.workingNotes = { outputs: JSON.stringify({ letter: "Dear Ms Rivera" }), summary: "Drafted and checked" };
  await run.resume();
  assert.deepEqual(run.outputs.mk, { taskId: "tsk_w1", state: "done", outputs: { letter: "Dear Ms Rivera" }, summary: "Drafted and checked" });
  assert.equal(run.state, "succeeded");
  assert.equal(h.only("tasks.create")[1]!.input.idempotencyKey, "run_t1:mk:1", "the resumed step finds the same task");
});

test("a task that was canceled ends the wait too, and the output says so", async () => {
  const h = harness();
  const t = tasks(h);
  const run = await new MiniRun(h, [step({ wait: true }), node("after", "stop", {})], { name: "Dana" }).run();
  t.state = "canceled";
  await run.resume();
  assert.deepEqual(run.outputs.mk, { taskId: "tsk_w1", state: "canceled" });
  assert.equal(run.state, "succeeded");
});

test("in a sandbox a waiting create task is answered with its sample and waits for nothing", async () => {
  const h = harness();
  tasks(h);
  const run = await new MiniRun(h, [step({ wait: true }), node("after", "stop", {})], { name: "Dana" }, true).run();
  assert.equal(run.state, "succeeded");
  assert.deepEqual(h.log, []);
});
