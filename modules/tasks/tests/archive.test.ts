// Living tasks, the archive mark (lane r42-alive): a task that no longer matters is put away with its reason and never deleted. It keeps its state, leaves Needs you, My work, the long list, the
// count and the clock, and stays in tasks.get, in a search and in the Archived list. Put back is one write. Archiving never strands a waiter: a held act, a task a Run waits on and a task other
// work waits on are refused, so they go through the cancel path that tells whoever waits.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { DAY, alice, as, bob, bot, newTask } from "../fixtures/seed.ts";

const me = { id: alice.id };
const svc = { id: "svc_host", kind: "service" as const };
type Row = { id: string; archived?: { at: number; by: string; code: string; why: string }; yourTurn?: boolean };

async function mk(
  h: Harness,
  over: Record<string, unknown> = {},
  who: Parameters<Harness["call"]>[2] = me,
): Promise<string> {
  return (await h.call("tasks.create", newTask(over), who)).task.id as string;
}
const get = async (h: Harness, id: string, who = me): Promise<any> =>
  (await h.call("tasks.get", { taskId: id }, who)).task; // eslint-disable-line @typescript-eslint/no-explicit-any
const ids = (rows: Row[]): string[] => rows.map((r) => r.id);
async function refused(p: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(p, (e) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    assert.equal(reasonOf(e), reason);
    return true;
  });
}

test("an archived task leaves Needs you, My work, the long list and the count, and says who put it away and why", async () => {
  const h = harness();
  // work Bob gave Alice and nobody started: the next move is hers, so it is in Needs you and on the badge
  const id = await mk(h, { title: "Send the meeting link for the 2pm call" }, { id: bob.id });
  assert.equal((await h.call("tasks.count_needs_you", {}, me)).count, 1);
  const before = (await h.call("tasks.rev", {}, me)).rev;

  const put = (await h.call("tasks.archive", { taskId: id, why: "The call was on Thursday" }, me)).task;
  assert.deepEqual(put.archived, { at: h.now(), by: alice.id, code: "hand", why: "The call was on Thursday" });
  assert.equal(put.state, "todo", "it keeps the state it had");
  assert.equal(put.yourTurn, undefined);
  const ev = h.events.find((e) => e.name === "task.archived");
  assert.deepEqual(ev?.payload, {
    taskId: id,
    title: "Send the meeting link for the 2pm call",
    code: "hand",
    why: "The call was on Thursday",
    by: alice.id,
  });

  assert.equal((await h.call("tasks.count_needs_you", {}, me)).count, 0);
  assert.equal((await h.call("tasks.needs_you", {}, me)).total, 0);
  assert.deepEqual((await h.call("tasks.my_work", {}, me)).counts, { open: 0, assignedByMe: 0, done: 0 });
  assert.equal((await h.call("tasks.index", { scope: "mine" }, me)).rows.length, 0);
  assert.equal((await h.call("tasks.list", { scope: "mine" }, me)).tasks.length, 0);
  assert.notEqual((await h.call("tasks.rev", {}, me)).rev, before, "a screen that watches the revision sees it go");

  // it is not gone: the task itself, the Archived list and its history all have it
  assert.equal((await get(h, id)).archived.why, "The call was on Thursday");
  const arch = (await h.call("tasks.index", { scope: "mine", archived: true }, me)).rows as Row[];
  assert.deepEqual(ids(arch), [id]);
  assert.equal(arch[0]!.archived!.code, "hand");
  const hist = (await h.call("tasks.history", { taskId: id }, me)).entries as { type: string; note?: string }[];
  assert.ok(hist.some((x) => x.type === "archived:hand" && x.note === "The call was on Thursday"));
});

test("Put back returns the task exactly as it was, to every list", async () => {
  const h = harness();
  const id = await mk(h, { due: h.now() + 3 * DAY, priority: "high" });
  await h.call("tasks.transition", { taskId: id, to: "doing" }, me);
  await h.call("tasks.archive", { taskId: id }, me);
  assert.equal((await get(h, id)).archived.why, "", "by hand, no reason is asked for");

  const back = (await h.call("tasks.unarchive", { taskId: id }, me)).task;
  assert.equal(back.archived, undefined);
  assert.deepEqual([back.state, back.priority, back.due], ["doing", "high", h.now() + 3 * DAY]);
  assert.deepEqual(h.events.find((e) => e.name === "task.unarchived")?.payload, { taskId: id, code: "hand" });
  assert.deepEqual(ids((await h.call("tasks.index", { scope: "mine" }, me)).rows), [id]);
  assert.equal((await h.call("tasks.index", { scope: "mine", archived: true }, me)).rows.length, 0);
  // both are safe to press twice
  assert.equal((await h.call("tasks.unarchive", { taskId: id }, me)).task.archived, undefined);
  await h.call("tasks.archive", { taskId: id, why: "first" }, me);
  assert.equal((await h.call("tasks.archive", { taskId: id, why: "second" }, me)).task.archived.why, "first");
});

