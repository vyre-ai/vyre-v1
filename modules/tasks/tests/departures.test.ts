// Nothing waits on someone who is gone (hole 10): what a removed person held moves on, a deleted agent's own requests end and its work goes to the person behind it.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, as, bob, bot, cara, newTask, owner } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";

const svc = { id: "svc_host", kind: "service" as const };
const withOwner = () => { const h = harness({ authorize: () => true }); h.callee("spaces.get", () => ({ space: { owner: owner.id } })); return h; };
const stored = async (h: ReturnType<typeof harness>, id: string, who = owner) => (await h.call("tasks.get", { taskId: id }, as(who))).task;
const left = (h: ReturnType<typeof harness>, personId: string) => consumers["tasks.person_left"].run(h.ctxFor("tasks.assign", svc), { payload: { personId } } as never);
// a consumer may emit what any capability of its module declares
const gone = (h: ReturnType<typeof harness>, agentId: string) => {
  const moves = h.ctxFor("tasks.assign", svc), ends = h.ctxFor("tasks.withdraw", svc);
  const ctx = { ...moves, emit: (name: string, ...rest: unknown[]) => (name === "task.withdrawn" ? (ends.emit as (...a: unknown[]) => unknown)(name, ...rest) : (moves.emit as (...a: unknown[]) => unknown)(name, ...rest)) };
  return consumers["tasks.agent_deleted"].run(ctx as never, { payload: { agentId } } as never);
};

test("work a removed person held goes back to whoever made it, with one line of history, and a second delivery moves nothing", async () => {
  const h = withOwner();
  const { task } = await h.call("tasks.create", newTask({ assigned: alice }), as(bob));
  assert.deepEqual(await left(h, alice.id), [task.id]);
  assert.deepEqual((await stored(h, task.id)).assigned, bob);
  const lines = (await h.call("tasks.history", { taskId: task.id }, as(owner))).entries;
  assert.ok(lines.some((e: { note?: string }) => e.note === "The person holding this left the Space."));
  assert.deepEqual(await left(h, alice.id), []);
});

test("a task the person made and held themselves goes to the Space's owner, and so does a seat they kept", async () => {
  const h = withOwner();
  const a = (await h.call("tasks.create", newTask({ assigned: alice }), as(alice))).task;
  const b = (await h.call("tasks.create", newTask({ assigned: cara, reviewer: alice }), as(bob))).task;
  await left(h, alice.id);
  assert.deepEqual((await stored(h, a.id)).assigned, owner);
  assert.deepEqual((await stored(h, b.id)).reviewer, bob);
  assert.deepEqual((await stored(h, b.id)).assigned, cara);
});

test("a deleted agent's work goes to the person behind it; its own requests end; what anyone else raised stands", async () => {
  const h = withOwner();
  h.callee("agents.get", () => ({ agent: { ownerId: bob.id } }));
  const work = (await h.call("tasks.create", newTask({ assigned: bot }), as(alice))).task;
  const asked = (await h.call("tasks.create", newTask({ kind: "answer", assigned: alice, title: "Which draft?" }), as(bot, { actingFor: alice.id }))).task;
  const mine = (await h.call("tasks.create", newTask({ kind: "answer", assigned: alice, title: "Which draft?" }), as(bob))).task;
  const touched = await gone(h, bot.id);
  assert.deepEqual([...touched].sort(), [work.id, asked.id].sort());
  const moved = await stored(h, work.id);
  assert.equal(moved.assigned.kind, "person");
  assert.notEqual(moved.assigned.id, bot.id);
  assert.equal((await stored(h, asked.id)).state, "canceled");
  assert.notEqual((await stored(h, mine.id)).state, "canceled");
});
