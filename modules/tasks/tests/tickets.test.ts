// Tickets: short keys, the fields a row shows, the long list and its revision, delete with Undo, letting a task go, moving a child, and the plan that breaks work into tasks.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, bot2, newTask } from "../fixtures/seed.ts";
import { loopIn } from "../handlers/plan.ts";
import { prefixOf } from "../projections.ts";

const me = { id: alice.id };
async function mk(h: Harness, over: Record<string, unknown> = {}, who: { id: string; kind?: "service" | "person" | "agent" } = me): Promise<string> {
  return (await h.call("tasks.create", newTask(over), who)).task.id as string;
}
const get = async (h: Harness, id: string, who = me): Promise<any> => (await h.call("tasks.get", { taskId: id }, who)).task;   // eslint-disable-line @typescript-eslint/no-explicit-any
async function refused(p: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.equal(reasonOf(e), reason); return true; });
}

test("every task gets a short key in the letters of its Space, and it is found by that key", async () => {
  const h = harness();
  const a = await mk(h), b = await mk(h);
  assert.equal((await get(h, a)).key, "NO-1");
  assert.equal((await get(h, b)).key, "NO-2");
  assert.equal((await h.call("tasks.by_key", { key: "no-2" }, me)).taskId, b);
  assert.equal((await h.call("tasks.by_key", { key: "#NO-2" }, me)).taskId, b);
  assert.equal((await h.call("tasks.by_key", { key: "NO-99" }, me)).taskId, null);
  assert.equal(prefixOf("Bailey Galyen Law"), "BG");
  assert.equal(prefixOf("Vyre"), "VY");
  assert.equal(prefixOf(""), "VY");
});

test("a key names only what the caller may see", async () => {
  const h = harness();
  await mk(h, { assigned: bob }, { id: bob.id });
  assert.equal((await h.call("tasks.by_key", { key: "NO-1" }, { id: "usr_stranger" })).taskId, null);
});

test("priority, labels, start, fields and repeat are kept and changed by tasks.update", async () => {
  const h = harness();
  const id = await mk(h, { priority: "high", labels: ["portal", "portal"], start: h.now(), fields: { client: "Dana" }, recur: { every: "week" } });
  const t = await get(h, id);
  assert.deepEqual([t.priority, t.labels, t.fields.client, t.recur.every], ["high", ["portal"], "Dana", "week"]);
  const u = (await h.call("tasks.update", { taskId: id, priority: null, labels: ["launch"], start: null, fields: { client: null, tier: "gold" }, recur: null }, me)).task;
  assert.equal(u.priority, undefined);
  assert.deepEqual(u.labels, ["launch"]);
  assert.equal(u.start, undefined);
  assert.deepEqual(u.fields, { tier: "gold" });
  assert.equal(u.recur, undefined);
});

test("the list shows the scope, the rollup and what waits; an unchanged revision answers nothing", async () => {
  const h = harness();
  const p = await mk(h, { title: "Parent" });
  const c1 = await mk(h, { parentTaskId: p, title: "One" });
  const c2 = await mk(h, { parentTaskId: p, title: "Two", dependsOn: [c1] });
  await mk(h, { assigned: bob, title: "Given" });
  await mk(h, { assigned: bob, title: "Not mine" }, { id: bob.id });
  const mine = await h.call("tasks.index", { scope: "mine" }, me);
  assert.deepEqual(mine.rows.map((r: { title: string }) => r.title).sort(), ["One", "Parent", "Two"]);
  const row = (id: string): any => mine.rows.find((r: { id: string }) => r.id === id);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(row(p).children, { total: 2, done: 0 });
  assert.equal(row(c2).blocked, true);
  assert.deepEqual(row(c2).dependsOn, [c1]);
  const given = await h.call("tasks.index", { scope: "given" }, me);
  assert.deepEqual(given.rows.map((r: { title: string }) => r.title), ["Given"]);
  const again = await h.call("tasks.index", { scope: "mine", rev: mine.rev }, me);
  assert.equal(again.unchanged, true);
  assert.equal(again.rows.length, 0);
  await h.call("tasks.transition", { taskId: c1, to: "doing" }, me);
  const moved = await h.call("tasks.index", { scope: "mine", rev: mine.rev }, me);
  assert.equal(moved.unchanged, false);
  assert.notEqual(moved.rev, mine.rev);
  assert.equal((await h.call("tasks.rev", {}, me)).rev, moved.rev);
  const under = await h.call("tasks.index", { scope: "everyone", parentTaskId: p }, me);
  assert.equal(under.rows.length, 2);
});

