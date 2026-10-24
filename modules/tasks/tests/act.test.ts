// tasks.act (spec 2.8, ARCH 4.6, 4.7): acting at the source, the device-bound approval token of a held act, role-addressed requests, delegation and escalation, stuck tasks.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, bot, cara, finance, owner, newTask, DAY } from "../fixtures/seed.ts";
import { findStuck, mintApprovalToken, readApprovalToken, TOKEN_MINUTES } from "../handlers/act.ts";
import { findTask } from "../projections.ts";

const HOUR = 3_600_000;
const svc = { id: "svc_gate", kind: "service" as const };
const asAlice = { id: alice.id, device: "dev_1" };

async function create(h: Harness, over: Record<string, unknown>, who: { id: string; kind?: "service" | "person" | "agent" } = { id: owner.id }): Promise<string> {
  const r = await h.call("tasks.create", newTask(over), who);
  return r.task.id as string;
}
async function gateTask(h: Harness, over: Record<string, unknown> = {}): Promise<string> {
  const id = await create(h, { kind: "approve", title: "Send the retainer email?", assigned: alice, approver: alice, source: { kind: "gate", id: "hld_1" }, expiresAt: h.now() + 4 * HOUR, blocks: [{ type: "table", data: { rows: [["To", "client@example.com"]] } }], ...over }, svc);
  await h.call("tasks.working_notes.set", { taskId: id, key: "decision_id", value: "dec_1" }, svc);
  await h.call("tasks.working_notes.set", { taskId: id, key: "payload_hash", value: "h_abc" }, svc);
  return id;
}
const state = async (h: Harness, id: string): Promise<string> => (await h.call("tasks.get", { taskId: id }, { id: owner.id })).task.state;
const names = (h: Harness): string[] => h.events.map((e) => e.name);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}

test("approve closes an Approve request and says who approved", async () => {
  const h = harness();
  const id = await create(h, { kind: "approve", assigned: bob, title: "Approve the invoice" });
  assert.equal(await state(h, id), "awaiting_approval");
  const r = await h.call("tasks.act", { taskId: id, action: "approve", note: "ok" }, { id: bob.id });
  assert.equal(r.task.state, "done");
  assert.deepEqual(names(h), ["task.transitioned", "task.completed", "task.approved"]);
  assert.equal(h.events[2]!.payload.by, bob.id);
  const hist = await h.call("tasks.history", { taskId: id }, { id: bob.id });
  assert.deepEqual(hist.entries.map((e: { type: string }) => e.type).slice(0, 3), ["approved", "completed", "transitioned"]);
});

test("sending back needs a note and carries it", async () => {
  const h = harness();
  const id = await create(h, { kind: "approve", assigned: bob });
  await refused(h.call("tasks.act", { taskId: id, action: "reject" }, { id: bob.id }), "validation.precondition_failed", "note_required");
  assert.equal(await state(h, id), "awaiting_approval");
  const r = await h.call("tasks.act", { taskId: id, action: "reject", note: "wrong client" }, { id: bob.id });
  assert.equal(r.task.state, "doing");
  assert.deepEqual(names(h), ["task.transitioned", "task.rejected"]);
  assert.equal(h.events[1]!.payload.note, "wrong client");
});

test("a Review request: looks good moves on to the approver, send back counts a loop", async () => {
  const h = harness();
  const id = await create(h, { kind: "review", assigned: bob, approver: cara });
  const a = await h.call("tasks.act", { taskId: id, action: "approve" }, { id: bob.id });
  assert.equal(a.task.state, "awaiting_approval");
  const b = await h.call("tasks.act", { taskId: id, action: "approve" }, { id: cara.id });
  assert.equal(b.task.state, "done");
  const id2 = await create(h, { kind: "review", assigned: bob });
  const c = await h.call("tasks.act", { taskId: id2, action: "send_back", note: "tighten section 2" }, { id: bob.id });
  assert.equal(c.task.state, "doing");
  assert.equal(c.task.reviewLoops, 1);
});

