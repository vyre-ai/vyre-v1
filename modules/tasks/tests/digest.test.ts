// tasks.digest: what an agent carries each turn. Bound task, parent, siblings and its own work; inside the cap whatever the numbers; the same words give the same hash; and the asker's reach limits it.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, bob, bot, bot2, newTask } from "../fixtures/seed.ts";
import { DIGEST_CHARS, hashOf, renderDigest } from "../handlers/digest.ts";

const me = { id: alice.id };
const service = { id: "svc_host", kind: "service" as const };
const ai = (id: string) => ({ kind: "agent" as const, id });
const digest = (h: ReturnType<typeof harness>, input: Record<string, unknown>, who: { id: string; kind?: "service" | "person" | "agent" } = service) => h.call("tasks.digest", input, who);

async function planned(h: ReturnType<typeof harness>) {
  const out = await h.call("tasks.plan", {
    parent: { title: "Ship uploads", assigned: ai(bot.id) },
    children: [{ key: "a", title: "Flow", assigned: ai(bot.id) }, { key: "b", title: "Tests", assigned: ai(bot2.id), dependsOn: ["a"] }, { key: "c", title: "Links", assigned: ai(bot2.id) }],
    idempotencyKey: "plan",
  }, me);
  return { parent: out.parent.id as string, a: out.children[0].taskId as string, b: out.children[1].taskId as string };
}

test("an agent hears its own open work, and nothing when it has none", async () => {
  const h = harness();
  assert.equal((await digest(h, { agentId: bot.id })).text, "");
  await planned(h);
  const d = await digest(h, { agentId: bot2.id });
  assert.match(d.text, /Your open tasks \(2\):/);
  assert.match(d.text, /Tests \[to do\]/);
  assert.doesNotMatch(d.text, /Flow/);
});

test("on the task's own thread it hears the task, the parent and the siblings, a finished sibling only as a count", async () => {
  const h = harness();
  const p = await planned(h);
  await h.call("tasks.update", { taskId: p.a, threadId: "thr_bound" }, me);
  await h.call("tasks.transition", { taskId: p.b, to: "canceled" }, me);
  const d = await digest(h, { agentId: bot.id, threadId: "thr_bound" });
  assert.match(d.text, /On this thread: \S+ Flow \[to do\]/);
  assert.match(d.text, /Parent: \S+ Ship uploads/);
  assert.match(d.text, /Siblings \(1 of 2 finished\):/);
  assert.match(d.text, /Links/);
  assert.doesNotMatch(d.text, /Tests/);
});

test("the cap holds at any size and the count says what was left out", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ id: `tsk_${i}`, key: `VY-${i}`, title: "A very long title that goes on ".repeat(6), state: "doing" })) as never[];
  const text = renderDigest({ bound: many[0], parent: many[1], siblings: many, children: many, mine: many.slice(0, 5), mineTotal: 500 });
  assert.ok(text.length <= DIGEST_CHARS, `${text.length}`);
  assert.ok(text.includes("On this thread:"));
});

test("the same words give the same hash, a change gives another: the digest is sent only when it moved", async () => {
  const h = harness();
  const p = await planned(h);
  const one = await digest(h, { agentId: bot.id });
  assert.equal((await digest(h, { agentId: bot.id })).hash, one.hash);
  await h.call("tasks.update", { taskId: p.a, title: "Flow, renamed" }, me);
  assert.notEqual((await digest(h, { agentId: bot.id })).hash, one.hash);
  assert.equal(hashOf("x"), hashOf("x"));
});

test("a task the asker cannot see stays out, even when the agent holds it", async () => {
  const h = harness();
  await h.call("tasks.create", newTask({ title: "Private matter", assigned: ai(bot.id) }), me);
  assert.match((await digest(h, { agentId: bot.id }, me)).text, /Private matter/);
  assert.doesNotMatch((await digest(h, { agentId: bot.id }, { id: bob.id })).text, /Private matter/);
});

test("a crew job or helper's thread is told which task it is doing; a chat that holds a parent is not", async () => {
  const h = harness();
  const p = await planned(h);
  await h.call("tasks.update", { taskId: p.a, workerThread: "thr_job" }, me);
  await h.call("tasks.update", { taskId: p.parent, threadId: "thr_chat" }, me);
  const job = await digest(h, { agentId: bot.id, threadId: "thr_job" });
  assert.equal(job.boundTaskId, p.a);
  assert.match(job.text, /On this thread: \S+ Flow/);
  const chat = await digest(h, { agentId: bot.id, threadId: "thr_chat" });
  assert.equal(chat.boundTaskId, undefined);
  assert.match(chat.text, /On this thread: \S+ Ship uploads/);
  assert.match(chat.text, /Children \(0 of 3 finished\):/);
});
