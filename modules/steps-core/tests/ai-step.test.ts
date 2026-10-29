// The AI step: it asks the engine for one turn, checks the answer against its output schema, and waits for a reviewer when it has one.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { runStep, stepsTest } from "../handlers/control.ts";
import { aiStep, jsonIn, recordIdsIn } from "../handlers/ai-step.ts";
import type { StepCall, StepNode } from "../handlers/control.ts";

type H = ReturnType<typeof harness>;
/** runStep with the AI step wired the way the host wires it (modules/steps-core/impl.ts). */
const run = (h: H, node: StepNode, c: StepCall) => runStep({ ...h.env, ai: (n, i, cl) => aiStep(h.env, n, i, cl) }, node, c);
const call = (over: Partial<StepCall> = {}): StepCall => ({ attempt: 1, key: "run_t1:ask:1", outputs: { find: { rows: [{ id: "r1" }] } }, resumed: false, trigger: {}, ...over } as StepCall);
const turn = (text: string) => ({ text, keyUsed: "#Mine_Anthropic", modelUsed: "anthropic", tokensIn: 3, tokensOut: 4 });
const ask = (input: Record<string, unknown>, ai?: Record<string, unknown>): StepNode => ({ id: "ask", key: "ai", input, ...(ai ? { ai } : {}) });
const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;
const messageOf = (e: unknown): string => (e as { error?: { message?: string } } | null)?.error?.message ?? "";

test("the step sends the rendered prompt, the mapped input and the attempt key to the engine, and answers with the text", async () => {
  const h = harness({ "engine.step_turn": () => turn("Done.") });
  const r = await run(h, ask({ prompt: "Summarise {{ steps.find.out.rows[0].id }}", inputs: { n: 2 } }, { agentId: "agt_helper", keyId: "#Team_Key", backupKeyId: "#Backup", timeoutMinutes: 3 }), call());
  assert.deepEqual(r.output, { text: "Done.", keyUsed: "#Mine_Anthropic", modelUsed: "anthropic" });
  const sent = h.log[0]!;
  assert.equal(sent.cap, "engine.step_turn");
  assert.equal(sent.input.prompt, 'Summarise r1\n\nInput data:\n{\n  "n": 2\n}');
  assert.deepEqual({ ...sent.input, prompt: undefined }, { prompt: undefined, agentId: "agt_helper", keyId: "#Team_Key", backupKeyId: "#Backup", timeoutMinutes: 3, runId: "run_t1", stepId: "ask", idempotencyKey: "run_t1:ask:1" });
});

test("a Personal step with no agent and no key sends neither", async () => {
  const h = harness({ "engine.step_turn": () => turn("ok") });
  await run(h, ask({ prompt: "Hi" }), call());
  assert.deepEqual(Object.keys(h.log[0]!.input).sort(), ["idempotencyKey", "prompt", "runId", "stepId"]);
});

test("with an output schema the answer must be JSON that matches, and data carries it", async () => {
  const schema = { type: "object", required: ["score", "tags"], properties: { score: { type: "integer", minimum: 0, maximum: 10 }, tags: { type: "array", items: { type: "string" } } } };
  const good = harness({ "engine.step_turn": () => turn('Here you go:\n```json\n{"score": 7, "tags": ["a", "b"]}\n```') });
  const r = await run(good, ask({ prompt: "Score it", outputSchema: schema }), call());
  assert.deepEqual((r.output as { data: unknown }).data, { score: 7, tags: ["a", "b"] });
  assert.match(String(good.log[0]!.input.prompt), /Answer with one JSON value only/);
  assert.match(String(good.log[0]!.input.prompt), /"required":\["score","tags"\]/);
});

test("an answer that does not match the schema fails the step by its name, and one that is not JSON says so", async () => {
  const schema = { type: "object", required: ["score"], properties: { score: { type: "integer", maximum: 10 } } };
  const wrong = harness({ "engine.step_turn": () => turn('{"score": 11}') });
  await assert.rejects(run(wrong, { ...ask({ prompt: "p", outputSchema: schema }), title: "Score it" } as StepNode, call()), (e) => {
    assert.equal(codeOf(e), "validation.bad_input");
    assert.match(messageOf(e), /AI step "Score it" answered, but the answer does not match its output schema/);
    assert.match(messageOf(e), /\/score: above maximum/);
    return true;
  });
  const missing = harness({ "engine.step_turn": () => turn("{}") });
  await assert.rejects(run(missing, ask({ prompt: "p", outputSchema: schema }), call()), (e) => /required|score/.test(messageOf(e)) || codeOf(e) === "validation.bad_input");
  const prose = harness({ "engine.step_turn": () => turn("I think it is about seven.") });
  await assert.rejects(run(prose, ask({ prompt: "p", outputSchema: schema }), call()), (e) => { assert.match(messageOf(e), /did not answer with JSON/); return true; });
});

