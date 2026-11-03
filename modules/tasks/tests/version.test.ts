// Two people editing one task: the second save is told the task changed and what it holds now; it is never silently overwritten.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, bob, newTask } from "../fixtures/seed.ts";

const me = { id: alice.id };

test("a task carries its version, and an edit made on the current version is saved", async () => {
  const h = harness();
  const made = (await h.call("tasks.create", newTask({ assigned: bob }), me)).task;
  assert.equal(typeof made.version, "number");
  const first = (await h.call("tasks.update", { taskId: made.id, title: "Draft the brief", expectedVersion: made.version }, me)).task;
  assert.equal(first.title, "Draft the brief");
  assert.equal(first.version, made.version + 1);
});

test("a second save on an old version is refused with what the task holds now, and changes nothing", async () => {
  const h = harness();
  const made = (await h.call("tasks.create", newTask({ assigned: bob, title: "Original" }), me)).task;
  await h.call("tasks.update", { taskId: made.id, title: "Alice's title", expectedVersion: made.version }, me);
  await assert.rejects(h.call("tasks.update", { taskId: made.id, title: "Bob's title", expectedVersion: made.version }, { id: bob.id }), (e) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    assert.equal(reasonOf(e), "stale_version");
    assert.match((e as Error).message, /changed while you were editing/);
    assert.match((e as Error).message, /the title is now "Alice's title"/);
    return true;
  });
  const now = (await h.call("tasks.get", { taskId: made.id }, me)).task;
  assert.equal(now.title, "Alice's title");
});

test("an edit that names no version still saves, as before", async () => {
  const h = harness();
  const made = (await h.call("tasks.create", newTask({ assigned: bob }), me)).task;
  await h.call("tasks.update", { taskId: made.id, title: "One" }, me);
  assert.equal((await h.call("tasks.update", { taskId: made.id, title: "Two" }, { id: bob.id })).task.title, "Two");
});
