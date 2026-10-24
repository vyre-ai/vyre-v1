// The tasks capabilities around the state machine: create and its rules, Blocked, dependencies, Needs you, My work, lists, Take, withdraw, followers, notes, links, assign, history.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, cara, finance, owner, newTask, NOW, DAY } from "../fixtures/seed.ts";

const HOUR = 3_600_000;
const svc = { id: "svc_system", kind: "service" as const };
const me = { id: owner.id };

async function mk(h: Harness, over: Record<string, unknown> = {}, who: { id: string; kind?: "service" | "person" | "agent" } = me): Promise<string> {
  return (await h.call("tasks.create", newTask(over), who)).task.id as string;
}
const get = async (h: Harness, id: string): Promise<any> => (await h.call("tasks.get", { taskId: id }, me)).task;   // eslint-disable-line @typescript-eslint/no-explicit-any
const names = (h: Harness): string[] => h.events.map((e) => e.name);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id).sort();

// ---- create ----

test("each kind starts where the table says and emits what it should", async () => {
  const h = harness();
  const want: Record<string, string> = { work: "todo", approve: "awaiting_approval", review: "in_review", answer: "todo", unblock: "todo", signature: "doing" };
  for (const [kind, state] of Object.entries(want)) {
    const r = await h.call("tasks.create", newTask({ kind }), me);
    assert.equal(r.task.state, state, kind);
    assert.equal(r.task.kind, kind);
    assert.equal(r.task.createdBy, owner.id);
    const request = ["approve", "review", "answer", "unblock"].includes(kind);
    assert.deepEqual(names(h), request ? ["task.created", "task.requested", "task.assigned"] : ["task.created", "task.assigned"], kind);
  }
  const a = await h.call("tasks.create", newTask({ kind: "approve" }), me);
  assert.deepEqual(a.task.approver, alice, "an Approve request is addressed to its approver");
  assert.deepEqual(a.task.actions.map((x: { key: string }) => x.key), ["approve", "reject"]);
  const r = await h.call("tasks.create", newTask({ kind: "review" }), me);
  assert.deepEqual(r.task.reviewer, alice);
  const w = await h.call("tasks.create", newTask({ reviewer: bob, approver: cara, due: NOW + DAY, effort: 30, recordId: "rec_abc", fileIds: ["fil_one", "fil_one"] }), me);
  assert.deepEqual(names(h), ["task.created", "task.assigned", "task.assigned", "task.assigned"]);
  assert.deepEqual(h.events.slice(1).map((e) => e.payload.slot), ["assigned", "reviewer", "approver"]);
  assert.equal(w.task.due, NOW + DAY);
  assert.equal(w.task.effort, 30);
  assert.deepEqual(w.task.fileIds, ["fil_one"]);
  assert.equal(w.task.reviewLoops, 0);
  assert.equal(h.events[0]!.opts?.vis, "participants");
  assert.equal(h.events[0]!.subject, `task/${w.task.id}`);
});

test("create refuses what the rules refuse", async () => {
  const h = harness();
  await refused(h.call("tasks.create", newTask({ title: "   " }), me), "validation.precondition_failed", "title_required");
  await refused(h.call("tasks.create", newTask({ reviewer: alice }), me), "validation.precondition_failed", "self_review");
  await refused(h.call("tasks.create", newTask({ approver: alice }), me), "validation.precondition_failed", "self_review");
  await refused(h.call("tasks.create", newTask({ kind: "approve", actions: [{ key: "launch", label: "Launch" }] }), me), "validation.precondition_failed", "unknown_action");
  await refused(h.call("tasks.create", newTask({ dependsOn: ["tsk_missing"] }), me), "validation.precondition_failed", "dependency_missing");
  await refused(h.call("tasks.create", newTask({ parentTaskId: "tsk_missing" }), me), "validation.precondition_failed", "parent_missing");
  h.policy("tasks.allow_self_review", true);
  assert.equal((await h.call("tasks.create", newTask({ reviewer: alice }), me)).task.state, "todo");
  h.policy("tasks.require_human_approver", true);
  await refused(h.call("tasks.create", newTask({ approver: bot }), me), "validation.precondition_failed", "human_approver_required");
  assert.equal((await h.call("tasks.create", newTask({ approver: bob }), me)).task.approver.id, bob.id);
});

