// The scheduler: a task that lost its last dependency says it is ready, a parent is under way once any child is, and a parent hears only when all its children finished.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bot, bot2, newTask } from "../fixtures/seed.ts";
import { onTaskChanged } from "../handlers/schedule.ts";

const me = { id: alice.id };
const server = { id: "svc_host", kind: "service" as const };
const ai = (id: string) => ({ kind: "agent" as const, id });

async function planned(h: ReturnType<typeof harness>) {
  const out = await h.call("tasks.plan", {
    parent: { title: "Ship uploads", assigned: ai(bot.id) },
    children: [{ key: "a", title: "Flow", assigned: ai(bot.id) }, { key: "b", title: "Tests", assigned: ai(bot2.id), dependsOn: ["a"] }],
    idempotencyKey: "plan",
  }, me);
  return { parent: out.parent.id as string, a: out.children[0].taskId as string, b: out.children[1].taskId as string };
}
const moved = (h: ReturnType<typeof harness>, taskId: string, who: { id: string; kind?: "service" | "agent" } = server) => onTaskChanged(h.ctxFor("tasks.transition", who), { name: "task.transitioned", payload: { taskId } });
const state = async (h: ReturnType<typeof harness>, id: string): Promise<string> => (await h.call("tasks.get", { taskId: id }, me)).task.state;

test("a parent starts with its first child, and a child does not move it twice", async () => {
  const h = harness();
  const p = await planned(h);
  await h.call("tasks.transition", { taskId: p.a, to: "doing" }, { id: bot.id, kind: "agent" });
  // the event carries the child's agent, who does not hold the parent
  assert.deepEqual(await moved(h, p.a, { id: bot2.id, kind: "agent" }), [p.parent]);
  assert.equal(await state(h, p.parent), "doing");
  assert.deepEqual(await moved(h, p.a), []);
});

test("work with no parent moves nothing", async () => {
  const h = harness();
  const t = (await h.call("tasks.create", newTask({}), me)).task.id as string;
  await h.call("tasks.transition", { taskId: t, to: "doing" }, me);
  assert.deepEqual(await moved(h, t), []);
});

test("a task that waited says it is ready when what it waited on is done", async () => {
  const h = harness();
  const p = await planned(h);
  await h.call("tasks.transition", { taskId: p.a, to: "doing" }, { id: bot.id, kind: "agent" });
  await h.call("tasks.transition", { taskId: p.a, to: "done" }, { id: bot.id, kind: "agent" });
  assert.deepEqual(await moved(h, p.a), [p.b]);
});
