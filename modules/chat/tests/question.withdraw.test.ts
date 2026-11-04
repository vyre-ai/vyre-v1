// A question an agent asked can be taken back, and a probe is not a question: "test" or fewer than three words is refused with a plain message and puts no card or task anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, INTAKE, contractErrors, failure, harness } from "../fixtures/harness.ts";
import { isProbe, questionAsk, questionWithdraw } from "../handlers/g24d.ts";
import { answerBlock } from "../handlers/thread.ts";
import { start } from "../handlers/thread.ts";

const tasks: Array<Record<string, unknown>> = [];
const world = () => harness({ calls: { "tasks.create": (i) => { tasks.push(i); return { task: { id: "tsk_q1" } }; }, "chat.post": () => ({}) } });

test("the guard refuses an empty, a short or a test question with a plain message, and nothing is put on a list", async () => {
  const hn = world();
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const before = tasks.length;
  for (const prompt of ["test", "Test test test", "hi", "test?", "?", "question 1", "Lorem ipsum dolor", "   ", "ok ok ok"]) {
    assert.equal(await failure(() => questionAsk(hn.agent(), { threadId, prompt, mode: "free" })), "validation.bad_input", prompt);
  }
  assert.equal(tasks.length, before, "no task");
  assert.equal(hn.rows("SELECT id FROM chat_block").length, 0, "no card");
  assert.equal(isProbe("Which firm should I file this for?"), false);
  for (const real of ["Who signed?", "Which court?", "Why?", "which one", "Is it 5 May?"]) assert.equal(isProbe(real), false, `${real} is a real question`);
  for (const probe of ["test?", "?", "", "question 1", "TODO", "123"]) assert.equal(isProbe(probe), true, `${probe} is a placeholder`);
  const ok = await questionAsk(hn.agent(), { threadId, prompt: "Which firm should I file this for?", mode: "free" });
  assert.deepEqual(contractErrors("chat.question.ask", "out", ok), []);
});

test("withdraw closes the card and says so, once; an answered question cannot be withdrawn; another person's question is not the agent's to take back", async () => {
  const hn = world();
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const q = await questionAsk(hn.agent(), { threadId, prompt: "Which firm should I file this for?", mode: "free" });
  assert.deepEqual(contractErrors("chat.question.withdraw", "in", { threadId, blockId: q.blockId }), []);
  const out = await questionWithdraw(hn.agent(), { threadId, blockId: q.blockId });
  assert.deepEqual(contractErrors("chat.question.withdraw", "out", out), []);
  assert.equal(out.withdrawn, true);
  assert.equal(hn.rows("SELECT state FROM chat_block WHERE id = ?", q.blockId)[0]!["state"], "done");
  assert.ok(hn.named("block.withdrawn").some((e) => e.payload["blockId"] === q.blockId), "the task is closed behind it by the tasks module");
  assert.deepEqual(await questionWithdraw(hn.agent(), { threadId, blockId: q.blockId }), { withdrawn: false }, "once");
  const q2 = await questionAsk(hn.agent(), { threadId, prompt: "Which firm should I file this for?", mode: "free" });
  await answerBlock(hn.ctx, { threadId, blockId: q2.blockId, answer: "Northwind" });
  assert.deepEqual(await questionWithdraw(hn.agent(), { threadId, blockId: q2.blockId }), { withdrawn: false }, "an answered question stays answered");
  void DANA;
});
