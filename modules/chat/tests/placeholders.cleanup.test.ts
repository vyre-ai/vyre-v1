// The one-time clean-up of question cards an agent threw in as a test: placeholder ones close as withdrawn (so their tasks leave Needs you), real ones and answered ones stay as they are, and it runs once.
import test from "node:test";
import assert from "node:assert/strict";
import { INTAKE, harness } from "../fixtures/harness.ts";
import { closePlaceholderQuestions } from "../handlers/placeholders.ts";
import { questionAsk } from "../handlers/g24d.ts";
import { answerBlock, start } from "../handlers/thread.ts";
import { insertBlock, insertMessage } from "../projections.ts";

const leftover = (hn: ReturnType<typeof harness>, threadId: string, id: string, prompt: string, options: unknown[] = []): string => {
  const m = insertMessage(hn.ctx, threadId, { author: INTAKE, kind: "agent", body: "", blocks: [{ type: "question", v: 1, id, data: { threadId, blockId: id, prompt, mode: "free", options, allowOther: false }, state: "waiting", traceId: "t" }] });
  insertBlock(hn.ctx, { id, thread: threadId, message: m.id, type: "question", data: { threadId, blockId: id, prompt, mode: "free", options, allowOther: false } });
  return id;
};
const state = (hn: ReturnType<typeof harness>, id: string): unknown => hn.rows("SELECT state FROM chat_block WHERE id = ?", id)[0]?.["state"];

test("placeholder question cards close and nothing else does; it runs once", async () => {
  const hn = harness({ calls: { "tasks.create": () => ({ task: { id: "tsk_1" } }), "chat.post": () => ({}) } });
  const threadId = (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE] })).thread["threadId"] as string;
  const test1 = leftover(hn, threadId, "blk_test1", "test");
  const test2 = leftover(hn, threadId, "blk_test2", "Is example.com the right site?");
  const real = (await questionAsk(hn.agent(), { threadId, prompt: "Which firm should I file this for?", mode: "free" })).blockId;
  const answered = (await questionAsk(hn.agent(), { threadId, prompt: "Which court is the matter in?", mode: "free" })).blockId;
  await answerBlock(hn.ctx, { threadId, blockId: answered, answer: "Superior Court" });
  hn.clear();
  assert.deepEqual(closePlaceholderQuestions(hn.ctx), { closed: 2, ran: true });
  assert.deepEqual([state(hn, test1), state(hn, test2), state(hn, real), state(hn, answered)], ["done", "done", "waiting", "done"]);
  assert.deepEqual(hn.named("block.withdrawn").map((e) => e.payload["blockId"]).sort(), ["blk_test1", "blk_test2"], "each closes its task through the tasks module");
  assert.equal(hn.rows("SELECT answer FROM chat_block WHERE id = ?", answered)[0]?.["answer"], '"Superior Court"', "an answered question keeps its answer");
  assert.deepEqual(closePlaceholderQuestions(hn.ctx), { closed: 0, ran: false }, "once");
});
