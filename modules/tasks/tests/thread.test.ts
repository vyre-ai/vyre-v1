// The thread of a task (work baton, item 1): every task gets one, the holders of the slots are in it, a changed slot brings the new holder in, and a task never fails because chat could not make a thread.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, bot2, cara, owner, newTask } from "../fixtures/seed.ts";

const me = { id: owner.id };

function withThreads(): Harness {
  const h = harness();
  h.callee("chat.start", (i: { scopeId: string }) => ({ thread: { threadId: `thr_${i.scopeId.slice(4)}` } }));
  h.callee("threads.members.add", () => ({}));
  h.callee("threads.add_agent", () => ({}));
  return h;
}

test("a new task gets a thread named by the task, with its agents, and the people of the slots are added", async () => {
  const h = withThreads();
  const r = await h.call("tasks.create", newTask({ assigned: bot, reviewer: bob, approver: cara }), me);
  const id = r.task.id as string;
  assert.equal(r.task.threadId, `thr_${id.slice(4)}`);
  const start = h.threadCalls.find((c) => c.cap === "chat.start")!.input as Record<string, unknown>;
  assert.deepEqual({ kind: start.kind, scopeType: start.scopeType, scopeId: start.scopeId, agentIds: start.agentIds }, { kind: "chat", scopeType: "task", scopeId: id, agentIds: [bot.id] });
  assert.equal(start.idempotencyKey, `task-thread:${id}`);
  const people = h.threadCalls.filter((c) => c.cap === "threads.members.add").map((c) => (c.input as { personId: string }).personId);
  assert.deepEqual(people.sort(), [bob.id, cara.id].sort());
  assert.deepEqual(h.calls.map((c) => c.cap), ["access.principals.get"], "nothing but the owner lookup");
});

test("every kind of task has a thread", async () => {
  const h = withThreads();
  for (const kind of ["work", "approve", "review", "answer", "unblock", "signature"]) {
    const r = await h.call("tasks.create", newTask({ kind }), me);
    assert.ok(r.task.threadId, kind);
  }
});

test("a task made in a chat gets its own thread and keeps the way back to the chat", async () => {
  const h = withThreads();
  const ctx = h.ctxFor("tasks.create", me);
  ctx.thread = "thr_origin";
  const handlers = (await import("../impl.ts")).handlers as Record<string, (c: typeof ctx, i: unknown) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await handlers["tasks.create"]!(ctx, { ...newTask(), idempotencyKey: "k1" });
  assert.notEqual(r.task.threadId, "thr_origin");
  assert.equal(r.task.workingNotes["thread.origin"], "thr_origin");
});

test("chat cannot make a thread: the task is made all the same, and a made-in-chat task keeps that chat as its thread", async () => {
  const h = harness();   // no chat.start callee: every call throws
  const r = await h.call("tasks.create", newTask(), me);
  assert.equal(r.task.state, "todo");
  assert.equal(r.task.threadId, undefined);
  const ctx = h.ctxFor("tasks.create", me);
  ctx.thread = "thr_origin";
  const handlers = (await import("../impl.ts")).handlers as Record<string, (c: typeof ctx, i: unknown) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const q = await handlers["tasks.create"]!(ctx, { ...newTask(), idempotencyKey: "k2" });
  assert.equal(q.task.threadId, "thr_origin");
});

test("a new Reviewer or agent holder is brought into the thread", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask(), me)).task.id as string;
  h.threadCalls.length = 0;
  await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: bob }, me);
  await h.call("tasks.assign", { taskId: id, slot: "approver", to: bot2 }, me);
  const people = new Set(h.threadCalls.filter((c) => c.cap === "threads.members.add").map((c) => (c.input as { personId: string }).personId));
  assert.deepEqual([...people].sort(), [alice.id, bob.id].sort(), "adding someone already in the thread changes nothing, so the whole seat list is safe to send");
  const agents = h.threadCalls.filter((c) => c.cap === "threads.add_agent").map((c) => c.input as { agentId: string; mode: string });
  assert.deepEqual(agents, [{ threadId: agents[0]!.threadId, agentId: bot2.id, mode: "listen" }]);
});

test("tasks.update links a thread only to a task that has none", async () => {
  const h = harness();
  const id = (await h.call("tasks.create", newTask(), me)).task.id as string;
  assert.equal((await h.call("tasks.get", { taskId: id }, me)).task.threadId, undefined);
  const a = await h.call("tasks.update", { taskId: id, threadId: "thr_late" }, me);
  assert.equal(a.task.threadId, "thr_late");
  assert.deepEqual(h.events.map((e) => e.name), ["task.updated"]);
  assert.deepEqual(h.events[0]!.payload.fields, ["threadId"]);
  const b = await h.call("tasks.update", { taskId: id, threadId: "thr_other" }, me);
  assert.equal(b.task.threadId, "thr_late", "a linked thread is never replaced");
});
