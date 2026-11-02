// Unread everywhere a conversation shows (owner report, rc.14): a direct message names the one person it is with, so the People row can carry its unread; Mark as Unread moves the read cursor back to
// the newest message from someone else; the Threads row counts what is new in the inline threads I am in. A message I wrote is never unread for me. All against the frozen contract.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../handlers/index.ts";
import { unreadOf } from "../handlers/g24a.ts";
import { DANA, INTAKE, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const key = (): string => `u${++n}`;
type Row = { threadId: string; unread: number; people?: string[] };
async function recent(ctx: Harness["ctx"]): Promise<{ rows: Row[]; threadsUnread: number }> {
  const out = await h["chat.recent"]!(ctx, {});
  assert.deepEqual(contractErrors("chat.recent", "out", out), []);
  return { rows: [...out.starred, ...out.today, ...out.yesterday, ...out.earlier] as Row[], threadsUnread: out.threadsUnread as number };
}
async function mark(ctx: Harness["ctx"], input: Record<string, unknown>): Promise<{ unread: number }> {
  assert.deepEqual(contractErrors("threads.mark_read", "in", input), [], "threads.mark_read input");
  const out = await h["threads.mark_read"]!(ctx, input);
  assert.deepEqual(contractErrors("threads.mark_read", "out", out), []);
  return out;
}

test("a direct message names the other person on each side, and what one writes is unread only for the other", async () => {
  const hn = harness();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: dm, body: "Maya, a minute?", idempotencyKey: key() });
  const mine = (await recent(hn.ctx)).rows.find((r) => r.threadId === dm)!;
  assert.deepEqual(mine.people, [MAYA], "Dana's row is with Maya");
  assert.equal(mine.unread, 0, "a message Dana wrote is never unread for her");
  const hers = (await recent(hn.person(MAYA))).rows.find((r) => r.threadId === dm)!;
  assert.deepEqual(hers.people, [DANA], "Maya's row is with Dana");
  assert.equal(hers.unread, 1);
  const agentChat = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: agentChat, body: "hello", idempotencyKey: key() });
  assert.deepEqual((await recent(hn.ctx)).rows.find((r) => r.threadId === agentChat)!.people, [], "a chat with an agent has no other person");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("Mark as Unread makes the newest message from someone else new again; Mark as Read clears it; a chat with nothing from anyone else stays read", async () => {
  const hn = harness();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], personId: MAYA, idempotencyKey: key() })).thread.threadId as string;
  for (const body of ["one", "two"]) await h["chat.post"]!(hn.person(MAYA), { threadId: dm, body, idempotencyKey: key() });
  await h["chat.post"]!(hn.ctx, { threadId: dm, body: "my answer", idempotencyKey: key() });
  assert.deepEqual(await mark(hn.ctx, { threadId: dm }), { unread: 0 });
  assert.deepEqual(await mark(hn.ctx, { threadId: dm, unread: true }), { unread: 1 }, "Maya's last message is new again; Dana's own answer never is");
  assert.equal((await recent(hn.ctx)).rows.find((r) => r.threadId === dm)!.unread, 1);
  assert.deepEqual(await mark(hn.ctx, { threadId: dm, unread: true }), { unread: 1 }, "twice is the same");
  assert.deepEqual(await mark(hn.ctx, { threadId: dm }), { unread: 0 });
  assert.equal(unreadOf(hn.ctx, dm, MAYA), 1, "Maya's cursor is her own: Dana's answer is new to her");
  const solo = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key() })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: solo, body: "only me", idempotencyKey: key() });
  assert.deepEqual(await mark(hn.ctx, { threadId: solo, unread: true }), { unread: 0 }, "nothing from anyone else: nothing to be new");
  let code = "none";
  try { await h["threads.mark_read"]!(hn.ctx, { threadId: dm, unread: true, upto: 1 }); } catch (e) { code = codeOf(e); }
  assert.equal(code, "validation.bad_input", "Mark as Unread takes no sequence number");
  assert.equal(hn.rows("SELECT seq FROM chat_thread_read WHERE thread = ? AND principal = ?", dm, DANA)[0]!["seq"], 3, "the refused call wrote nothing");
});

test("the Threads count: a reply in an inline thread I am in is new for me, mine is not, and reading it clears it", async () => {
  const hn = harness();
  const ch = (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [], idempotencyKey: key() })).channel;
  const root = (await h["chat.post"]!(hn.ctx, { threadId: ch.mainThreadId, body: "who takes Rivera?", idempotencyKey: key() })).message.messageId as string;
  const th = (await h["chat.thread"]!(hn.ctx, { threadId: ch.mainThreadId, messageId: root })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: th, body: "I can, after lunch", idempotencyKey: key() });
  assert.equal((await recent(hn.ctx)).threadsUnread, 0, "my own reply is not new to me");
  await h["chat.post"]!(hn.person(MAYA), { threadId: th, body: "I'll do it", idempotencyKey: key() });
  assert.equal((await recent(hn.ctx)).threadsUnread, 1);
  await mark(hn.ctx, { threadId: th });
  assert.equal((await recent(hn.ctx)).threadsUnread, 0);
});
