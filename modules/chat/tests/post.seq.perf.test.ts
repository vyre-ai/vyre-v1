// The speed half of post.seq.test.ts (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
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
