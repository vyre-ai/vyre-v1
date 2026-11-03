// The audit's probes of Tasks (l-tasks), as tests: your turn reaches you, a team task is taken and seats its taker, a snooze ends by itself, "due today" is the person's own day,
// the handlers that change a task check who is calling, and Tasks finds words in a brief. Each failed on polish/launch before this lane.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, cara, owner, support, newTask, NOW, DAY } from "../fixtures/seed.ts";
import { findTask } from "../projections.ts";
import { revOf } from "../handlers/index-read.ts";

const me = { id: owner.id };
const HOUR = 3_600_000;

function withThreads(o: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(o);
  h.callee("chat.start", (i: { scopeId: string }) => ({ thread: { threadId: `thr_${i.scopeId.slice(4)}` } }));
  h.callee("threads.members.add", () => ({}));
  h.callee("threads.add_agent", () => ({}));
  h.callee("chat.post", () => ({ message: {} }));
  h.callee("threads.members.remove", () => ({}));
  h.callee("threads.remove_agent", () => ({}));
  return h;
}
async function refused(p: Promise<unknown>, reason: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.equal(reasonOf(e), reason); return true; });
}

test("probe 1: a person reviewer of handed-in work is asked, sees it in Needs you, and the count says so", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ assigned: alice, reviewer: bob, approver: cara }), me)).task.id as string;
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: bob.id })).count, 0, "nothing for the reviewer before the hand-in");
  await h.call("tasks.submit", { taskId: id, summary: "Drafted it" }, { id: alice.id });
  const asked = h.events.find((e) => e.name === "task.requested");
  assert.ok(asked, "the hand-in asks the reviewer");
  assert.deepEqual(asked.payload.assigned, bob);
  assert.equal(asked.payload.step, "review");
  assert.equal(asked.payload.by, alice.id);
  const n = await h.call("tasks.needs_you", {}, { id: bob.id });
  assert.equal(n.total, 1);
  assert.equal(n.items[0].yourTurn, true);
  assert.equal(n.items[0].task.yourTurn, true);
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: bob.id })).count, 1);
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: alice.id })).count, 0, "the doer waits now");
  await h.call("tasks.review", { taskId: id, verdict: "approve" }, { id: bob.id });
  assert.equal(h.events.find((e) => e.name === "task.requested")?.payload.step, "approval", "approving the review asks the approver");
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: cara.id })).count, 1);
  await h.call("tasks.decide", { taskId: id, verdict: "reject", reason: "Wrong date" }, { id: cara.id });
  const back = h.events.find((e) => e.name === "task.requested");
  assert.equal(back?.payload.step, "work", "a send back asks the doer again");
  assert.deepEqual(back?.payload.assigned, alice);
  assert.equal((await h.call("tasks.needs_you", {}, { id: alice.id })).items[0].yourTurn, true);
});

test("probe 2: assigning a slot carries the task's title and who did it", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ title: "Call Lee" }), me)).task.id as string;
  await h.call("tasks.assign", { taskId: id, slot: "approver", to: cara }, me);
  assert.deepEqual(h.events[0]!.payload, { taskId: id, slot: "approver", to: cara, from: null, title: "Call Lee", by: owner.id });
});

test("probe 3: taking a team task seats the taker in its thread; starting one untaken takes it", async () => {
  const h = withThreads({ authorize: () => true });
  const id = (await h.call("tasks.create", newTask({ assigned: support }), me)).task.id as string;
  assert.equal((await h.call("tasks.needs_you", {}, { id: bob.id })).items.find((i: { task: { id: string } }) => i.task.id === id)?.yourTurn, true, "offered to every member");
  h.threadCalls.length = 0;
  await h.call("tasks.take", { taskId: id }, { id: bob.id });
  assert.ok(h.threadCalls.some((c) => c.cap === "threads.members.add" && (c.input as { personId: string }).personId === bob.id), "the taker joins the thread");
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: cara.id })).count, 0, "taken, it is nobody else's turn");
  const other = (await h.call("tasks.create", newTask({ assigned: support }), me)).task.id as string;
  h.threadCalls.length = 0;
  await h.call("tasks.transition", { taskId: other, to: "doing" }, { id: cara.id });
  assert.equal(findTask(h.db, other)!.takenBy, cara.id, "the member who started it has it");
  assert.ok(h.threadCalls.some((c) => c.cap === "threads.members.add" && (c.input as { personId: string }).personId === cara.id));
});