test("answer and unblock requests close with the answer kept", async () => {
  const h = harness();
  const id = await create(h, { kind: "answer", assigned: alice });
  const r = await h.call("tasks.act", { taskId: id, action: "answer", answer: { choice: "B" }, note: "B please" }, { id: alice.id });
  assert.equal(r.task.state, "done");
  assert.deepEqual(r.result.answer, { choice: "B" });
  assert.equal(JSON.parse(r.task.workingNotes.answer).choice, "B");
  const u = await create(h, { kind: "unblock", assigned: alice });
  await refused(h.call("tasks.act", { taskId: u, action: "cannot" }, { id: alice.id }), "validation.precondition_failed", "note_required");
  const c = await h.call("tasks.act", { taskId: u, action: "cannot", note: "I do not have the login" }, { id: alice.id });
  assert.equal(c.task.state, "canceled");
});

test("work tasks: start, submit to review, approve, reopen", async () => {
  const h = harness();
  const id = await create(h, { assigned: alice, reviewer: bob });
  assert.equal((await h.call("tasks.act", { taskId: id, action: "start" }, { id: alice.id })).task.state, "doing");
  assert.equal((await h.call("tasks.act", { taskId: id, action: "complete" }, { id: alice.id })).task.state, "in_review");
  assert.equal((await h.call("tasks.act", { taskId: id, action: "approve" }, { id: bob.id })).task.state, "done");
  assert.equal((await h.call("tasks.act", { taskId: id, action: "reopen" }, { id: alice.id })).task.state, "todo");
});

test("unknown actions, actions with their own capability, the wrong person and a closed task are refused", async () => {
  const h = harness({ authorize: () => true });
  const id = await create(h, { kind: "approve", assigned: alice });
  await refused(h.call("tasks.act", { taskId: id, action: "launch" }, { id: alice.id }), "validation.precondition_failed", "unknown_action");
  await refused(h.call("tasks.act", { taskId: id, action: "delegate" }, { id: alice.id }), "validation.precondition_failed", "own_capability");
  await refused(h.call("tasks.act", { taskId: id, action: "snooze" }, { id: alice.id }), "validation.precondition_failed", "own_capability");
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: bob.id }), "validation.precondition_failed", "wrong_actor");
  assert.equal(await state(h, id), "awaiting_approval");
  await h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id });
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id }), "validation.precondition_failed", "closed");
  await assert.rejects(() => h.call("tasks.act", { taskId: "tsk_missing", action: "approve" }, { id: alice.id }), (e) => codeOf(e) === "permission.not_found");
});

test("a request past its expiry cannot be acted on", async () => {
  const h = harness();
  const id = await create(h, { kind: "approve", assigned: alice, expiresAt: h.now() + HOUR });
  h.advance(2 * HOUR);
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id }), "permission.expired");
  assert.equal(await state(h, id), "awaiting_approval");
});

// ---- a held act (Gate) ----

test("approving a held act mints a device-bound token, releases the hold and closes the task", async () => {
  const h = harness();
  h.callee("gate.release", () => ({ result: { messageId: "msg_1" } }));
  const id = await gateTask(h);
  const r = await h.call("tasks.act", { taskId: id, action: "approve", note: "go" }, asAlice);
  assert.equal(r.task.state, "done");
  assert.equal(r.result.released, true);
  assert.deepEqual(r.result.sent, { messageId: "msg_1" });
  assert.equal(h.calls.length, 1);
  const call = h.calls[0]!;
  assert.equal(call.cap, "gate.release");
  const input = call.input as { holdId: string; taskId: string; approvalToken: string };
  assert.equal(input.holdId, "hld_1");
  assert.equal(input.taskId, id);
  const claims = readApprovalToken(h.ctxFor("gate.release", { id: svc.id, kind: "service" }), input.approvalToken);
  assert.ok(claims, "the token opens");
  assert.equal(claims.task, id);
  assert.equal(claims.hold, "hld_1");
  assert.equal(claims.decision, "dec_1");
  assert.equal(claims.hash, "h_abc");
  assert.equal(claims.by, alice.id);
  assert.equal(claims.device, "dev_1");
  assert.equal(claims.exp, h.now() + TOKEN_MINUTES * 60_000);
});

test("nothing is released until every rule has passed", async () => {
  const h = harness({ authorize: () => true });
  h.callee("gate.release", () => ({ result: {} }));
  const id = await gateTask(h);
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: bob.id, device: "dev_2" }), "validation.precondition_failed", "wrong_actor");
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id }), "validation.precondition_failed", "device_required");
  assert.equal(h.calls.length, 0, "no release was attempted");
  assert.equal(await state(h, id), "awaiting_approval");
});

