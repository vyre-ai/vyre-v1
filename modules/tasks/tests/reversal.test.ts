// A person bringing back a task an agent deleted teaches that agent: tasks.restore tells memory (memory.corrections.record, how "reverse"), as the person. A task a person deleted, or deleted
// themselves, teaches nothing; a memory that fails never holds the restore up.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, as, bot, newTask } from "../fixtures/seed.ts";

test("restoring a task an agent deleted keeps a lesson for that agent, as the person who restored it", async () => {
  const h = harness();
  h.callee("memory.corrections.record", () => ({ kept: true }));
  const made = (await h.call("tasks.create", newTask({ assigned: alice, title: "Chase the lease" }), as(bot))).task;
  await h.call("tasks.delete", { taskId: made.id }, as(bot));
  await h.call("tasks.restore", { taskId: made.id }, as(alice));
  const c = h.calls.filter((x) => x.cap === "memory.corrections.record");
  assert.equal(c.length, 1);
  const input = c[0]!.input as Record<string, unknown>;
  assert.equal(input["agentId"], "agt_bot");
  assert.equal(input["how"], "reverse");
  assert.match(String(input["was"]), /deleted the task "Chase the lease"/);
  assert.match(String(input["ref"]), /^reverse:evt_/);
});

test("a task a person deleted, and restoring one's own, teach nothing", async () => {
  const h = harness();
  h.callee("memory.corrections.record", () => ({ kept: true }));
  const made = (await h.call("tasks.create", newTask({ assigned: alice }), as(alice))).task;
  await h.call("tasks.delete", { taskId: made.id }, as(alice));
  await h.call("tasks.restore", { taskId: made.id }, as(alice));
  assert.equal(h.calls.filter((x) => x.cap === "memory.corrections.record").length, 0);
});

test("a memory that fails does not hold the restore up", async () => {
  const h = harness();
  h.callee("memory.corrections.record", () => { throw new Error("memory is down"); });
  const made = (await h.call("tasks.create", newTask({ assigned: alice }), as(bot))).task;
  await h.call("tasks.delete", { taskId: made.id }, as(bot));
  const back = await h.call("tasks.restore", { taskId: made.id }, as(alice));
  assert.equal(back.task.id, made.id);
});