test("an agent assignee records the person responsible for it", async () => {
  const h = harness({ calls: { "access.principals.get": () => ({ principal: { owner: cara.id } }) } });
  const id = await mk(h, { assigned: bot });
  assert.deepEqual(h.calls[0], { cap: "access.principals.get", input: { principal: { kind: "agent", id: bot.id } } });
  assert.equal((h.sqlite.prepare("SELECT responsible FROM tasks_core WHERE id = ?").get(id) as { responsible: string }).responsible, cara.id);
  // the owner of the agent may cancel what the agent was given
  const r = await h.call("tasks.transition", { taskId: id, to: "canceled" }, { id: cara.id });
  assert.equal(r.task.state, "canceled");
});

// ---- visibility ----

test("a task is visible to its participants, its creator and its followers; others need a grant", async () => {
  const h = harness({ authorize: (who, _a, r) => who.id === "usr_granted" && r.type === "task" });
  const id = await mk(h);
  await refused(h.call("tasks.get", { taskId: id }, { id: bob.id }), "permission.not_found");
  await refused(h.call("tasks.history", { taskId: id }, { id: bob.id }), "permission.not_found");
  assert.equal((await h.call("tasks.get", { taskId: id }, { id: alice.id })).task.id, id);
  assert.equal((await h.call("tasks.get", { taskId: id }, { id: "usr_granted" })).task.id, id);
  await h.call("tasks.followers.add", { taskId: id, follower: bob.id }, me);
  assert.equal((await h.call("tasks.get", { taskId: id }, { id: bob.id })).task.id, id);
  await refused(h.call("tasks.get", { taskId: "tsk_nothing" }, me), "permission.not_found");
});

// ---- Blocked, dependencies ----

test("Blocked is derived from unmet dependencies and open Unblock children", async () => {
  const h = harness();
  const a = await mk(h);
  const b = await mk(h, { dependsOn: [a] });
  assert.equal((await get(h, b)).blocked, true);
  await h.call("tasks.transition", { taskId: a, to: "doing" }, { id: alice.id });
  await h.call("tasks.transition", { taskId: a, to: "done" }, { id: alice.id });
  assert.equal((await get(h, b)).blocked, false);
  const p = await mk(h);
  const child = await mk(h, { kind: "unblock", parentTaskId: p, assigned: cara });
  assert.equal((await get(h, p)).blocked, true);
  assert.equal((await get(h, child)).blocked, false);
  await h.call("tasks.act", { taskId: child, action: "resolved" }, { id: cara.id });
  assert.equal((await get(h, p)).blocked, false);
  // a canceled dependency is not waited on forever
  const c = await mk(h);
  const d = await mk(h, { dependsOn: [c] });
  await h.call("tasks.transition", { taskId: c, to: "canceled" }, { id: alice.id });
  assert.equal((await get(h, d)).blocked, false);
  // a finished task is never Blocked
  const e = await mk(h, { dependsOn: [await mk(h)] });
  await h.call("tasks.transition", { taskId: e, to: "canceled" }, { id: alice.id });
  assert.equal((await get(h, e)).blocked, false);
});

test("dependencies: add, remove, no self, no cycle, events", async () => {
  const h = harness();
  const a = await mk(h), b = await mk(h);
  await refused(h.call("tasks.dependencies.add", { taskId: a, dependsOnId: a }, me), "validation.precondition_failed", "self_dependency");
  await refused(h.call("tasks.dependencies.add", { taskId: a, dependsOnId: "tsk_nothing" }, me), "validation.precondition_failed", "dependency_missing");
  const r = await h.call("tasks.dependencies.add", { taskId: a, dependsOnId: b }, me);
  assert.deepEqual(r.task.dependsOn, [b]);
  assert.deepEqual(h.events.map((e) => e.payload), [{ taskId: a, op: "added", linkKind: "dependency", linkId: b }]);
  await h.call("tasks.dependencies.add", { taskId: a, dependsOnId: b }, me);
  assert.equal(h.events.length, 0, "adding it twice changes nothing");
  await refused(h.call("tasks.dependencies.add", { taskId: b, dependsOnId: a }, me), "validation.precondition_failed", "dependency_cycle");
  const c = await mk(h);
  await h.call("tasks.dependencies.add", { taskId: b, dependsOnId: c }, me);
  await refused(h.call("tasks.dependencies.add", { taskId: c, dependsOnId: a }, me), "validation.precondition_failed", "dependency_cycle");
  const gone = await h.call("tasks.dependencies.remove", { taskId: a, dependsOnId: b }, me);
  assert.deepEqual(gone.task.dependsOn, []);
  assert.equal(h.events[0]!.payload.op, "removed");
  await h.call("tasks.dependencies.remove", { taskId: a, dependsOnId: b }, me);
  assert.equal(h.events.length, 0);
});