test("a token that is not ours, or was changed, does not open", async () => {
  const h = harness();
  const ctx = h.ctxFor("tasks.act", asAlice);
  assert.equal(readApprovalToken(ctx, "apv_not-a-token"), null);
  assert.equal(readApprovalToken(ctx, "something else"), null);
  h.callee("gate.release", () => ({ result: {} }));
  const id = await gateTask(h);
  await h.call("tasks.act", { taskId: id, action: "approve" }, asAlice);
  const token = (h.calls[0]!.input as { approvalToken: string }).approvalToken;
  assert.ok(readApprovalToken(ctx, token));
  assert.equal(readApprovalToken(ctx, `${token}x`), null);
});

test("a failed release leaves the task awaiting approval", async () => {
  const h = harness();
  h.callee("gate.release", () => { throw Object.assign(new Error("expired"), { error: { code: "permission.expired" } }); });
  const id = await gateTask(h);
  await assert.rejects(() => h.call("tasks.act", { taskId: id, action: "approve" }, asAlice), /expired/);
  assert.equal(await state(h, id), "awaiting_approval");
});

test("sending a held act back drops it through gate.deny with the note", async () => {
  const h = harness();
  h.callee("gate.deny", () => ({ ok: true }));
  const id = await gateTask(h);
  await refused(h.call("tasks.act", { taskId: id, action: "reject" }, asAlice), "validation.precondition_failed", "note_required");
  assert.equal(h.calls.length, 0);
  const r = await h.call("tasks.act", { taskId: id, action: "reject", note: "wrong recipient" }, asAlice);
  assert.equal(r.task.state, "doing");
  assert.deepEqual(h.calls[0], { cap: "gate.deny", input: { holdId: "hld_1", taskId: id, mode: "send_back", note: "wrong recipient" } });
});

test("a held act is approved exactly as shown: no edits, no status shortcut, no title or preview change", async () => {
  const h = harness();
  const id = await gateTask(h);
  await refused(h.call("tasks.act", { taskId: id, action: "approve", edits: { to: "someone@else.com" } }, asAlice), "validation.field_locked");
  await refused(h.call("tasks.transition", { taskId: id, to: "done" }, { id: alice.id }), "validation.precondition_failed", "use_act");
  await refused(h.call("tasks.update", { taskId: id, title: "Send something else" }, { id: alice.id }), "validation.field_locked");
  await refused(h.call("tasks.update", { taskId: id, blocks: [] }, { id: alice.id }), "validation.field_locked");
  const ok = await h.call("tasks.update", { taskId: id, summary: "Retainer for the Lee matter" }, { id: alice.id });
  assert.equal(ok.task.summary, "Retainer for the Lee matter");
  const viaGate = await h.call("tasks.transition", { taskId: id, to: "done" }, svc);
  assert.equal(viaGate.task.state, "done");
});

test("the decision id and payload hash are written once, only on a held act, and never show as notes", async () => {
  const h = harness();
  const id = await gateTask(h);
  await refused(h.call("tasks.working_notes.set", { taskId: id, key: "payload_hash", value: "h_other" }, svc), "validation.field_locked");
  await refused(h.call("tasks.working_notes.delete", { taskId: id, key: "decision_id" }, svc), "validation.field_locked");
  const same = await h.call("tasks.working_notes.set", { taskId: id, key: "payload_hash", value: "h_abc" }, svc);
  assert.deepEqual(same.task.workingNotes, {});
  const plain = await create(h, { kind: "approve", assigned: alice });
  await refused(h.call("tasks.working_notes.set", { taskId: plain, key: "decision_id", value: "dec_x" }, svc), "validation.field_locked");
});

// ---- run source ----

test("answering a run's request resumes the run; a failed resume is reported, not undone", async () => {
  const h = harness();
  h.callee("runs.resume", () => ({ run: {} }));
  const id = await create(h, { kind: "answer", assigned: alice, source: { kind: "run", id: "run_1" } });
  const r = await h.call("tasks.act", { taskId: id, action: "answer", answer: "yes" }, { id: alice.id });
  assert.equal(r.result.resumed, true);
  assert.deepEqual(h.calls[0], { cap: "runs.resume", input: { runId: "run_1", reason: "approval" } });
  const u = await create(h, { kind: "unblock", assigned: alice, source: { kind: "run", id: "run_2" } });
  h.callee("runs.resume", () => { throw Object.assign(new Error("run is gone"), { error: { code: "validation.precondition_failed" } }); });
  const r2 = await h.call("tasks.act", { taskId: u, action: "resolved" }, { id: alice.id });
  assert.equal(r2.task.state, "done");
  assert.equal(r2.result.resumed, false);
  assert.equal(r2.result.resumeError, "validation.precondition_failed");
  assert.deepEqual(h.calls[1], { cap: "runs.resume", input: { runId: "run_2", reason: "background" } });
});