test("probe 4: a snooze ends by itself: the clock clears it, the revision moves and the list shows it again", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask(), me)).task.id as string;
  await h.call("tasks.snooze", { taskId: id, until: NOW + HOUR }, { id: alice.id });
  const held = (await h.call("tasks.index", { scope: "mine" }, { id: alice.id })) as { rev: string; rows: Array<{ id: string }> };
  assert.equal(held.rows.some((r) => r.id === id), false);
  assert.deepEqual((await h.call("tasks.index", { scope: "mine", snoozed: true }, { id: alice.id })).rows.map((r: { id: string }) => r.id), [id], "a Snoozed list finds it before then");
  h.advance(HOUR + 1);
  const r = await h.call("tasks.clock", {}, { id: "svc_host", kind: "service" });
  assert.equal(r.woke, 1);
  assert.notEqual(revOf(h.db), held.rev);
  const again = await h.call("tasks.index", { scope: "mine", rev: held.rev }, { id: alice.id });
  assert.equal(again.unchanged, false);
  assert.equal(again.rows.some((x: { id: string }) => x.id === id), true);
  assert.equal(findTask(h.db, id)!.snoozedUntil, undefined);
});

test("probe 6: due today is the person's own day: 02:00 UTC tomorrow is today in Karachi at 22:00 UTC, not in London", async () => {
  const at22 = Math.floor(NOW / DAY) * DAY + 22 * HOUR;
  const h = withThreads({ now: at22 });
  h.db.run("INSERT INTO tasks_tz (person, tz) VALUES (?, ?)", alice.id, "Asia/Karachi");
  const due = Math.floor(NOW / DAY) * DAY + DAY + 2 * HOUR;
  const a = (await h.call("tasks.create", newTask({ title: "For Alice", due }), me)).task.id as string;
  const b = (await h.call("tasks.create", newTask({ title: "For Bob", assigned: bob, due }), me)).task.id as string;
  assert.equal((await h.call("tasks.needs_you", {}, { id: alice.id })).items.find((i: { task: { id: string } }) => i.task.id === a)?.reason, "due_today");
  assert.notEqual((await h.call("tasks.needs_you", {}, { id: bob.id })).items.find((i: { task: { id: string } }) => i.task.id === b)?.reason, "due_today");
});

test("a time zone set in Settings reaches tasks through settings.changed", async () => {
  const { consumers } = await import("../impl.ts");
  const h = harness();
  const ctx = h.ctxFor("tasks.get", { id: "svc_host", kind: "service" });
  await consumers["tasks.settings_sync"].run(ctx, { payload: { key: "profile.timezone", scope: "person", person: alice.id, after: "Asia/Karachi" } });
  assert.deepEqual(h.db.all("SELECT tz FROM tasks_tz WHERE person = ?", alice.id).map((r) => ({ ...(r as object) })), [{ tz: "Asia/Karachi" }]);
  await consumers["tasks.settings_sync"].run(ctx, { payload: { key: "profile.timezone", scope: "person", person: alice.id, after: "UTC" } });
  assert.deepEqual(h.db.all("SELECT tz FROM tasks_tz WHERE person = ?", alice.id), []);
});