// ---- Needs you ----

test("Needs you: my Ready requests, due today or overdue, and what blocks others", async () => {
  const h = harness();
  const request = await mk(h, { kind: "approve", title: "Approve the invoice" });
  const review = await mk(h, { kind: "review", title: "Review the brief" });
  const overdue = await mk(h, { title: "Overdue work", due: NOW - 2 * DAY });
  const today = await mk(h, { title: "Due this afternoon", due: NOW + HOUR });
  const later = await mk(h, { title: "Due next week", due: NOW + 7 * DAY });
  const blocker = await mk(h, { title: "Blocks someone" });
  await mk(h, { assigned: bob, dependsOn: [blocker] });
  const notMine = await mk(h, { kind: "approve", assigned: bob });
  const waiting = await mk(h, { kind: "approve", title: "Blocked request", dependsOn: [blocker] });
  const reasons = new Map<string, string>();
  const r = await h.call("tasks.needs_you", {}, { id: alice.id });
  for (const i of r.items) reasons.set(i.task.id, i.reason);
  assert.equal(reasons.get(request), "ready");
  assert.equal(reasons.get(review), "ready");
  assert.equal(reasons.get(overdue), "overdue");
  assert.equal(reasons.get(today), "due_today");
  assert.equal(reasons.get(blocker), "blocking");
  assert.equal(reasons.has(later), false, "plain work due later is not in Needs you");
  assert.equal(reasons.has(notMine), false);
  assert.equal(reasons.has(waiting), false, "a blocked request is not Ready");
  assert.equal(r.total, 5);
  assert.deepEqual(r.items.map((i: { reason: string }) => i.reason), ["overdue", "due_today", "blocking", "ready", "ready"]);
  const limited = await h.call("tasks.needs_you", { limit: 2 }, { id: alice.id });
  assert.equal(limited.items.length, 2);
  assert.equal(limited.total, 5);
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: alice.id })).count, 2);
  assert.equal((await h.call("tasks.needs_you", {}, { id: cara.id })).total, 0);
});

test("a snoozed request returns at its time", async () => {
  const h = harness();
  const id = await mk(h, { kind: "approve" });
  await refused(h.call("tasks.snooze", { taskId: id, until: NOW - 1 }, { id: alice.id }), "validation.precondition_failed", "past_time");
  await refused(h.call("tasks.snooze", { taskId: id, until: NOW + HOUR }, { id: bob.id }), "validation.precondition_failed", "wrong_actor");
  const r = await h.call("tasks.snooze", { taskId: id, until: NOW + HOUR }, { id: alice.id });
  assert.equal(r.task.snoozedUntil, NOW + HOUR);
  assert.equal((await h.call("tasks.needs_you", {}, { id: alice.id })).total, 0);
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: alice.id })).count, 0);
  h.advance(2 * HOUR);
  assert.equal((await h.call("tasks.needs_you", {}, { id: alice.id })).total, 1);
  await h.call("tasks.snooze", { taskId: id, until: h.now() + HOUR }, { id: alice.id });
  const cleared = await h.call("tasks.snooze", { taskId: id, until: null }, { id: alice.id });
  assert.equal(cleared.task.snoozedUntil, undefined);
  assert.equal((await h.call("tasks.needs_you", {}, { id: alice.id })).total, 1);
  const work = await mk(h);
  await refused(h.call("tasks.snooze", { taskId: work, until: h.now() + HOUR }, { id: alice.id }), "validation.precondition_failed", "not_a_request");
});

// ---- My work and lists ----