test("what is done collapses to a count, and opens on request", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("tasks.transition", { taskId: id, to: "done" }, me);
  const open = await h.call("tasks.index", { scope: "mine" }, me);
  assert.equal(open.rows.length, 0);
  assert.equal(open.doneThisWeek, 1);
  const done = await h.call("tasks.index", { scope: "mine", done: true }, me);
  assert.deepEqual(done.rows.map((r: { id: string }) => r.id), [id]);
});

test("a deleted task leaves every list and Undo brings it back; only someone on it may", async () => {
  const h = harness();
  const id = await mk(h);
  await refused(h.call("tasks.delete", { taskId: id }, { id: "usr_stranger" }), "wrong_actor");
  await h.call("tasks.delete", { taskId: id }, me);
  assert.equal((await h.call("tasks.index", { scope: "mine" }, me)).rows.length, 0);
  await assert.rejects(get(h, id));
  assert.equal((await h.call("tasks.restore", { taskId: id }, me)).task.id, id);
  assert.equal((await h.call("tasks.index", { scope: "mine" }, me)).rows.length, 1);
});

test("a held act or a task a Run waits on is never deleted", async () => {
  const h = harness();
  const held = await mk(h, { kind: "approve", source: { kind: "gate", id: "dec_1" } });
  await refused(h.call("tasks.delete", { taskId: held }, me), "held_act");
  const run = await mk(h, { source: { kind: "run", id: "run_1" } });
  await refused(h.call("tasks.delete", { taskId: run }, me), "run_waits");
});

test("plain work is let go one task at a time, by someone on it; a source that stopped still takes only its requests", async () => {
  const h = harness();
  const work = await mk(h, { source: { kind: "chat", id: "thr_1" } });
  await refused(h.call("tasks.withdraw", { taskId: work, note: "No" }, { id: "usr_stranger" }), "wrong_actor");
  assert.equal((await h.call("tasks.withdraw", { sourceKind: "chat", sourceId: "thr_1", note: "Stopped" }, { id: "svc_system", kind: "service" })).withdrawn, 0);
  assert.equal((await h.call("tasks.withdraw", { taskId: work, note: "Let go" }, me)).withdrawn, 1);
  assert.equal((await get(h, work)).state, "canceled");
});

test("a child moves between parents and never under itself", async () => {
  const h = harness();
  const a = await mk(h), b = await mk(h), c = await mk(h, { parentTaskId: a });
  assert.equal((await h.call("tasks.update", { taskId: c, parentTaskId: b }, me)).task.parentTaskId, b);
  await refused(h.call("tasks.update", { taskId: b, parentTaskId: c }, me), "parent_loop");
  assert.equal((await h.call("tasks.update", { taskId: c, parentTaskId: null }, me)).task.parentTaskId, undefined);
});

// ---- the plan ----

const plan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  idempotencyKey: "p1", parent: { title: "Ship uploads", brief: "Uploads in the portal" },
  children: [
    { key: "build", title: "Upload flow", brief: "Resumable", doneMeans: ["Resumes after a drop"], assigned: bot },
    { key: "test", title: "Tests", assigned: bot2, reviewer: alice, dependsOn: ["build"] },
  ], ...over,
});

