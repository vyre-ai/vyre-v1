// The baton tools (work baton, item 2): submit, ask, block, review and decide are moves on the one state machine. They obey the table of 4.7, the self-review and human-approver rules and the
// review-loop limit; they keep what was handed over in the working notes and as lines in the task's thread; and none of them works for someone who does not hold the baton.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, bot2, cara, owner, newTask } from "../fixtures/seed.ts";
import { findTask } from "../projections.ts";

const doer = { id: bot.id, kind: "agent" as const };
const checker = { id: bot2.id, kind: "agent" as const };
const boss = { id: cara.id };
const me = { id: owner.id };
const svc = { id: "svc_host", kind: "service" as const };

function withThreads(): Harness {
  const h = harness();
  h.callee("chat.start", (i: { scopeId: string }) => ({ thread: { threadId: `thr_${i.scopeId.slice(4)}` } }));
  h.callee("threads.members.add", () => ({}));
  h.callee("threads.add_agent", () => ({}));
  h.callee("chat.post", () => ({ message: {} }));
  return h;
}
/** A work task: the agent does, another agent reviews, Cara approves. */
async function chain(h: Harness, over: Record<string, unknown> = {}): Promise<string> {
  return (await h.call("tasks.create", newTask({ assigned: bot, reviewer: bot2, approver: cara, ...over }), me)).task.id as string;
}
const state = (h: Harness, id: string): string => findTask(h.db, id)!.state;
const notes = (h: Harness, id: string): Record<string, string> => findTask(h.db, id)!.workingNotes;
const lines = (h: Harness): string[] => h.threadCalls.filter((c) => c.cap === "chat.post").map((c) => (c.input as { body: string }).body);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}

test("the baton goes doer, reviewer, approver, done, one tool each", async () => {
  const h = withThreads();
  const id = await chain(h);
  const a = await h.call("tasks.submit", { taskId: id, outputs: { letter: "Dear Ms Rivera" }, summary: "Drafted the letter" }, doer);
  assert.equal(a.next, "review");
  assert.equal(state(h, id), "in_review");
  assert.deepEqual(JSON.parse(notes(h, id).outputs!), { letter: "Dear Ms Rivera" });
  assert.equal(notes(h, id).summary, "Drafted the letter");
  assert.deepEqual(h.events.map((e) => e.name), ["task.transitioned"]);
  const b = await h.call("tasks.review", { taskId: id, verdict: "approve" }, checker);
  assert.equal(b.next, "approval");
  assert.equal(state(h, id), "awaiting_approval");
  const c = await h.call("tasks.decide", { taskId: id, verdict: "approve", reason: "Send it" }, boss);
  assert.equal(c.next, "done");
  assert.equal(state(h, id), "done");
  assert.deepEqual(h.events.map((e) => e.name), ["task.transitioned", "task.completed", "task.approved"]);
  assert.match(lines(h).join("\n"), /Submitted: Drafted the letter[\s\S]*Dear Ms Rivera/);
  assert.match(lines(h).join("\n"), /Reviewed: looks good/);
  assert.match(lines(h).join("\n"), /Approved/);
});

test("a task with no reviewer or approver is done by a submit", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ assigned: bot }), me)).task.id as string;
  const r = await h.call("tasks.submit", { taskId: id, summary: "Done" }, doer);
  assert.equal(r.next, "done");
  assert.equal(state(h, id), "done");
  assert.deepEqual(JSON.parse(notes(h, id).outputs!), {});
});

test("only the holder of the baton may use a tool, and a tool out of turn says whose turn it is", async () => {
  const h = withThreads();
  const id = await chain(h);
  await refused(h.call("tasks.review", { taskId: id, verdict: "approve" }, checker), "validation.precondition_failed", "not_your_turn");
  await refused(h.call("tasks.decide", { taskId: id, verdict: "approve" }, boss), "validation.precondition_failed", "not_your_turn");
  await refused(h.call("tasks.submit", { taskId: id, summary: "Done" }, checker), "validation.precondition_failed", "wrong_actor");
  await h.call("tasks.submit", { taskId: id, summary: "Drafted" }, doer);
  await refused(h.call("tasks.submit", { taskId: id, summary: "Again" }, doer), "validation.precondition_failed", "not_your_turn");
  await refused(h.call("tasks.review", { taskId: id, verdict: "approve" }, doer), "validation.precondition_failed", "wrong_actor");
  assert.equal(state(h, id), "in_review");
});