test("a chat request only emits events; the chat engine continues from them", async () => {
  const h = harness();
  const id = await create(h, { kind: "approve", assigned: alice, source: { kind: "chat", id: "thr_1" } });
  await h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id });
  assert.equal(h.calls.length, 0);
  assert.ok(names(h).includes("task.approved"));
});

// ---- role-addressed requests ----

test("a request addressed to a role is resolved by the first action; the others see handled by", async () => {
  const h = harness({ authorize: () => true });
  const id = await create(h, { kind: "approve", assigned: finance });
  const needs = await h.call("tasks.needs_you", {}, { id: bob.id });
  assert.equal(needs.items.length, 1);
  assert.equal(needs.items[0].reason, "ready");
  await h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id });
  assert.deepEqual(names(h), ["task.transitioned", "task.completed", "task.approved", "task.handled"]);
  const after = await h.call("tasks.needs_you", {}, { id: bob.id });
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].handledBy, alice.id);
  assert.equal((await h.call("tasks.count_needs_you", {}, { id: bob.id })).count, 0);
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: bob.id }), "validation.precondition_failed", "handled");
});

test("the first Take locks a role task to one person", async () => {
  const h = harness({ authorize: () => true });
  const id = await create(h, { kind: "approve", assigned: finance });
  await h.call("tasks.take", { taskId: id }, { id: alice.id });
  await refused(h.call("tasks.act", { taskId: id, action: "approve" }, { id: bob.id }), "validation.precondition_failed", "wrong_actor");
  await refused(h.call("tasks.take", { taskId: id }, { id: bob.id }), "validation.precondition_failed", "taken");
  const r = await h.call("tasks.act", { taskId: id, action: "approve" }, { id: alice.id });
  assert.equal(r.task.state, "done");
});

// ---- delegate and escalate ----

test("handing over walks the delegate chain and never widens access", async () => {
  const h = harness();
  const id = await create(h, { kind: "approve", assigned: alice });
  h.callee("notifications.delegate.resolve", (input) => ((input as { person: string }).person === bob.id ? { delegate: { kind: "person", id: cara.id }, walked: 1 } : { walked: 2 }));
  const r = await h.call("tasks.delegate", { taskId: id, to: bob, note: "I am away" }, { id: alice.id });
  assert.deepEqual(r.passedTo, { kind: "person", id: cara.id });
  assert.equal(r.task.approver.id, cara.id);
  assert.equal(h.events[0]!.name, "task.delegated");
  assert.deepEqual(h.calls[0], { cap: "notifications.delegate.resolve", input: { person: bob.id, resource: { type: "task", id } } });
  const hist = await h.call("tasks.history", { taskId: id }, { id: cara.id });
  assert.equal(hist.entries[0].note, "I am away");
  await refused(h.call("tasks.delegate", { taskId: id, to: bob }, { id: alice.id }), "validation.precondition_failed", "wrong_actor");
  // nobody in the chain can act
  const id2 = await create(h, { kind: "approve", assigned: alice });
  await refused(h.call("tasks.delegate", { taskId: id2, to: alice }, { id: alice.id }), "validation.precondition_failed", "nobody_can_act");
  // a role takes it directly
  const r3 = await h.call("tasks.delegate", { taskId: id2, to: finance }, { id: alice.id });
  assert.deepEqual(r3.passedTo, finance);
});

test("only requests are handed over, and a Space that needs people does not hand approvals to agents", async () => {
  const h = harness();
  h.policy("tasks.require_human_approver", true);
  const work = await create(h, { assigned: alice });
  await refused(h.call("tasks.delegate", { taskId: work, to: bob }, { id: alice.id }), "validation.precondition_failed", "not_a_request");
  const id = await create(h, { kind: "approve", assigned: alice });
  await refused(h.call("tasks.delegate", { taskId: id, to: bot }, { id: alice.id }), "validation.precondition_failed", "human_approver_required");
});

