// Blocks that park a turn (spec 2.5, 4.13; ARCH 6.7, 6.8): answering a question and approving a plan. The engine reads block.answered and queues the wake; chat only records the answer.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { blockBy, messageBy, planBy, threadBy } from "../projections.ts";
import { DANA, INTAKE, MAYA, assertEventsConform, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const chat = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k" })).thread.threadId as string;
const answer = (ctx: Harness["ctx"], threadId: string, blockId: string, a: unknown) => h["chat.answer_block"]!(ctx, { threadId, blockId, answer: a });
const OPTS = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];

test("answering a question stores the answer on the block and in its message, and announces block.answered", async () => {
  const hn = harness();
  const t = await chat(hn);
  const q = hn.seedQuestion(t, { mode: "single", options: OPTS });
  hn.clear();
  assert.deepEqual(await answer(hn.ctx, t, q.blockId, "b"), { ok: true });
  const row = blockBy(hn.db, q.blockId)!;
  assert.equal(row.state, "done");
  assert.equal(row.answer, "b");
  assert.equal(row.answeredBy, DANA);
  const inMessage = messageBy(hn.db, q.messageId)!.blocks[0]!;
  assert.equal(inMessage["state"], "done");
  assert.deepEqual((inMessage["data"] as Record<string, unknown>)["answer"], "b");
  assert.equal((inMessage["data"] as Record<string, unknown>)["answeredBy"], DANA);
  assert.deepEqual(hn.names(), ["block.answered"]);
  assert.deepEqual(hn.named("block.answered")[0]!.payload, { threadId: t, blockId: q.blockId, by: DANA });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("the answer must fit the question: one option, a list of options, or free text; Other only where it is on", async () => {
  const hn = harness();
  const t = await chat(hn);
  const ok = async (q: Parameters<Harness["seedQuestion"]>[1], a: unknown) => { const s = hn.seedQuestion(t, q); return (await answer(hn.ctx, t, s.blockId, a)).ok; };
  const no = (q: Parameters<Harness["seedQuestion"]>[1], a: unknown) => { const s = hn.seedQuestion(t, q); return failure(() => answer(hn.ctx, t, s.blockId, a)); };
  const single = { mode: "single" as const, options: OPTS };
  assert.equal(await ok(single, "c"), true);
  assert.equal(await no(single, "z"), "validation.bad_input");
  assert.equal(await no(single, ["a"]), "validation.bad_input");
  assert.equal(await no(single, "something else"), "validation.bad_input", "Other is off");
  assert.equal(await ok({ ...single, allowOther: true }, "something else"), true);
  assert.equal(await ok({ ...single, allowOther: true }, { other: "my own" }), true);
  assert.equal(await no({ ...single, allowOther: true }, { other: "  " }), "validation.bad_input");
  const multi = { mode: "multi" as const, options: OPTS };
  assert.equal(await ok(multi, ["a", "c"]), true);
  assert.equal(await no(multi, []), "validation.bad_input");
  assert.equal(await no(multi, "a"), "validation.bad_input");
  assert.equal(await no(multi, ["a", "q"]), "validation.bad_input");
  assert.equal(await ok({ ...multi, allowOther: true }, ["a", "extra"]), true);
  assert.equal(await ok({ mode: "free" }, "any words"), true);
  assert.equal(await no({ mode: "free" }, "   "), "validation.bad_input");
  assert.equal(await no({ mode: "free" }, 5), "validation.bad_input");
});

test("a repeat of the same answer is the same answer; a different one comes too late; the turn is woken once", async () => {
  const hn = harness();
  const t = await chat(hn);
  const q = hn.seedQuestion(t, { mode: "multi", options: OPTS });
  await answer(hn.ctx, t, q.blockId, ["a", "b"]);
  hn.clear();
  assert.deepEqual(await answer(hn.ctx, t, q.blockId, ["a", "b"]), { ok: true });
  assert.deepEqual(hn.names(), []);
  assert.equal(await failure(() => answer(hn.ctx, t, q.blockId, ["c"])), "validation.precondition_failed");
  assert.deepEqual(blockBy(hn.db, q.blockId)!.answer, ["a", "b"]);
});

test("only a person answers, only in a thread they can reach, only the right block", async () => {
  const hn = harness();
  const t = await chat(hn);
  const q = hn.seedQuestion(t, { mode: "free" });
  assert.equal(await failure(() => answer(hn.agent(INTAKE), t, q.blockId, "I answer myself")), "validation.precondition_failed");
  assert.equal(await failure(() => answer(hn.person(MAYA), t, q.blockId, "not mine")), "validation.not_found");
  assert.equal(await failure(() => answer(hn.ctx, t, "blk_none", "x")), "validation.not_found");
  const other = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k2" });
  assert.equal(await failure(() => answer(hn.ctx, other.thread.threadId, q.blockId, "wrong thread")), "validation.not_found");
  const p = hn.seedPlan(t);
  assert.equal(await failure(() => answer(hn.ctx, t, p.blockId, "yes")), "validation.precondition_failed", "a plan has its own buttons");
  assert.equal(blockBy(hn.db, q.blockId)!.state, "waiting");
});

// ---- plans -------------------------------------------------------------------------------------------------------------------------------------------

test("approving a plan ends plan mode, ticks it approved in its block, and wakes the turn", async () => {
  const hn = harness();
  const t = await chat(hn);
  hn.raw.run("UPDATE chat_thread SET modePlan = 1 WHERE id = ?", t);
  const p = hn.seedPlan(t, ["Read", "Write", "Test"]);
  hn.clear();
  const out = await h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: p.planId });
  assert.equal(out.plan.planId, p.planId);
  assert.equal(out.plan.state, "approved");
  assert.deepEqual(out.plan.steps.map((s: any) => [s.text, s.state]), [["Read", "todo"], ["Write", "todo"], ["Test", "todo"]]);
  assert.equal(threadBy(hn.db, t)!.planMode, false);
  assert.equal(planBy(hn.db, p.planId)!.state, "approved");
  assert.equal(blockBy(hn.db, p.blockId)!.state, "done");
  const data = messageBy(hn.db, p.messageId)!.blocks[0]!["data"] as Record<string, unknown>;
  assert.equal(data["state"], "approved");
  assert.deepEqual(hn.names(), ["plan.approved", "block.answered"]);
  assert.deepEqual(hn.named("plan.approved")[0]!.payload, { planId: p.planId, threadId: t, edited: false, by: DANA });
  assert.deepEqual(hn.named("block.answered")[0]!.payload, { threadId: t, blockId: p.blockId, by: DANA });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("edits change the steps before they run: new words, removed steps; the event says it was edited", async () => {
  const hn = harness();
  const t = await chat(hn);
  const p = hn.seedPlan(t, ["Read", "Write", "Test"]);
  hn.clear();
  const out = await h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: p.planId, edits: [{ stepId: p.stepIds[1], text: "  Write carefully " }, { stepId: p.stepIds[2], remove: true }] });
  assert.deepEqual(out.plan.steps.map((s: any) => s.text), ["Read", "Write carefully"]);
  assert.equal(hn.named("plan.approved")[0]!.payload["edited"], true);
  const data = messageBy(hn.db, p.messageId)!.blocks[0]!["data"] as Record<string, unknown>;
  assert.deepEqual((data["steps"] as Array<{ text: string }>).map((s) => s.text), ["Read", "Write carefully"]);
});

