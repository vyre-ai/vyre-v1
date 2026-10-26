// The sealed-thread guard in front of chat.post (spec 5 b7): the first sealed message from the owner seals a private thread, and after that only messages sealed under the same key are stored.
// Threads that were never sealed, direct messages between people, and channels keep the rules of chat.post as they were.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { lastMessages } from "../projections.ts";
import { blockAad, bodyAad, sealText, sealedBy, threadKeyOf } from "../handlers/private.ts";
import { DANA, INTAKE, LEO, MAYA, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const KEY = Buffer.alloc(32, 0x5a);
const OTHER = Buffer.alloc(32, 0x6b);
let n = 0;

function seal(threadId: string, text: string, o: { key?: Uint8Array; id?: string; blocks?: unknown[]; clientId?: boolean } = {}) {
  const key = threadKeyOf(o.key ?? KEY, threadId);
  const id = o.id ?? `msg_g${++n}${threadId.slice(4, 12)}`;
  return {
    threadId, idempotencyKey: `k${id}`, ...(o.clientId === false ? {} : { clientId: id }),
    body: text === "" ? "" : sealText(key, threadId, bodyAad(threadId, id), text),
    ...(o.blocks ? { blocks: o.blocks.map((d, i) => ({ type: "note", v: 1, data: sealText(key, threadId, blockAad(threadId, id, i), JSON.stringify(d)) })) } : {}),
  };
}
const plain = (threadId: string, body: string, extra: Record<string, unknown> = {}) => ({ threadId, body, idempotencyKey: `p${++n}`, ...extra });

async function reasonOf(f: () => unknown): Promise<[string, string | undefined]> {
  try { await f(); } catch (e) {
    const err = (e as { error?: { code?: string; details?: { reason?: string } } }).error;
    return [err?.code ?? "unknown", err?.details?.reason];
  }
  return ["none", undefined];
}
const newChat = async (hn: Harness): Promise<string> => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `s${++n}` })).thread.threadId;

test("a private thread nobody sealed takes plain text, as chat.post always did; the first sealed message from the owner seals it", async () => {
  const hn = harness();
  const t = await newChat(hn);
  await h["chat.post"]!(hn.ctx, plain(t, "an old message"));
  assert.equal(sealedBy(hn.db, t), null);
  await h["chat.post"]!(hn.ctx, seal(t, "now sealed"));
  assert.equal(sealedBy(hn.db, t)?.owner, DANA);
  assert.deepEqual(await reasonOf(() => h["chat.post"]!(hn.ctx, plain(t, "plain again"))), ["validation.bad_input", "sealed_thread"]);
  assert.equal(lastMessages(hn.db, t).length, 2, "the refused message was not stored");
});

test("a sealed thread takes only its own key: another key, a plain block, a mixed message, a missing message id", async () => {
  const hn = harness();
  const t = await newChat(hn);
  await h["chat.post"]!(hn.ctx, seal(t, "first"));
  assert.deepEqual(await reasonOf(() => h["chat.post"]!(hn.ctx, seal(t, "other key", { key: OTHER }))), ["validation.bad_input", "sealed_thread"]);
  assert.deepEqual(await reasonOf(() => h["chat.post"]!(hn.ctx, { ...seal(t, "x"), blocks: [{ type: "note", v: 1, data: { text: "plain block" } }] })), ["validation.bad_input", "sealed_thread"]);
  assert.deepEqual(await reasonOf(() => h["chat.post"]!(hn.ctx, seal(t, "no id", { clientId: false }))), ["validation.bad_input", "client_id_needed"]);
  assert.equal(lastMessages(hn.db, t).length, 1);
  // a block-only message has no text to hide: an empty body and sealed blocks is a message
  const ok = await h["chat.post"]!(hn.ctx, seal(t, "", { blocks: [{ n: 1 }] }));
  assert.equal(ok.message.body, "");
  assert.equal(lastMessages(hn.db, t).length, 2);
});

test("only the owner seals a thread, and a message that is refused does not seal it", async () => {
  const hn = harness();
  const t = await newChat(hn);
  assert.deepEqual(await reasonOf(() => h["chat.post"]!(hn.person(MAYA), seal(t, "from Maya"))), ["permission.no_grant", undefined]);
  assert.equal(sealedBy(hn.db, t), null);
  await h["chat.post"]!(hn.ctx, plain(t, "hello"));
  // a sealed message that chat.post itself refuses (a closed thread) leaves the thread unsealed
  hn.raw.run("UPDATE chat_thread SET closedAt = ? WHERE id = ?", 1, t);
  assert.equal((await reasonOf(() => h["chat.post"]!(hn.ctx, seal(t, "into a closed thread"))))[0], "validation.bad_input");
  assert.equal(sealedBy(hn.db, t), null);
});

test("direct messages between people, channels and a missing thread keep the rules of chat.post", async () => {
  const hn = harness();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, agentIds: [], idempotencyKey: "dm" })).thread.threadId;
  await h["chat.post"]!(hn.ctx, plain(dm, "hi Maya"));
  await h["chat.post"]!(hn.person(MAYA), plain(dm, "hi Dana"));
  await h["chat.post"]!(hn.ctx, seal(dm, "sealed in a dm"));
  assert.equal(sealedBy(hn.db, dm), null, "a direct message is never sealed by this guard");
  await h["chat.post"]!(hn.person(MAYA), plain(dm, "still plain"));

  const channel = (await h["channels.create"]!(hn.ctx, { name: "team", visibility: "public", memberIds: [LEO], idempotencyKey: "ch" })).channel;
  await h["chat.post"]!(hn.person(LEO), plain(channel.mainThreadId, "channel text the server may read"));
  assert.equal(lastMessages(hn.db, channel.mainThreadId)[0]!.body, "channel text the server may read");
  assert.equal((await reasonOf(() => h["chat.post"]!(hn.ctx, plain("thr_none", "x"))))[0], "validation.not_found");
});

test("an inline thread under a sealed chat is sealed with it", async () => {
  const hn = harness();
  const t = await newChat(hn);
  const first = await h["chat.post"]!(hn.ctx, seal(t, "root"));
  const sub = (await h["chat.thread"]!(hn.ctx, { threadId: t, messageId: first.message.messageId })).thread.threadId;
  assert.deepEqual(await reasonOf(() => h["chat.post"]!(hn.ctx, plain(sub, "plain in the thread"))), ["validation.bad_input", "sealed_thread"]);
});
