// chat.catch_up: what a person missed since their cursor, as a plain read: who wrote, tasks and decisions that landed, messages with an @; kept until something new arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, MAYA, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `cu-${++n}`;

test("a person catches up on what came after their cursor; their own messages and what they read are left out; a second read is the same answer", async () => {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }), "tasks.create": () => ({ task: { id: "tsk_1" } }) } });
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "old news", idempotencyKey: key() });
  await h["threads.mark_read"]!(hn.ctx, { threadId: dm });
  const ask = (await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "@Dana can you send the letter?", idempotencyKey: key() })).message.messageId as string;
  const ship = (await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body: "We ship on Friday", idempotencyKey: key() })).message.messageId as string;
  await h["chat.post"]!(hn.ctx, { threadId: dm, body: "my own line", idempotencyKey: key() });
  await h["chat.make_task"]!(hn.person(MAYA), { threadId: dm, messageId: ship, idempotencyKey: key() });
  const a = await h["chat.catch_up"]!(hn.ctx, { threadId: dm });
  assert.equal(a.unread, 3, "two messages and the task card, none of mine, none before the cursor");
  assert.deepEqual(a.people, [{ id: MAYA, count: 2 }]);
  assert.equal(a.tasks.length, 1);
  assert.deepEqual(a.at.map((x: any) => x.messageId), [ask]);
  assert.equal(a.firstMessageId, ask);
  assert.deepEqual(await h["chat.catch_up"]!(hn.ctx, { threadId: dm }), a);
  await h["threads.mark_read"]!(hn.ctx, { threadId: dm });
  assert.equal((await h["chat.catch_up"]!(hn.ctx, { threadId: dm })).unread, 0);
  void DANA;
});