test("probe 7: the handlers that change a task check who is calling", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask(), me)).task.id as string;
  const other = (await h.call("tasks.create", newTask({ title: "Other" }), me)).task.id as string;
  await refused(h.call("tasks.update", { taskId: id, title: "Mine now" }, { id: bob.id }), "wrong_actor");
  await refused(h.call("tasks.assign", { taskId: id, slot: "assigned", to: bob }, { id: bob.id }), "wrong_actor");
  await refused(h.call("tasks.followers.add", { taskId: id, follower: cara.id }, { id: bob.id }), "wrong_actor");
  await refused(h.call("tasks.links.add", { taskId: id, recordId: "rec_x1" }, { id: bob.id }), "wrong_actor");
  await refused(h.call("tasks.dependencies.add", { taskId: id, dependsOnId: other }, { id: bob.id }), "wrong_actor");
  assert.equal(findTask(h.db, id)!.title, "Draft the engagement letter");
  assert.deepEqual(findTask(h.db, id)!.assigned, alice);
  // someone on it may; the server may; following yourself needs only to see it
  await h.call("tasks.update", { taskId: id, title: "Draft it" }, { id: alice.id });
  await h.call("tasks.followers.add", { taskId: id, follower: cara.id }, { id: "svc_host", kind: "service" });
  await h.call("tasks.followers.add", { taskId: id, follower: cara.id }, { id: cara.id });
  assert.equal(findTask(h.db, id)!.title, "Draft it");
});

test("a thread linked later seats the slots, and anyone who sees the task may link it", async () => {
  const h = withThreads();
  h.callee("chat.start", () => { throw new Error("chat is down"); });
  const id = (await h.call("tasks.create", newTask({ reviewer: bob }), me)).task.id as string;
  assert.equal(findTask(h.db, id)!.threadId, undefined);
  h.threadCalls.length = 0;
  await h.call("tasks.update", { taskId: id, threadId: "thr_later1" }, { id: bob.id });
  const seated = h.threadCalls.filter((c) => c.cap === "threads.members.add").map((c) => (c.input as { personId: string }).personId).sort();
  assert.deepEqual(seated, [alice.id, bob.id]);
});

test("the clock: the due day begins at the holder's midnight, the due time passes, each said once", async () => {
  // Wednesday 10:00 in Karachi is 05:00 UTC; its day begins at 19:00 UTC the evening before
  const day = Math.floor(NOW / DAY) * DAY;
  const due = day + DAY + 5 * HOUR;
  const h = withThreads({ now: day + 12 * HOUR });
  h.db.run("INSERT INTO tasks_tz (person, tz) VALUES (?, ?)", alice.id, "Asia/Karachi");
  const id = (await h.call("tasks.create", newTask({ title: "File the return", due }), me)).task.id as string;
  const svc = { id: "svc_host", kind: "service" as const };
  h.setNow(day + 19 * HOUR - 60_000);
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 0, "a minute before her midnight: nothing");
  h.setNow(day + 19 * HOUR);
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 1);
  const ev = h.events.find((e) => e.name === "task.due")!;
  assert.deepEqual({ at: ev.payload.at, holder: ev.payload.holder, title: ev.payload.title }, { at: "day", holder: alice, title: "File the return" });
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 0, "said once");
  h.setNow(due);
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 1);
  assert.equal(h.events.find((e) => e.name === "task.due")!.payload.at, "time");
  assert.equal((await h.call("tasks.clock", {}, svc)).due, 0);
  assert.ok(findTask(h.db, id));
  await assert.rejects(h.call("tasks.clock", {}, { id: alice.id }), (e) => codeOf(e) === "permission.no_grant");
});

test("people are nudged: a review that sat a day reminds the reviewer once", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ reviewer: bob }), me)).task.id as string;
  await h.call("tasks.submit", { taskId: id, summary: "Done" }, { id: alice.id });
  const svc = { id: "svc_host", kind: "service" as const };
  h.advance(DAY + 1);
  assert.equal((await h.call("tasks.clock", {}, svc)).nudged, 1);
  const ev = h.events.find((e) => e.name === "task.nudged")!;
  assert.deepEqual({ why: ev.payload.why, notify: ev.payload.notify }, { why: "waiting_on_decision", notify: bob.id });
  h.advance(HOUR);
  assert.equal((await h.call("tasks.clock", {}, svc)).nudged, 0, "once per time it sat");
});

