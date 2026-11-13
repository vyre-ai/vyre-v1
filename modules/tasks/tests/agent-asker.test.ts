// An agent shows what its asker may see, not what the agent may (lane f-asker, 13 Nov). Person A hands a task to agent X; person B asks X about its tasks. B must not see A's task through X, A must, a
// turn for nobody (a wake, the task baton) must, and the task's own thread must work for anyone who may be in it. Every read an agent can make of a task is proved: get, list, index, by_key, needs_you,
// my_work, digest, history, and act.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, cara, bot, newTask } from "../fixtures/seed.ts";
import { findTask } from "../projections.ts";
import type { TasksCtx } from "../projections.ts";

const A = { id: alice.id };
const forA = { id: bot.id, kind: "agent" as const, actingFor: alice.id };
const forB = { id: bot.id, kind: "agent" as const, actingFor: bob.id };
const forNobody = { id: bot.id, kind: "agent" as const };

function world(): Harness {
  const h = harness();
  h.callee("chat.start", (i: { scopeId: string }) => ({ thread: { threadId: `thr_${i.scopeId.slice(4)}` } }));
  h.callee("threads.members.add", () => ({}));
  h.callee("threads.add_agent", () => ({}));
  h.callee("chat.post", () => ({ message: {} }));
  h.callee("access.principals.get", () => ({ principal: { name: "Someone", owner: alice.id } }));
  return h;
}
/** Person A hands the agent a task. */
const handed = async (h: Harness): Promise<string> =>
  (await h.call("tasks.create", newTask({ title: "Prepare the Northwind filing", assigned: bot }), A)).task
    .id as string;
const seen = (r: { task?: unknown }): boolean => r.task !== undefined && r.task !== null;
const ids = (r: { tasks?: Array<{ id: string }>; rows?: Array<{ id: string }> }): string[] =>
  (r.tasks ?? r.rows ?? []).map((t) => t.id);

test("person B asks the agent about the task A gave it: get, by_key, list, index, my_work, needs_you and the digest show nothing; A asking the same agent sees it", async () => {
  const h = world();
  const id = await handed(h);
  const key = findTask(h.db, id)!.key!;
  await assert.rejects(h.call("tasks.get", { taskId: id }, forB), (e) => codeOf(e) === "permission.not_found");
  assert.equal((await h.call("tasks.by_key", { key }, forB)).taskId, null);
  assert.deepEqual(ids(await h.call("tasks.list", { scope: "mine" }, forB)), []);
  assert.deepEqual(ids(await h.call("tasks.list", { scope: "all" }, forB)), []);
  assert.deepEqual(ids(await h.call("tasks.index", { scope: "mine" }, forB)), []);
  assert.deepEqual(ids(await h.call("tasks.index", { scope: "everyone" }, forB)), []);
  assert.deepEqual(ids(await h.call("tasks.my_work", { section: "all" }, forB)), []);
  assert.deepEqual(ids(await h.call("tasks.needs_you", {}, forB)), []);
  const digest = await h.call("tasks.digest", {}, forB);
  assert.ok(!String(digest.text).includes("Northwind filing"), String(digest.text));
  await assert.rejects(h.call("tasks.history", { taskId: id }, forB), (e) => codeOf(e) === "permission.not_found");
  // A, through the same agent
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, forA)));
  assert.equal((await h.call("tasks.by_key", { key }, forA)).taskId, id);
  assert.deepEqual(ids(await h.call("tasks.list", { scope: "mine" }, forA)), [id]);
  assert.deepEqual(ids(await h.call("tasks.index", { scope: "mine" }, forA)), [id]);
  assert.ok(String((await h.call("tasks.digest", {}, forA)).text).includes("Northwind filing"));
});

test("a turn for nobody (a wake, the baton, a routine) sees the agent's own task", async () => {
  const h = world();
  const id = await handed(h);
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, forNobody)));
  assert.deepEqual(ids(await h.call("tasks.list", { scope: "mine" }, forNobody)), [id]);
  assert.deepEqual(ids(await h.call("tasks.index", { scope: "mine" }, forNobody)), [id]);
  assert.ok(String((await h.call("tasks.digest", {}, forNobody)).text).includes("Northwind filing"));
});

test("the task's own thread works for anyone who may be in it: B's agent turn in that thread sees and acts on the task", async () => {
  const h = world();
  const id = await handed(h);
  const thread = findTask(h.db, id)!.threadId;
  assert.ok(thread, "the task has its own thread");
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, { ...forB, thread })));
  // another chat is not the task's thread
  await assert.rejects(
    h.call("tasks.get", { taskId: id }, { ...forB, thread: "thr_other" }),
    (e) => codeOf(e) === "permission.not_found",
  );
});

test("act follows read: B cannot move A's task through the agent; A can; B on the task by their own seat can", async () => {
  const h = world();
  const id = await handed(h);
  await assert.rejects(
    h.call("tasks.act", { taskId: id, action: "start" }, forB),
    (e) => codeOf(e) === "permission.not_found",
  );
  await assert.rejects(h.call("tasks.transition", { taskId: id, to: "doing" }, forB));
  await assert.rejects(h.call("tasks.update", { taskId: id, title: "Hijacked" }, forB));
  assert.equal(findTask(h.db, id)!.state, "todo");
  assert.equal(findTask(h.db, id)!.title, "Prepare the Northwind filing");
  await h.call("tasks.act", { taskId: id, action: "start" }, forA);
  assert.equal(findTask(h.db, id)!.state, "doing");
  // B is made the reviewer: B is on the task, so B asking the agent sees it
  await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: bob }, A);
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, forB)));
});