test("My work has Open, Assigned by me and Done with counts", async () => {
  const h = harness();
  const open = await mk(h, { title: "Open one" });
  const done = await mk(h, { title: "Finished one" });
  await h.call("tasks.transition", { taskId: done, to: "doing" }, { id: alice.id });
  await h.call("tasks.transition", { taskId: done, to: "done" }, { id: alice.id });
  const byMe = await mk(h, { title: "I gave this to Bob", assigned: bob }, { id: alice.id });
  const all = await h.call("tasks.my_work", { section: "all" }, { id: alice.id });
  assert.deepEqual(all.counts, { open: 1, assignedByMe: 1, done: 1 });
  assert.equal(all.total, 3);
  assert.deepEqual(ids((await h.call("tasks.my_work", { section: "open" }, { id: alice.id })).tasks), [open]);
  assert.deepEqual(ids((await h.call("tasks.my_work", { section: "assigned_by_me" }, { id: alice.id })).tasks), [byMe]);
  assert.deepEqual(ids((await h.call("tasks.my_work", { section: "done" }, { id: alice.id })).tasks), [done]);
  assert.deepEqual(ids((await h.call("tasks.my_work", {}, { id: alice.id })).tasks), [open]);
  assert.deepEqual((await h.call("tasks.my_work", { section: "all" }, { id: cara.id })).counts, { open: 0, assignedByMe: 0, done: 0 });
});

test("lists by scope, filter and page", async () => {
  const h = harness();
  const t1 = await mk(h, { title: "one", recordId: "rec_abc" });
  const t2 = await mk(h, { title: "two", assigned: bob, recordId: "rec_abc" });
  const t3 = await mk(h, { title: "three", kind: "approve", source: { kind: "run", id: "run_1" } });
  const t4 = await mk(h, { title: "four", assigned: cara }, { id: alice.id });
  await h.call("tasks.followers.add", { taskId: t2, follower: alice.id }, me);
  const list = async (input: Record<string, unknown>, who = me): Promise<string[]> => ids((await h.call("tasks.list", input, who)).tasks);
  assert.deepEqual(await list({ scope: "mine" }, { id: alice.id }), ids([{ id: t1 }, { id: t3 }]));
  assert.deepEqual(await list({ scope: "assigned_by_me" }, me), ids([{ id: t1 }, { id: t2 }, { id: t3 }]));
  assert.deepEqual(await list({ scope: "assigned_by_me" }, { id: alice.id }), [t4]);
  assert.deepEqual(await list({ scope: "following" }, { id: alice.id }), [t2]);
  assert.deepEqual(await list({ scope: "record", recordId: "rec_abc" }), ids([{ id: t1 }, { id: t2 }]));
  assert.deepEqual(await list({ scope: "record" }), []);
  assert.deepEqual(await list({ scope: "run", runId: "run_1" }), [t3]);
  assert.deepEqual(await list({ scope: "all", kinds: ["approve"] }), [t3]);
  assert.deepEqual(await list({ scope: "all", assignee: bob }), [t2]);
  assert.deepEqual(await list({ scope: "all", states: ["done"] }), []);
  // strangers see none of it
  assert.deepEqual(await list({ scope: "all" }, { id: "usr_stranger" }), []);
  // pages
  const p1 = await h.call("tasks.list", { scope: "all", limit: 2 }, me);
  assert.equal(p1.tasks.length, 2);
  assert.equal(p1.total, 3, "the owner sees the three tasks they made, not the one Alice made");
  assert.equal(p1.next, "2");
  const p2 = await h.call("tasks.list", { scope: "all", limit: 2, cursor: p1.next }, me);
  assert.equal(p2.tasks.length, 1);
  assert.equal(p2.next, undefined);
  // snoozed requests are hidden unless asked for
  await h.call("tasks.snooze", { taskId: t3, until: NOW + HOUR }, { id: alice.id });
  assert.equal((await list({ scope: "all" })).includes(t3), false);
  assert.equal((await list({ scope: "all", includeSnoozed: true })).includes(t3), true);
});

// ---- Take and release ----

