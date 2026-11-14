// memory.used: what recall handed the agent for one message, read again under the reader's access.
import test from "node:test";
import assert from "node:assert/strict";
import { recallRecord, used } from "../handlers/recalllog.ts";
import { asPerson, contractErrors, harness, seedFact } from "../fixtures/harness.ts";

const quote = {
  source: "message",
  ref: "msg_9",
  threadId: "thr_one",
  threadKind: "chat",
  seq: 1,
  role: "person",
  author: { kind: "person", id: "usr_dana" },
  text: "The cap is 4,500.",
  at: 5,
  link: "vyre://thread/thr_one?m=msg_9",
  score: 1,
};

test("the record holds ids only; memory.used returns the facts and quotes read again now, for the person it was recalled for", async () => {
  const h = harness({
    respond: {
      "chat.history.search": (i) => ({ hits: i["ref"] === "msg_9" ? [quote] : [] }),
      "search.resolve": () => ({}),
      "chat.message.get": (i) => ({
        message:
          i["messageId"] === "msg_reply"
            ? { threadSeq: 2, author: { kind: "agent", id: "agt_i" }, createdAt: 100 }
            : { threadSeq: 1, author: { kind: "person", id: "usr_dana" }, createdAt: 50 },
      }),
      "chat.messages.list": () => ({
        messages: [{ messageId: "msg_a", threadSeq: 1, author: { kind: "person", id: "usr_dana" } }],
        hasMore: false,
      }),
    },
  });
  seedFact(h, { id: "fct_1", layer: "person", owner: "usr_dana", text: "Dana prefers short answers." } as never);
  h.clock.t = 50;
  assert.deepEqual(
    await recallRecord(h.ctx, {
      threadId: "thr_two",
      messageId: "msg_a",
      agentId: "agt_i",
      lines: [
        { kind: "fact", ref: "fct_1" },
        { kind: "quote", ref: "msg_9" },
      ],
    }),
    { recorded: 2 },
  );
  assert.ok(!JSON.stringify(h.rows("SELECT * FROM memory_recall_log")).includes("short answers"), "no text is stored");
  const got = await used(h.ctx, { threadId: "thr_two", messageId: "msg_a" });
  assert.deepEqual(contractErrors("memory.used", "out", got), []);
  assert.deepEqual([got.facts.map((f) => f.factId), got.quotes.map((q) => q.text)], [["fct_1"], ["The cap is 4,500."]]);
  // asked about the agent's reply (a later message), it finds the recall of the message before it
  const reply = await used(h.ctx, { threadId: "thr_two", messageId: "msg_reply" });
  assert.equal(reply.messageId, "msg_a");
  assert.equal(reply.facts.length, 1);
  // someone else has no record of their own, and never sees Dana's personal fact
  const other = asPerson(
    h,
    { kind: "person", id: "usr_maya" },
    { respond: { "chat.message.get": () => ({ message: { createdAt: 100 } }) } },
  );
  assert.deepEqual(await used(other.ctx, { threadId: "thr_two", messageId: "msg_a" }), {
    messageId: "msg_a",
    facts: [],
    quotes: [],
  });
  // a fact deleted since is not shown
  h.ctx.db.run("UPDATE memory_facts SET status = 'removed' WHERE id = 'fct_1'");
  assert.equal(
    (await used(h.ctx, { threadId: "thr_two", messageId: "msg_a" })).facts.length,
    1,
    "removed facts stay readable as history to their owner",
  );
});

test("a later reply does not inherit the recall of an earlier message: only the message that caused the reply counts", async () => {
  const msgs: Record<
    string,
    { messageId: string; threadSeq: number; author: { kind: string; id: string }; createdAt: number; replyTo?: string }
  > = {
    msg_q1: { messageId: "msg_q1", threadSeq: 1, author: { kind: "person", id: "usr_dana" }, createdAt: 10 },
    msg_r1: { messageId: "msg_r1", threadSeq: 2, author: { kind: "agent", id: "agt_i" }, createdAt: 20 },
    msg_q2: { messageId: "msg_q2", threadSeq: 3, author: { kind: "person", id: "usr_dana" }, createdAt: 30 },
    msg_r2: { messageId: "msg_r2", threadSeq: 4, author: { kind: "agent", id: "agt_i" }, createdAt: 40 },
  };
  const h = harness({
    respond: {
      "chat.message.get": (i) => ({ message: msgs[String(i["messageId"])] }),
      "chat.messages.list": (i) => ({
        messages: Object.values(msgs).filter((m) => m.threadSeq < Number(i["before"])),
        hasMore: false,
      }),
    },
  });
  seedFact(h, { id: "fct_l", layer: "person", owner: "usr_dana", text: "Show me drafts first." } as never);
  h.clock.t = 10;
  // the lesson was put in front of the agent for the first message only
  await recallRecord(h.ctx, {
    threadId: "thr_x",
    messageId: "msg_q1",
    agentId: "agt_i",
    lines: [{ kind: "fact", ref: "fct_l" }],
  });
  assert.equal(
    (await used(h.ctx, { threadId: "thr_x", messageId: "msg_r1" })).facts.length,
    1,
    "the reply to that message used it",
  );
  const later = await used(h.ctx, { threadId: "thr_x", messageId: "msg_r2" });
  assert.deepEqual(later.facts, [], "the reply to the second message was not given it, so it is not shown as used");
});