test("a plan with a step that does not exist, an empty step or no steps left is refused whole", async () => {
  const hn = harness();
  const t = await chat(hn);
  const p = hn.seedPlan(t, ["Read", "Write"]);
  const edit = (edits: unknown[]) => failure(() => h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: p.planId, edits }));
  assert.equal(await edit([{ stepId: "stp_none", text: "x" }]), "validation.bad_input");
  assert.equal(await edit([{ stepId: p.stepIds[0], text: "   " }]), "validation.bad_input");
  assert.equal(await edit([{ stepId: p.stepIds[0], remove: true }, { stepId: p.stepIds[1], remove: true }]), "validation.bad_input");
  assert.equal(planBy(hn.db, p.planId)!.state, "proposed");
  assert.deepEqual(planBy(hn.db, p.planId)!.steps.map((s) => s.text), ["Read", "Write"], "nothing was half applied");
  assert.equal(hn.names().includes("plan.approved"), false);
});

test("approval is for a person, once; a rejected plan stays rejected; unknown plans are not found", async () => {
  const hn = harness();
  const t = await chat(hn);
  const p = hn.seedPlan(t);
  assert.equal(await failure(() => h["chat.approve_plan"]!(hn.agent(INTAKE), { threadId: t, planId: p.planId })), "validation.precondition_failed", "an agent does not approve its own plan");
  assert.equal(await failure(() => h["chat.approve_plan"]!(hn.person(MAYA), { threadId: t, planId: p.planId })), "validation.not_found");
  await h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: p.planId });
  hn.clear();
  const again = await h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: p.planId });
  assert.equal(again.plan.state, "approved");
  assert.deepEqual(hn.names(), [], "a repeat approves nothing twice");
  assert.equal(await failure(() => h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: p.planId, edits: [{ stepId: p.stepIds[0], text: "late" }] })), "validation.precondition_failed");
  const r = hn.seedPlan(t);
  hn.raw.run("UPDATE chat_plan SET state = 'rejected' WHERE id = ?", r.planId);
  assert.equal(await failure(() => h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: r.planId })), "validation.precondition_failed");
  assert.equal(await failure(() => h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: "pln_none" })), "validation.not_found");
  const other = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k2" })).thread.threadId as string;
  assert.equal(await failure(() => h["chat.approve_plan"]!(hn.ctx, { threadId: other, planId: r.planId })), "validation.not_found", "a plan belongs to its thread");
});