test("a submit is refused without a summary, and outputs must match the schema the step recorded", async () => {
  const h = withThreads();
  const id = await chain(h);
  await h.call("tasks.working_notes.set", { taskId: id, key: "output_schema", value: JSON.stringify({ type: "object", required: ["letter"], properties: { letter: { type: "string" } } }) }, svc);
  await refused(h.call("tasks.submit", { taskId: id, outputs: { letter: "x" }, summary: "  " }, doer), "validation.bad_input");
  await assert.rejects(h.call("tasks.submit", { taskId: id, outputs: { letter: 7 }, summary: "Drafted" }, doer), (e) => {
    assert.equal(codeOf(e), "validation.bad_input");
    assert.match(JSON.stringify(e), /letter/);
    return true;
  });
  await assert.rejects(h.call("tasks.submit", { taskId: id, summary: "Drafted" }, doer), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(state(h, id), "todo", "nothing moved");
  await h.call("tasks.submit", { taskId: id, outputs: { letter: "ok" }, summary: "Drafted" }, doer);
  assert.equal(state(h, id), "in_review");
});

test("a reviewer sends back with numbered fixes, the doer sees them, and a new submit clears them", async () => {
  const h = withThreads();
  const id = await chain(h);
  await h.call("tasks.submit", { taskId: id, summary: "Drafted" }, doer);
  await refused(h.call("tasks.review", { taskId: id, verdict: "send_back" }, checker), "validation.precondition_failed", "fixes_required");
  await refused(h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: ["  "] }, checker), "validation.precondition_failed", "fixes_required");
  const r = await h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: ["Use her full name", "Cut the second paragraph"] }, checker);
  assert.equal(r.next, "fixes");
  assert.equal(state(h, id), "doing");
  assert.equal(r.task.reviewLoops, 1);
  assert.deepEqual(JSON.parse(notes(h, id).fixes!), ["Use her full name", "Cut the second paragraph"]);
  assert.match(lines(h).join("\n"), /Sent back with fixes:\n1\. Use her full name\n2\. Cut the second paragraph/);
  assert.ok(h.events.some((e) => e.name === "task.sent_back" && /1\. Use her full name/.test(String(e.payload.note))));
  await h.call("tasks.submit", { taskId: id, summary: "Fixed both" }, doer);
  assert.equal(notes(h, id).fixes, undefined);
  assert.equal(state(h, id), "in_review");
});

test("after the review loop limit an agent reviewer hands the decision to a person", async () => {
  const h = withThreads();
  const id = await chain(h);
  for (let i = 0; i < 2; i++) {
    await h.call("tasks.submit", { taskId: id, summary: `Try ${i + 1}` }, doer);
    await h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: [`Fix ${i + 1}`] }, checker);
  }
  await h.call("tasks.submit", { taskId: id, summary: "Try 3" }, doer);
  const r = await h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: ["Still wrong"] }, checker);
  assert.equal(r.next, "person");
  assert.equal(state(h, id), "in_review", "the work waits for the person");
  assert.deepEqual(findTask(h.db, id)!.reviewer, { kind: "person", id: owner.id }, "the person behind the task is the reviewer now");
  assert.deepEqual(JSON.parse(notes(h, id).fixes!), ["Still wrong"]);
  assert.ok(h.events.some((e) => e.name === "task.assigned" && e.payload.slot === "reviewer"));
  // the person is not held to the limit and sends it back by the same tool
  const p = await h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: ["Redo the intro"] }, me);
  assert.equal(p.next, "fixes");
  assert.equal(state(h, id), "doing");
});

test("a reviewer cannot hand off to a person when none can be found: it is refused by name", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ assigned: bot, reviewer: bot2 }), svc)).task.id as string;
  for (let i = 0; i < 2; i++) {
    await h.call("tasks.submit", { taskId: id, summary: `Try ${i + 1}` }, doer);
    await h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: [`Fix ${i + 1}`] }, checker);
  }
  await h.call("tasks.submit", { taskId: id, summary: "Try 3" }, doer);
  await refused(h.call("tasks.review", { taskId: id, verdict: "send_back", fixes: ["No"] }, checker), "validation.precondition_failed", "review_loop_limit");
});

test("an approver rejects with a reason, the doer gets it as the fix, and the human-approver rule holds", async () => {
  const h = withThreads();
  const id = await chain(h, { approver: cara });
  await h.call("tasks.submit", { taskId: id, summary: "Drafted" }, doer);
  await h.call("tasks.review", { taskId: id, verdict: "approve" }, checker);
  await refused(h.call("tasks.decide", { taskId: id, verdict: "reject" }, boss), "validation.precondition_failed", "reason_required");
  const r = await h.call("tasks.decide", { taskId: id, verdict: "reject", reason: "Wrong client" }, boss);
  assert.equal(r.next, "fixes");
  assert.equal(state(h, id), "doing");
  assert.deepEqual(JSON.parse(notes(h, id).fixes!), ["Wrong client"]);
  assert.ok(h.events.some((e) => e.name === "task.rejected"));

  const g = withThreads();
  g.policy("tasks.require_human_approver", true);
  const t = (await g.call("tasks.create", newTask({ assigned: bot, approver: alice }), me)).task.id as string;
  await g.call("tasks.submit", { taskId: t, summary: "Drafted" }, doer);
  assert.equal(state(g, t), "awaiting_approval");
  await refused(g.call("tasks.decide", { taskId: t, verdict: "approve" }, { id: bot2.id, kind: "agent" }), "validation.precondition_failed");
});