test("a follower, and the person the task was made for, see it through the agent", async () => {
  const h = world();
  // the agent made it for Cara (acting for her), assigned to itself
  const made = await h.call("tasks.create", newTask({ title: "Chase the signed copy", assigned: bot }), {
    id: bot.id,
    kind: "agent",
    actingFor: cara.id,
  });
  const id = made.task.id as string;
  assert.equal(findTask(h.db, id)!.createdFor, cara.id, "created_for records the person the creating turn acted for");
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, { ...forNobody, actingFor: cara.id })));
  await assert.rejects(h.call("tasks.get", { taskId: id }, forB), (e) => codeOf(e) === "permission.not_found");
  await h.call("tasks.followers.add", { taskId: id, follower: bob.id }, { ...forNobody, actingFor: cara.id });
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, forB)), "a follower sees it");
});

test("created_for: a person's own task and a turn for nobody record none", async () => {
  const h = world();
  const mine = await handed(h);
  assert.equal(findTask(h.db, mine)!.createdFor, undefined);
  const wake = (await h.call("tasks.create", newTask({ title: "Weekly sweep", assigned: bot }), forNobody)).task
    .id as string;
  assert.equal(findTask(h.db, wake)!.createdFor, undefined);
});

test("a goal lead's plan: the lead in its wake sees it, the goal's owner through the lead sees it, another asker does not", async () => {
  const h = world();
  const owner = { id: bot.id, kind: "agent" as const, actingFor: alice.id };
  const planned = await h.call(
    "tasks.plan",
    {
      idempotencyKey: "plan_1",
      parent: { title: "Close the quarter" },
      children: [{ key: "a", title: "Reconcile the ledger", assigned: bot }],
    },
    owner,
  );
  const child = planned.children[0].taskId as string;
  assert.equal(findTask(h.db, child)!.createdFor, alice.id);
  assert.ok(seen(await h.call("tasks.get", { taskId: child }, forNobody)), "the lead in its wake");
  assert.ok(seen(await h.call("tasks.get", { taskId: child }, forA)), "the goal's owner through the lead");
  await assert.rejects(h.call("tasks.get", { taskId: child }, forB), (e) => codeOf(e) === "permission.not_found");
  assert.deepEqual(ids(await h.call("tasks.index", { scope: "mine" }, forB)), []);
  assert.ok(ids(await h.call("tasks.index", { scope: "mine" }, forNobody)).includes(child));
});

test("a person is judged as before: the agent's rights do not hide what the person holds themselves", async () => {
  const h = world();
  const id = await handed(h);
  assert.ok(seen(await h.call("tasks.get", { taskId: id }, A)));
  await assert.rejects(
    h.call("tasks.get", { taskId: id }, { id: bob.id }),
    (e) => codeOf(e) === "permission.not_found",
  );
});

test("an older task with no created_for column value: the migration backfills it from the note the session wrote", async () => {
  const h = world();
  const id = await handed(h);
  // simulate a row from before the column: the note says who, the column is empty
  h.sqlite.exec(`UPDATE tasks_core SET created_for = NULL WHERE id = '${id}'`);
  h.sqlite.exec(`UPDATE tasks_meta SET working_notes = '{"baton.acting_for":"${cara.id}"}' WHERE id = '${id}'`);
  const sql = (await import("node:fs"))
    .readFileSync(new URL("../migrations/0004_created_for.sql", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("UPDATE"))
    .join("\n");
  h.sqlite.exec(sql);
  assert.equal(findTask(h.db, id)!.createdFor, cara.id);
  void ({} as TasksCtx);
});

test("acts through the agent, by the asker's role on the task: a follower reads but may not start or cancel it, as directly; every other role works the agent's own task", async () => {
  const roles: Array<[string, (h: Harness, id: string) => void, boolean]> = [
    [
      "follower",
      (h, id) => h.sqlite.exec(`UPDATE tasks_meta SET followers = '["${bob.id}"]' WHERE id = '${id}'`),
      false,
    ],
    [
      "reviewer slot",
      (h, id) =>
        h.sqlite.exec(`UPDATE tasks_meta SET reviewer = '{"kind":"person","id":"${bob.id}"}' WHERE id = '${id}'`),
      true,
    ],
    ["taker", (h, id) => h.sqlite.exec(`UPDATE tasks_meta SET taken_by = '${bob.id}' WHERE id = '${id}'`), true],
    ["creator", (h, id) => h.sqlite.exec(`UPDATE tasks_core SET created_by = '${bob.id}' WHERE id = '${id}'`), true],
    [
      "created for",
      (h, id) => h.sqlite.exec(`UPDATE tasks_core SET created_for = '${bob.id}' WHERE id = '${id}'`),
      true,
    ],
    [
      "responsible",
      (h, id) => h.sqlite.exec(`UPDATE tasks_core SET responsible = '${bob.id}' WHERE id = '${id}'`),
      true,
    ],
  ];
  for (const [role, give, may] of roles) {
    for (const move of ["start", "cancel"] as const) {
      const h = world();
      const id = (
        await h.call("tasks.create", newTask({ title: "Chase the signed copy", assigned: bot }), { id: cara.id })
      ).task.id as string;
      give(h, id);
      const via = h.call(
        move === "start" ? "tasks.act" : "tasks.transition",
        move === "start" ? { taskId: id, action: "start" } : { taskId: id, to: "canceled" },
        forB,
      );
      if (may) await via;
      else await assert.rejects(via, `${role} must not ${move} through the agent`);
      const seenByB = seen(await h.call("tasks.get", { taskId: id }, forB).catch(() => ({})));
      assert.equal(seenByB, true, `${role} still reads it through the agent`);
      assert.equal(findTask(h.db, id)!.state === "todo", !may, `${role} ${move}: the state moved only when it may`);
    }
  }
});
