// Per-thread sequence numbers (ARCH 6.1): every thread counts its own messages 1, 2, 3 with no gap and no repeat, whatever fails around a post, and a chat resumes from its last 50
// messages read off the (thread, threadSeq) index.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { lastMessages } from "../projections.ts";
import { INTAKE, MAYA, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;

async function chat(hn: Harness): Promise<string> {
  return (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k" })).thread.threadId;
}
let n = 0;
const say = (hn: Harness, threadId: string, body = "hello", extra: Record<string, unknown> = {}) => h["chat.post"]!(hn.ctx, { threadId, body, idempotencyKey: `p${++n}`, ...extra });

test("messages of a thread are numbered 1..n in order, and two threads count apart", async () => {
  const hn = harness();
  const a = await chat(hn), b = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k2" }).then((r) => r.thread.threadId as string);
  const seen: Record<string, number[]> = { [a]: [], [b]: [] };
  for (let i = 0; i < 25; i++) {
    for (const t of [a, b]) seen[t]!.push((await say(hn, t, `m${i}`)).message.threadSeq);
  }
  const want = Array.from({ length: 25 }, (_, i) => i + 1);
  assert.deepEqual(seen[a], want);
  assert.deepEqual(seen[b], want);
  const rows = hn.rows("SELECT threadSeq FROM chat_message WHERE thread = ? ORDER BY threadSeq", a);
  assert.deepEqual(rows.map((r) => r["threadSeq"]), want);
});

test("forty posts started in the same tick get forty different numbers, none missing", async () => {
  const hn = harness();
  const t = await chat(hn);
  const out = await Promise.all(Array.from({ length: 40 }, (_, i) => say(hn, t, `m${i}`)));
  const seqs = out.map((o) => o.message.threadSeq as number).sort((x, y) => x - y);
  assert.deepEqual(seqs, Array.from({ length: 40 }, (_, i) => i + 1));
});

test("a post that is refused takes no number", async () => {
  const hn = harness();
  const t = await chat(hn);
  assert.equal((await say(hn, t)).message.threadSeq, 1);
  assert.equal(await failure(() => say(hn, t, "   ")), "validation.bad_input");
  assert.equal(await failure(() => say(hn, t, "x", { replyTo: "msg_none" })), "validation.bad_input");
  assert.equal(await failure(() => say(hn, t, "x", { blocks: [{ type: "question", v: 1, data: {} }] })), "validation.bad_input");
  assert.equal(await failure(() => say(hn, "thr_none")), "validation.not_found");
  assert.equal(await failure(() => h["chat.post"]!(hn.person(MAYA), { threadId: t, body: "let me in", idempotencyKey: "z" })), "validation.not_found");
  hn.raw.run("UPDATE chat_thread SET closedAt = 1 WHERE id = ?", t);
  assert.equal(await failure(() => say(hn, t)), "validation.bad_input");
  hn.raw.run("UPDATE chat_thread SET closedAt = NULL WHERE id = ?", t);
  assert.equal((await say(hn, t)).message.threadSeq, 2);
  assert.deepEqual(hn.rows("SELECT threadSeq FROM chat_message WHERE thread = ? ORDER BY threadSeq", t).map((r) => r["threadSeq"]), [1, 2]);
});

test("a resend with the same client id is the same message: same number, one row, one event", async () => {
  const hn = harness();
  const t = await chat(hn);
  const clientId = "msg_0123456789abcdef";
  const first = await say(hn, t, "offline note", { clientId });
  hn.clear();
  const again = await say(hn, t, "offline note", { clientId });
  assert.equal(again.message.messageId, clientId);
  assert.equal(again.message.threadSeq, first.message.threadSeq);
  assert.equal(hn.rows("SELECT id FROM chat_message WHERE thread = ?", t).length, 1);
  assert.equal(hn.named("message.received").length, 0, "a resend does not announce the message twice");
  assert.equal((await say(hn, t, "next")).message.threadSeq, 2);
  const other = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k3" }).then((r) => r.thread.threadId as string);
  assert.equal(await failure(() => say(hn, other, "x", { clientId })), "validation.bad_input");
});

test("the unique index refuses two messages with one number, and a lost counter carries on from the stored messages", async () => {
  const hn = harness();
  const t = await chat(hn);
  for (let i = 0; i < 3; i++) await say(hn, t, `m${i}`);
  assert.throws(() => hn.raw.run(
    "INSERT INTO chat_message (id, thread, threadSeq, author, kind, body, blocks, depth, pinned, reactions, createdAt, version) VALUES ('msg_dup', ?, 2, 'usr_dana', 'text', 'x', '[]', 0, 0, '[]', 1, 0)", t,
  ));
  hn.raw.run("DELETE FROM chat_thread_seq WHERE thread = ?", t);
  assert.equal((await say(hn, t, "after the counter was lost")).message.threadSeq, 4);
});

test("resume: the last 50 messages of a long chat come off the index, oldest first, and older ones page backwards", async () => {
  const hn = harness();
  const t = await chat(hn);
  for (let i = 0; i < 120; i++) await say(hn, t, `m${i}`);
  const tail = lastMessages(hn.db, t);
  assert.equal(tail.length, 50);
  assert.deepEqual(tail.map((m) => m.seq), Array.from({ length: 50 }, (_, i) => 71 + i));
  assert.equal(tail[49]!.body, "m119");
  const older = lastMessages(hn.db, t, 50, 71);
  assert.deepEqual(older.map((m) => m.seq), Array.from({ length: 50 }, (_, i) => 21 + i));
  const rest = lastMessages(hn.db, t, 50, 21);
  assert.deepEqual(rest.map((m) => m.seq), Array.from({ length: 20 }, (_, i) => 1 + i));

  const plan = (hn.raw.all("EXPLAIN QUERY PLAN SELECT * FROM chat_message WHERE thread = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 50", t) as Array<Record<string, unknown>>).map((r) => String(r["detail"])).join(" | ");
  assert.match(plan, /chat_message__seq/, plan);
  assert.doesNotMatch(plan, /TEMP B-TREE/, `no sort: ${plan}`);
});

test("opening a chat with 20,000 messages reads the last 50 in well under 50 ms", async () => {
  const hn = harness();
  const t = await chat(hn);
  hn.raw.run("DELETE FROM chat_thread_seq WHERE thread = ?", t);
  for (let i = 1; i <= 20_000; i++) {
    hn.raw.run(
      "INSERT INTO chat_message (id, thread, threadSeq, author, kind, body, blocks, depth, pinned, reactions, createdAt, version) VALUES (?, ?, ?, 'usr_dana', 'text', 'filler', '[]', 0, 0, '[]', 1, 0)", `msg_f${i}`, t, i,
    );
  }
  hn.raw.run("INSERT INTO chat_thread_seq (thread, last) VALUES (?, 20000)", t);
  lastMessages(hn.db, t); // warm
  const t0 = performance.now();
  const tail = lastMessages(hn.db, t);
  const ms = performance.now() - t0;
  assert.equal(tail.length, 50);
  assert.equal(tail[49]!.seq, 20_000);
  assert.ok(ms < 50, `last 50 of 20,000 took ${ms.toFixed(1)} ms`);
  assert.equal((await say(hn, t, "next")).message.threadSeq, 20_001);
});