test("an agent cannot approve its own work, even with the baton in its hand", async () => {
  const h = withThreads();
  h.policy("tasks.allow_self_review", false);
  await refused(h.call("tasks.create", newTask({ assigned: bot, reviewer: bot }), me), "validation.precondition_failed", "self_review");
});

test("ask opens an Answer task for the requester, the work waits on it, and the same question is not asked twice", async () => {
  const h = withThreads();
  const id = await chain(h);
  const q = await h.call("tasks.ask", { taskId: id, question: "Which date is right, 3 May or 5 May?" }, doer);
  const child = findTask(h.db, q.answerTaskId)!;
  assert.equal(child.kind, "answer");
  assert.deepEqual(child.assigned, { kind: "person", id: owner.id }, "the person who asked for the work is asked");
  assert.equal(child.parentTaskId, id);
  assert.equal(child.summary, "Which date is right, 3 May or 5 May?");
  assert.equal(q.task.blocked, true, "the work shows Blocked while the question is open");
  assert.equal(state(h, id), "todo");
  const again = await h.call("tasks.ask", { taskId: id, question: "Which date is right, 3 May or 5 May?" }, doer);
  assert.equal(again.answerTaskId, q.answerTaskId);
  assert.equal(h.db.all("SELECT id FROM tasks_meta WHERE kind = 'answer'").length, 1);
  assert.match(lines(h).join("\n"), /Question for a person: Which date/);
  // answering it unblocks the work and the answer is on the child
  await h.call("tasks.act", { taskId: q.answerTaskId, action: "answer", answer: { date: "5 May" } }, me);
  const after = (await h.call("tasks.get", { taskId: id }, me)).task;
  assert.equal(after.blocked, false);
  assert.equal(JSON.parse(findTask(h.db, q.answerTaskId)!.workingNotes.answer!).date, "5 May");
});

test("ask can name who to ask, and only the doer asks", async () => {
  const h = withThreads();
  const id = await chain(h);
  const q = await h.call("tasks.ask", { taskId: id, question: "Can you share the file?", to: { kind: "person", id: bob.id } }, doer);
  assert.deepEqual(findTask(h.db, q.answerTaskId)!.assigned, { kind: "person", id: bob.id });
  await refused(h.call("tasks.ask", { taskId: id, question: "Me too" }, checker), "validation.precondition_failed", "wrong_actor");
  await h.call("tasks.submit", { taskId: id, summary: "Drafted" }, doer);
  await refused(h.call("tasks.ask", { taskId: id, question: "Late" }, doer), "validation.precondition_failed", "not_your_turn");
});

test("block opens an Unblock task for whoever the task escalates to, else the person behind it", async () => {
  const h = withThreads();
  const id = await chain(h);
  const a = await h.call("tasks.block", { taskId: id, reason: "I cannot open the client folder" }, doer);
  const child = findTask(h.db, a.unblockTaskId)!;
  assert.equal(child.kind, "unblock");
  assert.deepEqual(child.assigned, { kind: "person", id: owner.id });
  assert.equal(a.task.blocked, true);
  assert.equal((await h.call("tasks.block", { taskId: id, reason: "I cannot open the client folder" }, doer)).unblockTaskId, a.unblockTaskId, "one open block at a time");

  const g = withThreads();
  const t = await chain(g);
  await g.call("tasks.working_notes.set", { taskId: t, key: "baton.escalate_to", value: JSON.stringify({ kind: "person", id: bob.id }) }, svc);
  const b = await g.call("tasks.block", { taskId: t, reason: "Need access" }, doer);
  assert.deepEqual(findTask(g.db, b.unblockTaskId)!.assigned, { kind: "person", id: bob.id });
});

test("the baton is for work tasks: a request is answered with tasks.act", async () => {
  const h = withThreads();
  const id = (await h.call("tasks.create", newTask({ kind: "approve", assigned: alice }), me)).task.id as string;
  await refused(h.call("tasks.decide", { taskId: id, verdict: "approve" }, { id: alice.id }), "validation.precondition_failed", "not_work");
});