test("a plan makes a parent and its children at once: briefs, done means, who, and what waits on what", async () => {
  const h = harness();
  const r = await h.call("tasks.plan", plan(), { id: bot.id, kind: "agent" });
  assert.equal(r.children.length, 2);
  assert.equal(r.parent.assigned.id, bot.id);
  assert.equal(r.parent.workingNotes["plan.parent"], "1");
  const build = r.children.find((c: { key: string }) => c.key === "build"), tests = r.children.find((c: { key: string }) => c.key === "test");
  const t = (await h.call("tasks.get", { taskId: tests.taskId }, { id: bot.id, kind: "agent" })).task;
  assert.deepEqual(t.dependsOn, [build.taskId]);
  assert.equal(t.blocked, true);
  assert.equal(t.parentTaskId, r.parent.id);
  assert.equal(t.reviewer.id, alice.id);
  const b = (await h.call("tasks.get", { taskId: build.taskId }, { id: bot.id, kind: "agent" })).task;
  assert.equal(b.workingNotes.brief, "Resumable");
  assert.deepEqual(JSON.parse(b.workingNotes.done_means), ["Resumes after a drop"]);
});

test("the same plan twice adds nothing, and a new key adds only that child", async () => {
  const h = harness();
  const who = { id: bot.id, kind: "agent" as const };
  const one = await h.call("tasks.plan", plan(), who);
  const two = await h.call("tasks.plan", plan({ idempotencyKey: "p2" }), who);
  assert.equal(two.parent.id, one.parent.id);
  assert.deepEqual(two.children.map((c: { taskId: string }) => c.taskId), one.children.map((c: { taskId: string }) => c.taskId));
  assert.ok(two.children.every((c: { created: boolean }) => !c.created));
  const three = await h.call("tasks.plan", { idempotencyKey: "p3", parentTaskId: one.parent.id, children: [{ key: "docs", title: "Docs", assigned: bot2, dependsOn: ["tsk_missing"] }].map((c) => ({ ...c, dependsOn: [one.children[0].taskId] })) }, who);
  assert.equal(three.children[0].created, true);
  assert.equal((await h.call("tasks.index", { scope: "everyone", parentTaskId: one.parent.id }, who)).rows.length, 3);
});

test("a plan that waits in a circle, repeats a key or names nothing is refused whole", async () => {
  const h = harness();
  const who = { id: bot.id, kind: "agent" as const };
  await refused(h.call("tasks.plan", plan({ children: [{ key: "a", title: "A", assigned: bot, dependsOn: ["b"] }, { key: "b", title: "B", assigned: bot, dependsOn: ["a"] }] }), who), "dependency_cycle");
  await refused(h.call("tasks.plan", plan({ children: [{ key: "a", title: "A", assigned: bot }, { key: "a", title: "A", assigned: bot }] }), who), "duplicate_key");
  await refused(h.call("tasks.plan", plan({ children: [{ key: "a", title: "A", assigned: bot, dependsOn: ["ghost"] }] }), who), "dependency_missing");
  assert.equal((await h.call("tasks.rev", {}, who)).rev.startsWith("0."), true, "nothing was written");
  assert.equal(loopIn([{ key: "a", dependsOn: ["b"] }, { key: "b" }]), null);
});

test("the work under a chat is the children of the plans in that thread, and nothing else", async () => {
  const h = harness();
  const out = await h.call("tasks.plan", { parent: { title: "Plan here", assigned: { kind: "agent", id: bot.id } }, children: [{ key: "a", title: "One", assigned: { kind: "agent", id: bot.id } }, { key: "b", title: "Two", assigned: { kind: "agent", id: bot2.id } }], idempotencyKey: "p1" }, me);
  await h.call("tasks.plan", { parent: { title: "Plan elsewhere", assigned: { kind: "agent", id: bot.id } }, children: [{ key: "c", title: "Three", assigned: { kind: "agent", id: bot.id } }], idempotencyKey: "p2" }, me);
  await h.call("tasks.update", { taskId: out.parent.id, threadId: "thr_here" }, me);
  const rows = (await h.call("tasks.index", { scope: "everyone", underThread: "thr_here" }, me)).rows;
  assert.deepEqual(rows.map((r: { title: string }) => r.title).sort(), ["One", "Two"]);
  assert.deepEqual((await h.call("tasks.index", { scope: "everyone", underThread: "thr_other" }, me)).rows, []);
});
