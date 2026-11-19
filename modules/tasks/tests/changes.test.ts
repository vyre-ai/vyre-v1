// The alive line (lane r42-alive): what the Space did since a time, from the log: each put-away task with its reason, counts by reason, and how many new tasks wait on the reader. What the reader did by hand is not news.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { DAY, alice, bob, newTask } from "../fixtures/seed.ts";

const me = { id: alice.id };
const svc = { id: "svc_host", kind: "service" as const };

type Changes = {
  items: { taskId: string; title: string; code: string; why: string }[];
  counts: Record<string, number>;
  fresh: number;
};

test("changes lists what the rules put away since a time with the reasons, counts by reason, and new tasks for the reader; her own Archive is not news", async () => {
  const h = harness();
  const since = h.now();
  const passed = (await h.call("tasks.create", newTask({ title: "Join the call", relevantUntil: h.now() + 1000 }), me))
    .task.id as string;
  const mine = (await h.call("tasks.create", newTask({ title: "I archived this" }), me)).task.id as string;
  await h.call("tasks.archive", { taskId: mine, why: "no" }, me);
  await h.call("tasks.create", newTask({ title: "Work Bob gave Alice" }), { id: bob.id });
  h.advance(DAY + 2000);
  await h.call("tasks.clock", {}, svc);
  const c = (await h.call("tasks.changes", { since }, me)) as Changes;
  assert.deepEqual(
    c.items.map((i) => [i.taskId, i.code]),
    [[passed, "passed"]],
    "only what the Space did",
  );
  assert.match(c.items[0]!.why, /^It was for /);
  assert.deepEqual(c.counts, { passed: 1 });
  assert.equal(c.fresh, 1, "one new task waits on Alice (the one Bob gave her)");
  const later = (await h.call("tasks.changes", { since: h.now() + 1 }, me)) as Changes;
  assert.deepEqual([later.items.length, later.fresh], [0, 0], "nothing since later");
});
