// Group d of the chat handlers (P-L2_24d): transcript, plan and question blocks, helpers, handoff. Every capability has a success case checked against its frozen input and output schema and its
// declared events, and a refusal case checked by error code.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { DRAFTER, INTAKE, MAYA, REVIEWER, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { g24dHandlers as g } from "../handlers/g24d.ts";
import { answerBlock, approvePlan, start } from "../handlers/thread.ts";

const NAMES = Object.keys(g);
const cap = (name: string) => registry.capabilities.filter((c) => c.name === name).sort((a, b) => b.v - a.v)[0]!;
const chatOf = async (hn: Harness): Promise<string> => (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
const turn = (n: number) => `trn_t${n}`;
const rows = (text: string) => [{ role: "user", kind: "text", content: text }, { role: "assistant", kind: "text", content: { text: `answer to ${text}` } }];

/** Run, then check the answer against the output schema, the events against the capability's list and their payloads against the event schemas. */
async function ok<T>(hn: Harness, name: string, input: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  assert.deepEqual(contractErrors(name, "in", input), [], `${name}: input`);
  hn.clear();
  const out = await run();
  assert.deepEqual(contractErrors(name, "out", out), [], `${name}: output`);
  for (const e of hn.emitted) assert.ok((cap(name).emits as readonly string[]).includes(e.name), `${name} emitted undeclared ${e.name}`);
  assert.deepEqual(assertEventsConform(hn), [], name);
  return out;
}
async function refuses(hn: Harness, name: string, code: string, run: () => Promise<unknown>): Promise<void> {
  assert.equal(await failure(run), code, name);
  assert.ok((cap(name).errors as readonly string[]).includes(code), `${name} does not declare ${code}`);
}

test("the table holds the thirteen capabilities of this group, all frozen chat capabilities, each example input valid", () => {
  assert.equal(NAMES.length, 13);
  for (const name of NAMES) {
    const c = cap(name);
    assert.equal(c.module, "chat", name);
    assert.ok(c.examples.length > 0, `${name} has an example`);
    for (const ex of c.examples) assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example ${ex.name}`);
  }
});

test("transcript: append, get, read, summary", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const input = { threadId, turnId: turn(1), rows: [...rows("fix the login page"), { role: "tool", kind: "tool_call", content: { cmd: "ls" }, toolName: "Bash", toolCallId: "tc1" }] };
  const out = await ok(hn, "chat.transcript.append", input, () => g["chat.transcript.append"](hn.ctx, input));
  assert.equal(out.appended, 3);
  // the same turn again is the same turn
  assert.equal((await g["chat.transcript.append"](hn.ctx, input)).appended, 3);
  assert.equal(hn.rows("SELECT idx FROM chat_transcript_row WHERE thread = ?", threadId).length, 3);
  await g["chat.transcript.append"](hn.ctx, { threadId, turnId: turn(2), rows: rows("second") });
  assert.deepEqual(hn.rows("SELECT idx FROM chat_transcript_row WHERE thread = ? ORDER BY idx", threadId).map((r) => r["idx"]), [1, 2, 3, 4, 5]);

  const got = await ok(hn, "chat.transcript.get", { threadId, turnId: turn(1) }, () => g["chat.transcript.get"](hn.ctx, { threadId, turnId: turn(1) }));
  assert.deepEqual(got.rows.map((r) => r.idx), [1, 2, 3]);
  assert.equal(got.rows[2]!.toolName, "Bash");

  const rd = { threadId, fromIdx: 1, limit: 2 };
  const first = await ok(hn, "chat.transcript.read", rd, () => g["chat.transcript.read"](hn.ctx, rd));
  assert.match(first.markdown, /fix the login page/);
  assert.equal(first.next, 3);
  const rest = await g["chat.transcript.read"](hn.ctx, { threadId, fromIdx: first.next!, limit: 10 });
  assert.equal(rest.next, undefined);
  assert.match(rest.markdown, /second/);

  const empty = await ok(hn, "chat.transcript.summary", { threadId }, () => g["chat.transcript.summary"](hn.ctx, { threadId }));
  assert.equal(empty.upToIdx, 0);
  assert.equal(empty.transcriptPath, `chats/${threadId}/transcript.md`);
});

test("transcript: a credential never reaches the stored rows", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const key = ["sk", "ant", "a".repeat(30)].join("-");
  await g["chat.transcript.append"](hn.ctx, { threadId, turnId: turn(1), rows: [{ role: "user", kind: "text", content: `use ${key} please` }] });
  const stored = String(hn.rows("SELECT content FROM chat_transcript_row WHERE thread = ?", threadId)[0]!["content"]);
  assert.ok(!stored.includes(key));
  assert.match(stored, /redacted/);
});

test("transcript refusals: missing thread, empty turn, another chat's turn, a stranger", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const other = await chatOf(hn);
  await g["chat.transcript.append"](hn.ctx, { threadId, turnId: turn(1), rows: rows("one") });
  await refuses(hn, "chat.transcript.append", "validation.not_found", () => g["chat.transcript.append"](hn.ctx, { threadId: "thr_none", turnId: turn(9), rows: rows("x") }));
  await refuses(hn, "chat.transcript.append", "validation.bad_input", () => g["chat.transcript.append"](hn.ctx, { threadId, turnId: turn(9), rows: [] }));
  await refuses(hn, "chat.transcript.append", "validation.bad_input", () => g["chat.transcript.append"](hn.ctx, { threadId: other, turnId: turn(1), rows: rows("x") }));
  await refuses(hn, "chat.transcript.get", "validation.not_found", () => g["chat.transcript.get"](hn.ctx, { threadId, turnId: "trn_none" }));
  await refuses(hn, "chat.transcript.read", "validation.not_found", () => g["chat.transcript.read"](hn.person(MAYA), { threadId }));
  await refuses(hn, "chat.transcript.summary", "validation.not_found", () => g["chat.transcript.summary"](hn.person(MAYA), { threadId }));
  await refuses(hn, "chat.transcript.summarize", "validation.not_found", () => g["chat.transcript.summarize"](hn.ctx, { threadId: "thr_none" }));
});

test("transcript search finds words in the asker's own chats only", async () => {
  const hn = harness();
  const mine = await chatOf(hn);
  const maya = (await start(hn.person(MAYA), { kind: "chat", agentIds: [DRAFTER] })).thread["threadId"] as string;
  await g["chat.transcript.append"](hn.ctx, { threadId: mine, turnId: turn(1), rows: rows("the retainer agreement for Northwind") });
  await g["chat.transcript.append"](hn.person(MAYA), { threadId: maya, turnId: turn(2), rows: rows("retainer secrets") });
  const input = { q: "retainer northwind", limit: 5 };
  const out = await ok(hn, "chat.transcript.search", input, () => g["chat.transcript.search"](hn.ctx, input));
  assert.deepEqual(new Set(out.hits.map((h) => h.threadId)), new Set([mine]));
  const user = out.hits.find((h) => h.idx === 1)!;
  assert.equal(user.role, "user");
  assert.match(user.link, /transcript\.md#1$/);
  assert.equal((await g["chat.transcript.search"](hn.ctx, { q: "retainer", agentId: DRAFTER })).hits.length, 0);
  assert.equal((await g["chat.transcript.search"](hn.ctx, { q: "retainer", mode: "semantic", threadId: mine })).hits.length, 2);
  await refuses(hn, "chat.transcript.search", "validation.bad_input", () => g["chat.transcript.search"](hn.ctx, { q: "  " }));
  await refuses(hn, "chat.transcript.search", "validation.bad_input", () => g["chat.transcript.search"](hn.ctx, { q: "retainer", threadId: maya }));
});

test("transcript summarize: no provider call, the extract covers all but the newest twenty turns", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  for (let i = 1; i <= 25; i++) await g["chat.transcript.append"](hn.ctx, { threadId, turnId: turn(i), rows: [{ role: "user", kind: "text", content: `question number ${i}` }] });
  const out = await ok(hn, "chat.transcript.summarize", { threadId }, () => g["chat.transcript.summarize"](hn.ctx, { threadId }));
  assert.equal(out.upToIdx, 5);
  assert.equal(hn.callLog.length, 0);
  const sum = await g["chat.transcript.summary"](hn.ctx, { threadId });
  assert.equal(sum.upToIdx, 5);
  assert.match(sum.summary, /question number 5/);
  assert.ok(!/question number 6\b/.test(sum.summary));
  assert.equal((await g["chat.transcript.summarize"](hn.ctx, { threadId })).upToIdx, 5);
});

test("chat.question.ask writes the block the answer capability expects", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const input = { threadId, prompt: "Which court?", mode: "single" as const, options: [{ key: "a", label: "Superior" }, { key: "b", label: "Federal" }], allowOther: true };
  const out = await ok(hn, "chat.question.ask", input, () => g["chat.question.ask"](hn.agent(), input));
  assert.deepEqual(hn.names().sort(), ["block.waiting", "message.received"]);
  assert.equal(hn.rows("SELECT state FROM chat_block WHERE id = ?", out.blockId)[0]!["state"], "waiting");
  assert.deepEqual(await answerBlock(hn.ctx, { threadId, blockId: out.blockId, answer: "b" }), { ok: true });
  const free = await g["chat.question.ask"](hn.agent(), { threadId, prompt: "Anything else?", mode: "free" });
  assert.deepEqual(await answerBlock(hn.ctx, { threadId, blockId: free.blockId, answer: "No" }), { ok: true });
  await refuses(hn, "chat.question.ask", "validation.bad_input", () => g["chat.question.ask"](hn.agent(), { threadId, prompt: "Pick", mode: "single" }));
  await refuses(hn, "chat.question.ask", "validation.bad_input", () => g["chat.question.ask"](hn.agent(), { threadId, prompt: "Pick", mode: "multi", options: [{ key: "a", label: "A" }, { key: "a", label: "B" }] }));
  await refuses(hn, "chat.question.ask", "validation.bad_input", () => g["chat.question.ask"](hn.agent(), { threadId, prompt: " ", mode: "free" }));
  await refuses(hn, "chat.question.ask", "validation.not_found", () => g["chat.question.ask"](hn.person(MAYA), { threadId, prompt: "Hi", mode: "free" }));
});

test("plans: propose, approve, tick steps, reject", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const input = { threadId, title: "Move the file", steps: [{ text: "Read it", detail: "all of it" }, { text: "Move it" }] };
  const made = await ok(hn, "chat.plan.propose", input, () => g["chat.plan.propose"](hn.agent(), input));
  assert.deepEqual(hn.names().sort(), ["block.waiting", "message.received", "plan.proposed"]);
  const stored = hn.rows("SELECT steps, state FROM chat_plan WHERE id = ?", made.planId)[0]!;
  const steps = JSON.parse(String(stored["steps"])) as Array<{ stepId: string; state: string }>;
  assert.equal(steps.length, 2);
  assert.equal(stored["state"], "proposed");

  // ticking before approval is refused; after approval the steps tick and the plan finishes
  await refuses(hn, "chat.plan.step_done", "validation.bad_input", () => g["chat.plan.step_done"](hn.agent(), { threadId, planId: made.planId, stepId: steps[0]!.stepId }));
  const approved = await approvePlan(hn.ctx, { threadId, planId: made.planId });
  assert.equal(approved.plan.state, "approved");
  const tick = { threadId, planId: made.planId, stepId: steps[0]!.stepId };
  const one = await ok(hn, "chat.plan.step_done", tick, () => g["chat.plan.step_done"](hn.agent(), tick));
  assert.deepEqual(one.plan.steps.map((s) => s.state), ["done", "todo"]);
  assert.deepEqual(hn.names(), ["plan.step_done"]);
  hn.clear();
  assert.deepEqual((await g["chat.plan.step_done"](hn.agent(), tick)).plan.steps.map((s) => s.state), ["done", "todo"]);
  assert.deepEqual(hn.names(), []);
  await g["chat.plan.step_done"](hn.agent(), { ...tick, stepId: steps[1]!.stepId });
  assert.equal(hn.rows("SELECT state FROM chat_plan WHERE id = ?", made.planId)[0]!["state"], "done");
  await refuses(hn, "chat.plan.step_done", "validation.bad_input", () => g["chat.plan.step_done"](hn.agent(), { ...tick, stepId: "stp_none" }));
  await refuses(hn, "chat.plan.step_done", "validation.not_found", () => g["chat.plan.step_done"](hn.agent(), { ...tick, planId: "pln_none" }));

  // reject: a person sends it back with a note and plan mode stays as it was
  const second = await g["chat.plan.propose"](hn.agent(), { threadId, title: "Again", steps: [{ text: "Try" }] });
  hn.raw.run("UPDATE chat_thread SET modePlan = 1 WHERE id = ?", threadId);
  const rej = { threadId, planId: second.planId, note: "Too broad" };
  await refuses(hn, "chat.plan.reject", "validation.bad_input", () => g["chat.plan.reject"](hn.agent(), rej));
  assert.deepEqual(await ok(hn, "chat.plan.reject", rej, () => g["chat.plan.reject"](hn.ctx, rej)), { ok: true });
  assert.deepEqual(hn.names().sort(), ["block.answered", "plan.rejected"]);
  assert.equal(hn.rows("SELECT state FROM chat_plan WHERE id = ?", second.planId)[0]!["state"], "rejected");
  assert.equal(hn.rows("SELECT modePlan FROM chat_thread WHERE id = ?", threadId)[0]!["modePlan"], 1);
  assert.match(String(hn.rows("SELECT answer FROM chat_block WHERE id = ?", second.blockId)[0]!["answer"]), /Too broad/);
  assert.deepEqual(await g["chat.plan.reject"](hn.ctx, rej), { ok: true });
  await refuses(hn, "chat.plan.reject", "validation.bad_input", () => g["chat.plan.reject"](hn.ctx, { threadId, planId: made.planId }));
  await refuses(hn, "chat.plan.reject", "validation.not_found", () => g["chat.plan.reject"](hn.ctx, { threadId, planId: "pln_none" }));
});

test("plan propose refusals", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  await refuses(hn, "chat.plan.propose", "validation.bad_input", () => g["chat.plan.propose"](hn.agent(), { threadId, title: "Empty", steps: [] }));
  await refuses(hn, "chat.plan.propose", "validation.bad_input", () => g["chat.plan.propose"](hn.agent(), { threadId, title: "Blank", steps: [{ text: " " }] }));
  await refuses(hn, "chat.plan.propose", "validation.not_found", () => g["chat.plan.propose"](hn.agent(), { threadId: "thr_none", title: "x", steps: [{ text: "y" }] }));
  await refuses(hn, "chat.plan.propose", "validation.not_found", () => g["chat.plan.propose"](hn.person(MAYA), { threadId, title: "x", steps: [{ text: "y" }] }));
});

test("helpers: start, list, refusals", async () => {
  const hn = harness();
  const threadId = await chatOf(hn);
  const input = { threadId, title: "Check the dates", instruction: "List every date in the deed.", agentId: DRAFTER, model: "claude-haiku-4-5", provider: "anthropic", effort: "low" as const };
  const out = await ok(hn, "chat.helper.start", input, () => g["chat.helper.start"](hn.agent(), input));
  assert.deepEqual(hn.names().sort(), ["helper.started", "message.received", "message.received", "thread.started"]);
  assert.equal(out.helper["kind"], "helper");
  assert.equal(out.helper["parentThreadId"], threadId);
  assert.equal((out.helper["path"] as unknown[]).length, 2);
  const agents = out.helper["agents"] as Array<Record<string, unknown>>;
  assert.equal(agents[0]!["agentId"], DRAFTER);
  assert.equal(agents[0]!["model"], "claude-haiku-4-5");

  const list = await ok(hn, "chat.helpers.list", { threadId }, () => g["chat.helpers.list"](hn.ctx, { threadId }));
  assert.equal(list.helpers.length, 1);
  assert.equal(list.helpers[0]!.status, "running");
  assert.equal(list.helpers[0]!.agentId, DRAFTER);
  await refuses(hn, "chat.helper.start", "validation.bad_input", () => g["chat.helper.start"](hn.agent(), { threadId: out.helper["threadId"] as string, title: "Nested", instruction: "x" }));
  hn.raw.run("UPDATE chat_thread SET closedAt = ? WHERE id = ?", hn.clock.t, out.helper["threadId"]);
  assert.equal((await g["chat.helpers.list"](hn.ctx, { threadId })).helpers[0]!.status, "done");
  await refuses(hn, "chat.helper.start", "validation.bad_input", () => g["chat.helper.start"](hn.agent(), { threadId, title: "", instruction: "x" }));
  await refuses(hn, "chat.helper.start", "validation.not_found", () => g["chat.helper.start"](hn.person(MAYA), { threadId, title: "t", instruction: "x" }));
  await refuses(hn, "chat.helpers.list", "validation.not_found", () => g["chat.helpers.list"](hn.person(MAYA), { threadId }));
});

test("handoff opens a linked thread for the other agent and counts the hop", async () => {
  const hn = harness({ calls: { "settings.get": () => ({ row: { value: 2 } }) } });
  const threadId = await chatOf(hn);
  const input = { threadId, toAgentId: REVIEWER, note: "Please review the draft." };
  const out = await ok(hn, "chat.handoff", input, () => g["chat.handoff"](hn.agent(INTAKE), input));
  assert.equal(out.depth, 1);
  assert.deepEqual(hn.names().sort(), ["agent.handoff", "message.received", "thread.started"]);
  assert.equal(out.thread["parentThreadId"], threadId);
  assert.equal((out.thread["agents"] as Array<Record<string, unknown>>)[0]!["agentId"], REVIEWER);
  assert.deepEqual(hn.named("agent.handoff")[0]!.payload, { fromThreadId: threadId, toThreadId: out.thread["threadId"], fromAgentId: INTAKE, toAgentId: REVIEWER, depth: 1 });

  // an agent's last line makes the next handoff a second hop; a third is over the limit of 2
  await g["chat.question.ask"](hn.agent(), { threadId, prompt: "Ok?", mode: "free" });
  hn.raw.run("UPDATE chat_message SET depth = 1 WHERE thread = ?", threadId);
  assert.equal((await g["chat.handoff"](hn.agent(INTAKE), input)).depth, 2);
  hn.raw.run("UPDATE chat_message SET depth = 2 WHERE thread = ?", threadId);
  await refuses(hn, "chat.handoff", "validation.precondition_failed", () => g["chat.handoff"](hn.agent(INTAKE), input));
  await refuses(hn, "chat.handoff", "validation.bad_input", () => g["chat.handoff"](hn.agent(INTAKE), { threadId, toAgentId: INTAKE, note: "me" }));
  await refuses(hn, "chat.handoff", "validation.bad_input", () => g["chat.handoff"](hn.agent(INTAKE), { threadId, toAgentId: "usr_dana", note: "x" }));
  await refuses(hn, "chat.handoff", "validation.not_found", () => g["chat.handoff"](hn.agent(INTAKE), { threadId: "thr_none", toAgentId: REVIEWER, note: "x" }));
});