test("Take locks a group or role task to one person and Release gives it back", async () => {
  const h = harness({ authorize: () => true });
  const id = await mk(h, { assigned: finance });
  const person = await mk(h, { assigned: alice });
  await refused(h.call("tasks.take", { taskId: person }, { id: alice.id }), "validation.precondition_failed", "not_shared");
  const r = await h.call("tasks.take", { taskId: id }, { id: alice.id });
  assert.equal(r.task.takenBy, alice.id);
  assert.deepEqual(names(h), ["task.taken"]);
  await h.call("tasks.take", { taskId: id }, { id: alice.id });
  assert.equal(h.events.length, 0, "taking it again changes nothing");
  await refused(h.call("tasks.take", { taskId: id }, { id: bob.id }), "validation.precondition_failed", "taken");
  await refused(h.call("tasks.release", { taskId: id }, { id: bob.id }), "validation.precondition_failed", "wrong_actor");
  const back = await h.call("tasks.release", { taskId: id }, { id: alice.id });
  assert.equal(back.task.takenBy, undefined);
  assert.deepEqual(names(h), ["task.released"]);
  await refused(h.call("tasks.release", { taskId: id }, { id: alice.id }), "validation.precondition_failed", "not_taken");
  await h.call("tasks.take", { taskId: id }, { id: bob.id });
  await h.call("tasks.transition", { taskId: id, to: "doing" }, { id: bob.id });
  await h.call("tasks.transition", { taskId: id, to: "done" }, { id: bob.id });
  await refused(h.call("tasks.take", { taskId: id }, { id: alice.id }), "validation.precondition_failed", "closed");
});

// ---- withdraw ----

test("a stopped chat or run withdraws its open requests with a note", async () => {
  const h = harness();
  const r1 = await mk(h, { kind: "approve", source: { kind: "chat", id: "thr_1" } });
  const r2 = await mk(h, { kind: "answer", assigned: bob, source: { kind: "chat", id: "thr_1" } });
  const work = await mk(h, { source: { kind: "chat", id: "thr_1" } });
  const other = await mk(h, { kind: "approve", source: { kind: "chat", id: "thr_2" } });
  await refused(h.call("tasks.withdraw", { note: "x" }, svc), "validation.bad_input");
  await refused(h.call("tasks.withdraw", { sourceKind: "chat", sourceId: "thr_1", note: "  " }, svc), "validation.precondition_failed", "note_required");
  const r = await h.call("tasks.withdraw", { sourceKind: "chat", sourceId: "thr_1", note: "The chat was stopped" }, svc);
  assert.equal(r.withdrawn, 2);
  assert.deepEqual(names(h), ["task.withdrawn", "task.withdrawn"]);
  assert.deepEqual(h.events.map((e) => e.payload.sourceId), ["thr_1", "thr_1"]);
  assert.equal((await get(h, r1)).state, "canceled");
  assert.equal((await get(h, r2)).state, "canceled");
  assert.equal((await get(h, work)).state, "todo", "plain tasks are not requests");
  assert.equal((await get(h, other)).state, "awaiting_approval");
  assert.equal((await h.call("tasks.withdraw", { sourceKind: "chat", sourceId: "thr_1", note: "again" }, svc)).withdrawn, 0);
  assert.equal((await h.call("tasks.withdraw", { taskId: other, note: "The item changed" }, svc)).withdrawn, 1);
  assert.equal((await get(h, other)).state, "canceled");
});

// ---- followers, notes, links, update, assign ----

test("followers and working notes", async () => {
  const h = harness();
  const id = await mk(h);
  const f = await h.call("tasks.followers.add", { taskId: id, follower: bob.id }, me);
  assert.deepEqual(f.task.followers, [bob.id]);
  assert.deepEqual(names(h), ["task.follower_added"]);
  await h.call("tasks.followers.add", { taskId: id, follower: bob.id }, me);
  assert.equal(h.events.length, 0);
  const g = await h.call("tasks.followers.remove", { taskId: id, follower: bob.id }, me);
  assert.deepEqual(g.task.followers, []);
  assert.deepEqual(names(h), ["task.follower_removed"]);
  await h.call("tasks.followers.remove", { taskId: id, follower: bob.id }, me);
  assert.equal(h.events.length, 0);

  const n = await h.call("tasks.working_notes.set", { taskId: id, key: "client", value: "Lee" }, { id: alice.id });
  assert.deepEqual(n.task.workingNotes, { client: "Lee" });
  assert.deepEqual(h.events[0]!.payload, { taskId: id, key: "client", by: alice.id });
  await h.call("tasks.working_notes.set", { taskId: id, key: "court", value: "Superior" }, { id: bot.id, kind: "agent" });
  const d = await h.call("tasks.working_notes.delete", { taskId: id, key: "client" }, { id: alice.id });
  assert.deepEqual(d.task.workingNotes, { court: "Superior" });
  await h.call("tasks.working_notes.delete", { taskId: id, key: "client" }, { id: alice.id });
  assert.equal(h.events.length, 0);
  await refused(h.call("tasks.working_notes.set", { taskId: id, key: "  ", value: "x" }, me), "validation.bad_input");
});

