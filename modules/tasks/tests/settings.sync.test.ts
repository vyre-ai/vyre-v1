// The Space's tasks.* settings reach the tasks rules: the settings module announces a change and tasks keeps the copy it reads. Nothing else ever wrote tasks_policy.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, bot, newTask, owner } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";

const announce = (h: ReturnType<typeof harness>, key: string, after: unknown): Promise<string[]> => consumers["tasks.settings_sync"].run({ db: h.db } as never, { payload: { key, scope: "space", after } });

test("changing the review loop limit changes when an agent reviewer has to stop", async () => {
  const h = harness();
  assert.deepEqual(await announce(h, "tasks.review_loop_limit", 1), ["tasks.review_loop_limit"]);
  const id = (await h.call("tasks.create", newTask({ reviewer: bot }), { id: owner.id })).task.id as string;
  const agent = { id: bot.id, kind: "agent" as const };
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await h.call("tasks.transition", { taskId: id, to: "doing", note: "once" }, agent);
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await assert.rejects(h.call("tasks.transition", { taskId: id, to: "doing", note: "twice" }, agent), (e) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.equal(reasonOf(e), "review_loop_limit"); return true; });
});

test("settings that are not the tasks module's are left alone", async () => {
  assert.deepEqual(await announce(harness(), "gate.timeout_hours", 3), []);
});