test("Tasks finds words in the brief and notes, across every task the reader sees", async () => {
  const h = withThreads();
  await h.call("tasks.create", newTask({ title: "Letter", notes: { brief: "Ask Rivera for the signed retainer" } }), me);
  await h.call("tasks.create", newTask({ title: "Other work" }), me);
  const r = await h.call("tasks.index", { scope: "everyone", q: "signed RETAINER" }, { id: alice.id });
  assert.deepEqual(r.rows.map((x: { title: string }) => x.title), ["Letter"]);
  assert.deepEqual((await h.call("tasks.index", { scope: "everyone", q: "retainer" }, { id: bob.id })).rows, [], "never a task the reader cannot see");
});

test("an outside agent reads its own digest without naming itself", async () => {
  const h = withThreads();
  await h.call("tasks.create", newTask({ title: "Sort the inbox", assigned: bot }), me);
  const r = await h.call("tasks.digest", {}, { id: bot.id, kind: "agent" });
  assert.match(r.text, /Sort the inbox/);
  await assert.rejects(h.call("tasks.digest", {}, { id: alice.id }), (e) => codeOf(e) === "validation.bad_input");
});

test("a repeat comes back with its brief, its files and its followers, not what was handed in", async () => {
  const h = withThreads();
  const made: unknown[] = [];
  h.callee("tasks.create", (i: unknown) => { made.push(i); return { task: { id: "tsk_next00000001" } }; });
  h.callee("tasks.followers.add", () => ({}));
  const id = (await h.call("tasks.create", newTask({ recur: { every: "week" }, due: NOW + DAY, notes: { brief: "Pay the rent" }, fileIds: ["fil_lease1"] }), me)).task.id as string;
  await h.call("tasks.followers.add", { taskId: id, follower: cara.id }, me);
  await h.call("tasks.submit", { taskId: id, summary: "Paid" }, { id: alice.id });
  const { onTaskChanged } = await import("../handlers/schedule.ts");
  await onTaskChanged(h.ctxFor("tasks.transition", { id: "svc_host", kind: "service" }), { name: "task.transitioned", payload: { taskId: id } });
  const next = made[0] as { notes?: Record<string, string>; fileIds?: string[] };
  assert.deepEqual(next.notes, { brief: "Pay the rent" });
  assert.deepEqual(next.fileIds, ["fil_lease1"]);
  assert.ok(h.calls.some((c) => c.cap === "tasks.followers.add" && (c.input as { follower: string }).follower === cara.id));
});

test("the holder a task was taken from leaves its thread; one still on it stays", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ assigned: bob, reviewer: cara }), me)).task.id as string;
  h.threadCalls.length = 0;
  await h.call("tasks.assign", { taskId: id, slot: "assigned", to: alice }, me);
  assert.deepEqual(h.threadCalls.filter((c) => c.cap === "threads.members.remove").map((c) => (c.input as { personId: string }).personId), [bob.id]);
  await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: { kind: "agent", id: "agt_bot" } }, me);
  assert.deepEqual(h.threadCalls.filter((c) => c.cap === "threads.members.remove").map((c) => (c.input as { personId: string }).personId), [bob.id, cara.id]);
  h.threadCalls.length = 0;
  await h.call("tasks.assign", { taskId: id, slot: "reviewer", to: bob }, me);
  assert.deepEqual(h.threadCalls.filter((c) => c.cap === "threads.remove_agent").map((c) => (c.input as { agentId: string }).agentId), ["agt_bot"]);
  // the one who made it stays in its thread when it moves on from them
  const mine = (await h.call("tasks.create", newTask({ assigned: owner }), me)).task.id as string;
  h.threadCalls.length = 0;
  await h.call("tasks.assign", { taskId: mine, slot: "assigned", to: alice }, me);
  assert.deepEqual(h.threadCalls.filter((c) => c.cap === "threads.members.remove"), [], "the creator stays");
});