test("links to records and files", async () => {
  const h = harness();
  const id = await mk(h);
  const a = await h.call("tasks.links.add", { taskId: id, recordId: "rec_one" }, me);
  assert.equal(a.task.recordId, "rec_one");
  assert.deepEqual(h.events.map((e) => e.payload), [{ taskId: id, op: "added", linkKind: "record", linkId: "rec_one" }]);
  await h.call("tasks.links.add", { taskId: id, recordId: "rec_one" }, me);
  assert.equal(h.events.length, 0);
  const b = await h.call("tasks.links.add", { taskId: id, recordId: "rec_two" }, me);
  assert.equal(b.task.recordId, "rec_two");
  assert.deepEqual(h.events.map((e) => `${e.payload.op}:${e.payload.linkId}`), ["removed:rec_one", "added:rec_two"]);
  const c = await h.call("tasks.links.add", { taskId: id, fileId: "fil_one" }, me);
  assert.deepEqual(c.task.fileIds, ["fil_one"]);
  await refused(h.call("tasks.links.add", { taskId: id }, me), "validation.bad_input");
  await refused(h.call("tasks.links.add", { taskId: id, recordId: "rec_a", fileId: "fil_a" }, me), "validation.bad_input");
  await h.call("tasks.links.remove", { taskId: id, recordId: "rec_other" }, me);
  assert.equal(h.events.length, 0, "removing a link it does not have changes nothing");
  const d = await h.call("tasks.links.remove", { taskId: id, fileId: "fil_one" }, me);
  assert.deepEqual(d.task.fileIds, []);
  const e = await h.call("tasks.links.remove", { taskId: id, recordId: "rec_two" }, me);
  assert.equal(e.task.recordId, undefined);
  assert.equal(h.events[0]!.payload.op, "removed");
});

test("update changes the fields it is given and nothing else", async () => {
  const h = harness();
  const id = await mk(h, { summary: "old", due: NOW + DAY });
  const r = await h.call("tasks.update", { taskId: id, title: "New title", summary: "new", due: null, effort: 45, blocks: [{ type: "checklist", data: { items: ["a"] } }] }, { id: alice.id });
  assert.equal(r.task.title, "New title");
  assert.equal(r.task.summary, "new");
  assert.equal(r.task.due, undefined);
  assert.equal(r.task.effort, 45);
  assert.equal(r.task.blocks.length, 1);
  assert.deepEqual(names(h), ["task.updated"]);
  assert.deepEqual([...(h.events[0]!.payload.fields as string[])].sort(), ["blocks", "due", "effort", "summary", "title"]);
  assert.equal(r.task.state, "todo", "status goes through tasks.transition");
  await h.call("tasks.update", { taskId: id, title: "New title" }, { id: alice.id });
  assert.equal(h.events.length, 0, "no change, no event");
  await refused(h.call("tasks.update", { taskId: id, title: "  " }, { id: alice.id }), "validation.precondition_failed", "title_required");
  await h.call("tasks.transition", { taskId: id, to: "canceled" }, { id: alice.id });
  await refused(h.call("tasks.update", { taskId: id, title: "Too late" }, { id: alice.id }), "validation.precondition_failed", "closed");
});

test("assign sets and clears the three slots under the rules", async () => {
  const h = harness();
  const id = await mk(h);
  const r = await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: bob }, me);
  assert.deepEqual(r.task.reviewer, bob);
  assert.deepEqual(h.events[0]!.payload, { taskId: id, slot: "reviewer", to: bob, from: null });
  await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: bob }, me);
  assert.equal(h.events.length, 0);
  await refused(h.call("tasks.assign", { taskId: id, slot: "assigned", to: null }, me), "validation.precondition_failed", "assigned_required");
  await refused(h.call("tasks.assign", { taskId: id, slot: "approver", to: alice }, me), "validation.precondition_failed", "self_review");
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await refused(h.call("tasks.assign", { taskId: id, slot: "reviewer", to: null }, me), "validation.precondition_failed", "slot_in_use");
  const moved = await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: cara }, me);
  assert.deepEqual(moved.task.reviewer, cara);
  assert.deepEqual(h.events[0]!.payload.from, bob);
  assert.equal((await h.call("tasks.transition", { taskId: id, to: "done" }, { id: cara.id })).task.state, "done");
  await refused(h.call("tasks.assign", { taskId: id, slot: "approver", to: bob }, me), "validation.precondition_failed", "closed");
});

