// "Also post to the chat" from a thread (owner, 4 Nov 2026, prototype p-crew): the same words land in the chat the thread hangs in, marked as coming from the thread; the copy wakes no agent; without the flag nothing is copied.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: any, input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("a thread message sent also to the chat is copied there with a from_thread block; the copy is flagged so no agent answers it", async () => {
  const hn = harness();
  const chat = (await h["chat.start"](hn.ctx, { kind: "chat", agentIds: [INTAKE], title: "Project", idempotencyKey: "a-chat" })).thread.threadId as string;
  const root = (await h["chat.post"](hn.ctx, { threadId: chat, body: "Find a time for the call", idempotencyKey: "a-root" })).message.messageId as string;
  const thread = (await h["chat.thread"](hn.ctx, { threadId: chat, messageId: root })).thread.threadId as string;
  const plain = await h["chat.post"](hn.ctx, { threadId: thread, body: "Working on it", idempotencyKey: "a-1" });
  assert.equal(hn.rows("SELECT 1 FROM chat_message WHERE thread = ? AND body = ?", chat, "Working on it").length, 0, "no flag, no copy");
  const before = hn.named("message.received").length;
  await h["chat.post"](hn.ctx, { threadId: thread, body: "Decision: book Thursday.", alsoToChat: true, idempotencyKey: "a-2" });
  const copy = hn.rows("SELECT blocks, body FROM chat_message WHERE thread = ? AND body = ?", chat, "Decision: book Thursday.");
  assert.equal(copy.length, 1, "one copy in the chat");
  const block = (JSON.parse(String(copy[0]!["blocks"])) as Array<{ type: string; data: { threadId: string } }>)[0]!;
  assert.equal(block.type, "from_thread"); assert.equal(block.data.threadId, thread);
  const events = hn.named("message.received").slice(before);
  assert.equal(events.length, 2, "the thread message and its copy");
  assert.equal(events.filter((e) => e.payload["copy"] === true).length, 1, "the copy is flagged");
  assert.ok(plain.message.messageId);
  assert.equal(hn.rows("SELECT 1 FROM chat_message WHERE thread = ? AND body = ?", thread, "Decision: book Thursday.").length, 1, "and it stays in the thread");
  void DANA;
});
