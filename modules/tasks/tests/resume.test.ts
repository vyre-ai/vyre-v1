// A Run that waits on a task goes on when the task reaches any terminal state (work baton, item 6), whichever call got it there; tasks.act that already resumed it is not repeated.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, owner, newTask } from "../fixtures/seed.ts";
import { resumeRunOf } from "../handlers/resume.ts";
import { findTask } from "../projections.ts";

const me = { id: owner.id };
const svc = { id: "svc_host", kind: "service" as const };

function world(status = "waiting", waitReason = "approval"): Harness {
  const h = harness();
  h.callee("runs.get", () => ({ run: { id: "run_1", status, waitReason } }));
  h.callee("runs.resume", () => ({ run: {} }));
  return h;
}
const made = async (h: Harness, over: Record<string, unknown> = {}): Promise<string> => (await h.call("tasks.create", newTask({ source: { kind: "run", id: "run_1" }, ...over }), me)).task.id as string;
const resumes = (h: Harness) => h.calls.filter((c) => c.cap === "runs.resume").map((c) => c.input);
/** What the host does for a consumer: hand it the event the call emitted, with the ctx of the module. */
const deliver = async (h: Harness, name = "task.transitioned"): Promise<Array<string | undefined>> => {
  const out: Array<string | undefined> = [];
  for (const e of h.allEvents.filter((x) => x.name === name)) out.push(await resumeRunOf(h.ctxFor("tasks.transition", svc), e as never));
  return out;
};

test("a task sent to Done by tasks.transition resumes its waiting Run, once", async () => {
  const h = world();
  const id = await made(h);
  await h.call("tasks.transition", { taskId: id, to: "done" }, { id: alice.id });
  assert.deepEqual(await deliver(h), ["run_1"]);
  assert.deepEqual(resumes(h), [{ runId: "run_1", reason: "approval" }]);
  assert.deepEqual(await deliver(h), [undefined], "a second delivery of the same event leaves the Run alone");
  assert.equal(resumes(h).length, 1);
});

test("a canceled task resumes it too, for the reason the Run waits for", async () => {
  const h = world("waiting", "background");
  const id = await made(h);
  await h.call("tasks.transition", { taskId: id, to: "canceled" }, { id: alice.id });
  assert.deepEqual(await deliver(h), ["run_1"]);
  assert.deepEqual(resumes(h), [{ runId: "run_1", reason: "background" }]);
});

test("the last baton call that finishes a task resumes the Run: submit with no reviewer, review and decide", async () => {
  const h = world();
  h.callee("chat.start", () => { throw new Error("no chat"); });
  const quick = await made(h, { assigned: bot });
  await h.call("tasks.submit", { taskId: quick, summary: "Done" }, { id: bot.id, kind: "agent" });
  assert.deepEqual(await deliver(h), ["run_1"]);
  const g = world();
  const t = await made(g, { assigned: bot, approver: bob });
  await g.call("tasks.submit", { taskId: t, summary: "Drafted" }, { id: bot.id, kind: "agent" });
  assert.deepEqual(await deliver(g), [undefined], "still waiting for the approver: moving to approval is not terminal");
  await g.call("tasks.decide", { taskId: t, verdict: "approve" }, { id: bob.id });
  assert.deepEqual(await deliver(g), ["run_1"]);
});

test("a task act already resumed is not resumed again, and a Run that is not waiting is left alone", async () => {
  const h = world();
  const id = await made(h, { kind: "answer" });
  await h.call("tasks.act", { taskId: id, action: "answer", answer: "yes" }, { id: alice.id });
  assert.equal(resumes(h).length, 1, "act resumed it at once");
  assert.equal(findTask(h.db, id)!.workingNotes["run.resumed"], "1");
  assert.deepEqual(await deliver(h), [undefined]);
  assert.equal(resumes(h).length, 1);

  const idle = world("running");
  const t = await made(idle);
  await idle.call("tasks.transition", { taskId: t, to: "done" }, { id: alice.id });
  assert.deepEqual(await deliver(idle), [undefined]);
  assert.equal(resumes(idle).length, 0);
});

test("a task that did not come from a Run, or is not finished, resumes nothing", async () => {
  const h = world();
  const plain = (await h.call("tasks.create", newTask(), me)).task.id as string;
  await h.call("tasks.transition", { taskId: plain, to: "done" }, { id: alice.id });
  const open = await made(h);
  await h.call("tasks.transition", { taskId: open, to: "doing" }, { id: alice.id });
  assert.deepEqual(await deliver(h), [undefined, undefined]);
  assert.equal(resumes(h).length, 0);
});