test("handing the work slot to someone else clears a Take", async () => {
  const h = harness({ authorize: () => true });
  const id = await mk(h, { assigned: finance });
  await h.call("tasks.take", { taskId: id }, { id: alice.id });
  const r = await h.call("tasks.assign", { taskId: id, slot: "assigned", to: bob }, me);
  assert.equal(r.task.takenBy, undefined);
});

test("history lists what happened, newest first, in pages", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("tasks.transition", { taskId: id, to: "doing" }, { id: alice.id });
  await h.call("tasks.transition", { taskId: id, to: "done" }, { id: alice.id });
  const all = await h.call("tasks.history", { taskId: id }, me);
  assert.deepEqual(all.entries.map((e: { type: string }) => e.type), ["completed", "transitioned", "transitioned", "assigned", "created"]);
  assert.equal(all.total, 5);
  assert.ok(all.entries.every((e: { eventId: string; by: string }) => /^evt_[a-z0-9]+$/.test(e.eventId) && e.by.length > 0));
  const p = await h.call("tasks.history", { taskId: id, limit: 2 }, me);
  assert.equal(p.entries.length, 2);
  assert.equal(p.next, "2");
  const q = await h.call("tasks.history", { taskId: id, limit: 2, cursor: p.next }, me);
  assert.equal(q.entries[0].type, all.entries[2].type);
});

// ---- review loops ----

test("an agent reviewer may send work back twice, then a person decides", async () => {
  const h = harness();
  const id = await mk(h, { reviewer: bot });
  const agent = { id: bot.id, kind: "agent" as const };
  for (let loop = 1; loop <= 2; loop++) {
    await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
    const r = await h.call("tasks.transition", { taskId: id, to: "doing", note: `round ${loop}` }, agent);
    assert.equal(r.task.reviewLoops, loop);
    assert.equal(h.events.find((e) => e.name === "task.sent_back")?.payload.reviewLoops, loop);
  }
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await refused(h.call("tasks.transition", { taskId: id, to: "doing", note: "round 3" }, agent), "validation.precondition_failed", "review_loop_limit");
  assert.equal((await get(h, id)).state, "in_review");
  // a person takes the reviewer seat and decides
  await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: bob }, me);
  const r = await h.call("tasks.transition", { taskId: id, to: "doing", note: "still not right" }, { id: bob.id });
  assert.equal(r.task.reviewLoops, 3);
});

test("the review loop limit is a Space setting", async () => {
  const h = harness();
  h.policy("tasks.review_loop_limit", 1);
  const id = await mk(h, { reviewer: bot });
  const agent = { id: bot.id, kind: "agent" as const };
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await h.call("tasks.transition", { taskId: id, to: "doing", note: "once" }, agent);
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await refused(h.call("tasks.transition", { taskId: id, to: "doing", note: "twice" }, agent), "validation.precondition_failed", "review_loop_limit");
});

test("a Space can require a person to approve, and nobody approves their own work", async () => {
  const h = harness();
  h.policy("tasks.require_human_approver", true);
  const id = await mk(h, { reviewer: bob, approver: cara });
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  await h.call("tasks.transition", { taskId: id, to: "awaiting_approval" }, { id: bob.id });
  await refused(h.call("tasks.transition", { taskId: id, to: "done" }, { id: cara.id, kind: "agent" }), "validation.precondition_failed", "human_approver_required");
  assert.equal((await h.call("tasks.transition", { taskId: id, to: "done" }, { id: cara.id })).task.state, "done");
  // the person doing the work cannot approve it even when the Space lets a reviewer slot be filled by anyone
  const h2 = harness();
  const w = await mk(h2, { reviewer: bob });
  await h2.call("tasks.assign", { taskId: w, slot: "reviewer", to: cara }, me);
  await h2.call("tasks.transition", { taskId: w, to: "in_review" }, { id: alice.id });
  await refused(h2.call("tasks.transition", { taskId: w, to: "done" }, { id: alice.id }), "validation.precondition_failed", "wrong_actor");
});
// P-H_02 final run: this file shows its own ok line in the run on the last commit.