test("a search finds an archived task and marks it", async () => {
  const h = harness();
  const kept = await mk(h, { title: "Renew the domain" });
  const put = await mk(h, { title: "Renew the old domain" });
  await h.call("tasks.archive", { taskId: put, why: "The old site is gone" }, me);
  const found = (await h.call("tasks.index", { scope: "mine", q: "domain" }, me)).rows as Row[];
  assert.deepEqual(ids(found).sort(), [kept, put].sort());
  assert.equal(found.find((r) => r.id === put)!.archived!.why, "The old site is gone");
  assert.equal(found.find((r) => r.id === kept)!.archived, undefined);
});

test("only someone on the task may archive it or put it back, and a closed task is closed already", async () => {
  const h = harness();
  const id = await mk(h);
  // someone who cannot see the task is told only that it is not available
  await assert.rejects(h.call("tasks.archive", { taskId: id }, { id: "usr_stranger" }), (e) => {
    assert.equal(codeOf(e), "permission.not_found");
    return true;
  });
  // a follower sees it and is not on it
  await h.call("tasks.followers.add", { taskId: id, follower: bob.id }, me);
  await refused(h.call("tasks.archive", { taskId: id }, { id: bob.id }), "wrong_actor");
  await h.call("tasks.archive", { taskId: id }, me);
  await refused(h.call("tasks.unarchive", { taskId: id }, { id: bob.id }), "wrong_actor");
  const done = await mk(h);
  await h.call("tasks.transition", { taskId: done, to: "done" }, me);
  await refused(h.call("tasks.archive", { taskId: done }, me), "closed");
});

test("archiving never strands a waiter: a held act, a task a Run waits on and a task other work waits on are refused", async () => {
  const h = harness();
  // a held act is made the way the Gate makes it: by the server
  const held = await mk(
    h,
    { kind: "approve", source: { kind: "gate", id: "dec_1" } },
    { id: "svc_host", kind: "service" },
  );
  await refused(h.call("tasks.archive", { taskId: held }, me), "held_act");
  const run = await mk(h, { source: { kind: "run", id: "run_1" } });
  await refused(h.call("tasks.archive", { taskId: run }, me), "run_waits");
  const first = await mk(h, { title: "Draft the quote" });
  await mk(h, { title: "Send the quote", dependsOn: [first] });
  await refused(h.call("tasks.archive", { taskId: first }, me), "others_wait");
  for (const id of [held, run, first]) assert.equal((await get(h, id)).archived, undefined);
});

test("the clock says nothing about an archived task", async () => {
  const h = harness();
  const id = await mk(h, { due: h.now() + 60_000 });
  await h.call("tasks.archive", { taskId: id }, me);
  h.advance(2 * 60_000);
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 0);
  await h.call("tasks.unarchive", { taskId: id }, me);
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 1, "back on the list, its due time is said");
});

test("a task that moves is not put away any more", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("tasks.archive", { taskId: id }, me);
  const moved = (await h.call("tasks.transition", { taskId: id, to: "doing" }, me)).task;
  assert.equal(moved.archived, undefined);
  assert.deepEqual(ids((await h.call("tasks.index", { scope: "mine" }, me)).rows), [id]);
});

test("an archived child does not hold its parent's rollup open", async () => {
  const h = harness();
  const parent = await mk(h, { title: "Launch the page" });
  const a = await mk(h, { title: "Write the copy", parentTaskId: parent });
  const b = await mk(h, { title: "Pick the old photos", parentTaskId: parent });
  await h.call("tasks.transition", { taskId: a, to: "done" }, me);
  await h.call("tasks.archive", { taskId: b, why: "The page uses no photos" }, me);
  const row = ((await h.call("tasks.index", { scope: "mine" }, me)).rows as (Row & { children?: unknown })[]).find(
    (r) => r.id === parent,
  );
  assert.deepEqual(row?.children, { total: 1, done: 1 });
});

test("putting back a task an agent archived keeps a lesson for that agent; a person's own teaches nothing", async () => {
  const h = harness();
  h.callee("memory.corrections.record", () => ({ kept: true }));
  const made = (await h.call("tasks.create", newTask({ assigned: alice, title: "Chase the late invoice" }), as(bot)))
    .task;
  await h.call("tasks.archive", { taskId: made.id, why: "It looked paid" }, as(bot));
  await h.call("tasks.unarchive", { taskId: made.id }, as(alice));
  const c = h.calls.filter((x) => x.cap === "memory.corrections.record");
  assert.equal(c.length, 1);
  const input = c[0]!.input as Record<string, unknown>;
  assert.equal(input["agentId"], bot.id);
  assert.match(String(input["was"]), /archived the task "Chase the late invoice"/);

  const own = await mk(h);
  await h.call("tasks.archive", { taskId: own }, me);
  await h.call("tasks.unarchive", { taskId: own }, me);
  assert.equal(h.calls.filter((x) => x.cap === "memory.corrections.record").length, 1);
});