test("jsonIn finds a value in plain text, a fence, or prose around an object or a list", () => {
  assert.deepEqual(jsonIn('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(jsonIn("```\n[1,2]\n```"), { ok: true, value: [1, 2] });
  assert.deepEqual(jsonIn('Sure! {"a": {"b": [1]}} Hope that helps.'), { ok: true, value: { a: { b: [1] } } });
  assert.deepEqual(jsonIn("[1, 2] and also [3]"), { ok: true, value: [1, 2] });
  assert.deepEqual(jsonIn("no json here"), { ok: false });
});

test("an engine failure goes up by its own code so the step's error rule can retry or route", async () => {
  const h = harness({ "engine.step_turn": () => { throw Object.assign(new Error("slow down"), { error: { code: "provider.rate_limited", message: "slow down", retryable: true } }); } });
  await assert.rejects(run(h, ask({ prompt: "p" }), call()), (e) => codeOf(e) === "provider.rate_limited");
});

test("a reviewer makes the answer wait as a review task, and the step goes on only when it is accepted", async () => {
  let state = "todo";
  const h = harness({
    "engine.step_turn": () => turn("The draft."),
    "tasks.create": (i: { kind: string }) => { assert.equal(i.kind, "review"); return { task: { id: "tsk_9" } }; },
    "tasks.get": () => ({ task: { state } }),
  });
  const node = ask({ prompt: "Draft it" }, { reviewer: { kind: "person", id: "usr_dana" }, approver: { kind: "person", id: "usr_boss" } });
  const first = await run(h, node, call());
  assert.deepEqual(first.wait, { reason: "approval", taskId: "tsk_9", on: "a review", cancelOn: ["task.withdrawn"] });
  assert.equal(first.output, undefined, "nothing goes on before the review");
  const made = h.only("tasks.create")[0]!.input;
  assert.deepEqual([made.assigned, made.reviewer, made.approver, made.idempotencyKey], [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_boss" }, "run_t1:ask:1:review"]);
  assert.equal(made.summary, "The draft.");
  const waiting = await run(h, node, call({ resumed: true }));
  assert.ok(waiting.wait, "still waiting while the task is open");
  state = "done";
  const accepted = await run(h, node, call({ resumed: true }));
  assert.equal((accepted.output as { text: string }).text, "The draft.");
  state = "canceled";
  await assert.rejects(run(h, node, call({ resumed: true })), (e) => codeOf(e) === "step.failed" && /did not accept/.test(messageOf(e)));
});

test("an approver alone also holds the answer", async () => {
  const h = harness({ "engine.step_turn": () => turn("x"), "tasks.create": (i: { assigned: unknown }) => { assert.deepEqual(i.assigned, { kind: "person", id: "usr_boss" }); return { task: { id: "tsk_1" } }; } });
  const r = await run(h, ask({ prompt: "p" }, { approver: { kind: "person", id: "usr_boss" } }), call());
  assert.ok(r.wait);
});

test("in a sandbox test the step answers with its recorded sample and asks the engine nothing", async () => {
  const h = harness({ "engine.step_turn": () => { throw new Error("a sandbox must not ask a model"); } });
  const r = await run(h, ask({ prompt: "p" }), call({ sandbox: true }));
  assert.deepEqual(r.output, { text: "A sample answer.", keyUsed: "sample", modelUsed: "sample" });
  const t = await stepsTest(h.ctx, { key: "ai", input: { prompt: "p" } }) as { stubbed: boolean };
  assert.equal(t.stubbed, true);
  assert.equal(h.log.length, 0);
});

test("the prompt needs text, and a big input is refused", async () => {
  const h = harness({ "engine.step_turn": () => turn("x") });
  await assert.rejects(aiStep(h.env, ask({ prompt: "  " }), { prompt: "  " }, call()), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(aiStep(h.env, ask({}), { prompt: "p", inputs: { blob: "x".repeat(100_001) } }, call()), (e) => codeOf(e) === "validation.too_large");
});

test("the records the run read go to the engine with the turn, so the Space's label rule can be asked of them", async () => {
  assert.deepEqual(recordIdsIn({ find: { rows: [{ id: "rec_a1", label: 0 }, { id: "rec_b2" }, { id: "usr_x" }] } }, { id: "rec_a1" }, undefined, "text"), ["rec_a1", "rec_b2"]);
  assert.deepEqual(recordIdsIn(null, 4), []);
  const h = harness({ "engine.step_turn": () => turn("ok") });
  await run(h, ask({ prompt: "p" }), call({ outputs: { find: { rows: [{ id: "rec_9z" }] } } }));
  assert.deepEqual(h.log[0]!.input.recordIds, ["rec_9z"]);
  const none = harness({ "engine.step_turn": () => turn("ok") });
  await run(none, ask({ prompt: "p" }), call());
  assert.equal("recordIds" in none.log[0]!.input, false);
});
