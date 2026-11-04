// @tsx
// A chip for an email thread opens the Inbox conversation the server maps its provider thread id to; a thread the reader cannot see opens nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { openMailThread } from "./chats-data.ts";

const run = async (answer: unknown) => {
  const calls: unknown[] = [], opened: unknown[] = [];
  openMailThread({ call: async (cap: string, input: unknown) => { calls.push([cap, input]); return answer; }, open: (t: unknown) => { opened.push(t); } } as never, "1a189cd04d416be8");
  await new Promise((r) => setTimeout(r, 5));
  return { calls, opened };
};

test("the chip asks the server which conversation holds the thread, and opens it, scrolled to the thread", async () => {
  const { calls, opened } = await run({ conversationId: "cnv_abc123" });
  assert.deepEqual(calls, [["inbox.thread_conversation", { threadId: "1a189cd04d416be8" }]]);
  assert.deepEqual(opened, [{ subject: { type: "conversation", id: "cnv_abc123" }, args: { threadId: "1a189cd04d416be8" } }]);
});

test("an unknown or unseen thread opens nothing", async () => {
  assert.deepEqual((await run({})).opened, []);
});
