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

test("the refusal also says who changed the task last and which version it is on, so the second person's page can show both sides", async () => {
  const h = harness();
  const made = (await h.call("tasks.create", newTask({ assigned: bob, title: "Original" }), me)).task;
  await h.call("tasks.update", { taskId: made.id, title: "Alice's title", effort: 30, expectedVersion: made.version }, me);
  await assert.rejects(h.call("tasks.update", { taskId: made.id, title: "Bob's title", effort: 45, expectedVersion: made.version }, { id: bob.id }), (e) => {
    const d = (e as { error?: { details?: Record<string, unknown> } }).error?.details ?? {};
    assert.equal(d.by, alice.id);
    assert.equal(d.version, made.version + 1);
    assert.deepEqual(d.current, { title: "Alice's title", effort: 30 });
    return true;
  });
});

test("a note written from an old value is refused with what the note holds now and who changed it; two saves race and the second is told", async () => {
  const h = harness();
  const made = (await h.call("tasks.create", newTask({ assigned: bob }), me)).task;
  await h.call("tasks.working_notes.set", { taskId: made.id, key: "brief", value: "First", expectedFrom: "" }, me);
  // both read "First"; Alice saves first, Bob second
  await h.call("tasks.working_notes.set", { taskId: made.id, key: "brief", value: "Alice's brief", expectedFrom: "First" }, me);
  await assert.rejects(h.call("tasks.working_notes.set", { taskId: made.id, key: "brief", value: "Bob's brief", expectedFrom: "First" }, { id: bob.id }), (e) => {
    const d = (e as { error?: { code?: string; details?: Record<string, unknown> } }).error;
    assert.equal(d?.code, "validation.precondition_failed");
    assert.equal(d?.details?.reason, "stale_version");
    assert.deepEqual(d?.details?.current, { brief: "Alice's brief" });
    assert.equal(d?.details?.by, alice.id);
    return true;
  });
  assert.equal((await h.call("tasks.get", { taskId: made.id }, me)).task.workingNotes.brief, "Alice's brief", "nothing was overwritten");
  // a writer that names no start value, as an agent does, still writes
  await h.call("tasks.working_notes.set", { taskId: made.id, key: "brief", value: "Agent's brief" }, { id: bob.id });
  assert.equal((await h.call("tasks.get", { taskId: made.id }, me)).task.workingNotes.brief, "Agent's brief");
});
