// A Journey task "done by an Automation": entering the stage starts that Automation, its Run succeeding does the task, a failing Run leaves it for a person,
// and a finished task advances the record when it was the last required one.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, newJourney, stage, task } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";

const stages = [
  stage("intake", 0, { tasks: [task("sort_mail", { doneByAutomation: "aut_sorter1" }), task("call", { required: false })] }),
  stage("done", 1, { exit: { requireTasks: false }, final: true }),
];

const FIRE = { "automations.fire": (i: { payload: { taskKey?: string } }) => ({ runId: `run_${i.payload.taskKey ?? "stage"}` }) };

async function started(h: Harness): Promise<{ recordId: string; runId: string; sortTask: string }> {
  const j = (await h.call("journeys.create", newJourney({ stages }), alice)).journey;
  const recordId = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1" }, alice)).recordId as string;
  const fired = h.only("automations.fire").find((c) => c.input.automationId === "aut_sorter1")!;
  const sortTask = h.tasks.find((t) => t.input.title === "Do sort_mail")!.id;
  assert.equal(fired.input.payload.taskKey, "sort_mail");
  assert.equal(fired.input.payload.taskId, sortTask);
  return { recordId, runId: "run_sort_mail", sortTask };
}

test("entering the stage starts the Automation of a task, and its Run succeeding marks the task done", async () => {
  const h = harness({ calls: FIRE as never });
  const done: string[] = [];
  h.callee("tasks.transition", (i) => { done.push(`${i.taskId}:${i.to}`); h.complete(i.taskId); return { task: {} }; });
  const { runId, sortTask } = await started(h);
  const out = await consumers["journeys.task_done_by_run"].run(h.ctxFor(null, alice), { payload: { runId } });
  assert.deepEqual(out, [sortTask]);
  assert.deepEqual(done, [`${sortTask}:done`]);
});

test("a Run that is not a task's Automation changes nothing", async () => {
  const h = harness({ calls: FIRE as never });
  h.callee("tasks.transition", () => assert.fail("no task should move"));
  await started(h);
  assert.deepEqual(await consumers["journeys.task_done_by_run"].run(h.ctxFor(null, alice), { payload: { runId: "run_other" } }), []);
});

test("a task that cannot start its Automation stays open for a person", async () => {
  const h = harness({ calls: { "automations.fire": () => { throw new Error("no such trigger"); } } });
  const j = (await h.call("journeys.create", newJourney({ stages }), alice)).journey;
  await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1" }, alice);
  assert.ok(h.tasks.some((t) => t.input.title === "Do sort_mail" && t.state === "todo"));
});

test("a finished Journey task asks the record to advance, and a task from elsewhere does not", async () => {
  const h = harness({ calls: FIRE as never });
  const asked: string[] = [];
  h.callee("journeys.advance", (i) => { asked.push(i.recordId); return { advanced: true }; });
  const { recordId, sortTask } = await started(h);
  assert.deepEqual(await consumers["journeys.advance_on_task"].run(h.ctxFor(null, alice), { payload: { taskId: sortTask, source: { kind: "journey", id: recordId } } }), [recordId]);
  assert.deepEqual(await consumers["journeys.advance_on_task"].run(h.ctxFor(null, alice), { payload: { taskId: "tsk_x", source: { kind: "chat", id: "thr_1" } } }), []);
  assert.deepEqual(asked, [recordId]);
});