test("escalate: delegate found, none found, already a role, finished", async () => {
  const h = harness();
  const id = await create(h, { kind: "approve", assigned: alice });
  h.callee("notifications.delegate.resolve", () => ({ delegate: { kind: "role", id: finance.id }, walked: 1 }));
  const r = await h.call("tasks.escalate", { taskId: id, reason: "timeout" }, svc);
  assert.deepEqual(r.task.approver, finance);
  assert.equal(h.events[0]!.name, "task.escalated");
  assert.deepEqual(h.events[0]!.payload.to, finance);
  await refused(h.call("tasks.escalate", { taskId: id, reason: "timeout" }, svc), "validation.precondition_failed", "already_role");
  const id2 = await create(h, { kind: "approve", assigned: alice });
  h.callee("notifications.delegate.resolve", () => ({ walked: 3 }));
  await refused(h.call("tasks.escalate", { taskId: id2, reason: "away" }, svc), "validation.precondition_failed", "no_delegate");
  await h.call("tasks.act", { taskId: id2, action: "approve" }, { id: alice.id });
  await refused(h.call("tasks.escalate", { taskId: id2, reason: "manual" }, svc), "validation.precondition_failed", "closed");
});

// ---- stuck tasks ----

test("stuck tasks: an unanswered Unblock, a quiet agent, a decision nobody made", async () => {
  const h = harness();
  h.callee("access.principals.get", () => ({ principal: { owner: alice.id } }));
  const agentTask = await create(h, { assigned: bot, title: "Research the docket" });
  await h.call("tasks.transition", { taskId: agentTask, to: "doing" }, { id: bot.id, kind: "agent" });
  const parent = await create(h, { assigned: alice, title: "File the motion" });
  const child = await create(h, { kind: "unblock", assigned: cara, parentTaskId: parent, title: "Court e-filing login expired" });
  const review = await create(h, { assigned: alice, reviewer: bob, title: "Client letter" });
  await h.call("tasks.transition", { taskId: review, to: "in_review" }, { id: alice.id });
  const ctx = h.ctxFor("tasks.escalate", { id: owner.id });
  assert.deepEqual(findStuck(ctx), [], "nothing has gone quiet yet");
  h.advance(23 * HOUR);
  assert.deepEqual(findStuck(h.ctxFor("tasks.escalate", { id: owner.id })), []);
  h.advance(2 * HOUR);
  const stuck = findStuck(h.ctxFor("tasks.escalate", { id: owner.id }));
  const by = new Map(stuck.map((s) => [s.taskId, s]));
  assert.equal(stuck.length, 3);
  assert.equal(by.get(agentTask)?.why, "idle_agent");
  assert.equal(by.get(agentTask)?.notify, alice.id, "the agent's owner hears about it");
  assert.equal(by.get(parent)?.why, "unblock_waiting");
  assert.equal(by.get(parent)?.notify, owner.id);
  assert.equal(by.get(review)?.why, "waiting_on_decision");
  // answering the Unblock clears the parent; a shorter idle window finds more
  await h.call("tasks.act", { taskId: child, action: "resolved" }, { id: cara.id });
  assert.equal(findStuck(h.ctxFor("tasks.escalate", { id: owner.id })).length, 2);
  assert.equal(findStuck(h.ctxFor("tasks.escalate", { id: owner.id }), { idleMs: 365 * DAY }).length, 0);
});

test("a snoozed request is waiting for its time, not stuck", async () => {
  const h = harness();
  const id = await create(h, { assigned: alice, reviewer: bob });
  await h.call("tasks.transition", { taskId: id, to: "in_review" }, { id: alice.id });
  h.advance(2 * DAY);
  assert.equal(findStuck(h.ctxFor("tasks.escalate", { id: owner.id })).length, 1);
  const req = await create(h, { kind: "approve", assigned: alice });
  await h.call("tasks.snooze", { taskId: req, until: h.now() + 3 * DAY }, { id: alice.id });
  h.advance(2 * DAY);
  assert.equal(findStuck(h.ctxFor("tasks.escalate", { id: owner.id })).every((s) => s.taskId !== req), true);
});

test("minting without a seal is refused instead of issuing an unsigned token", async () => {
  const h = harness();
  const ctx = h.ctxFor("tasks.act", asAlice);
  delete (ctx as { seal?: unknown }).seal;
  const id = await gateTask(h);
  const task = findTask(h.db, id)!;
  assert.throws(() => mintApprovalToken(ctx, task), (e) => codeOf(e) === "internal.unavailable");
});
