// memory.used: what recall handed the agent for one message, read again under the reader's access.
import test from "node:test";
import assert from "node:assert/strict";
import { recallRecord, used } from "../handlers/recalllog.ts";
import { asPerson, contractErrors, harness, seedFact } from "../fixtures/harness.ts";

const quote = { source: "message", ref: "msg_9", threadId: "thr_one", threadKind: "chat", seq: 1, role: "person", author: { kind: "person", id: "usr_dana" }, text: "The cap is 4,500.", at: 5, link: "vyre://thread/thr_one?m=msg_9", score: 1 };

test("the record holds ids only; memory.used returns the facts and quotes read again now, for the person it was recalled for", async () => {
  const h = harness({ respond: { "chat.history.search": (i) => ({ hits: i["ref"] === "msg_9" ? [quote] : [] }), "search.resolve": () => ({}) , "chat.message.get": () => ({ message: { createdAt: 100 } }) } });
  seedFact(h, { id: "fct_1", layer: "person", owner: "usr_dana", text: "Dana prefers short answers." } as never);
  h.clock.t = 50;
  assert.deepEqual(await recallRecord(h.ctx, { threadId: "thr_two", messageId: "msg_a", agentId: "agt_i", lines: [{ kind: "fact", ref: "fct_1" }, { kind: "quote", ref: "msg_9" }] }), { recorded: 2 });
  assert.ok(!JSON.stringify(h.rows("SELECT * FROM memory_recall_log")).includes("short answers"), "no text is stored");
  const got = await used(h.ctx, { threadId: "thr_two", messageId: "msg_a" });
  assert.deepEqual(contractErrors("memory.used", "out", got), []);
  assert.deepEqual([got.facts.map((f) => f.factId), got.quotes.map((q) => q.text)], [["fct_1"], ["The cap is 4,500."]]);
  // asked about the agent's reply (a later message), it finds the recall of the message before it
  const reply = await used(h.ctx, { threadId: "thr_two", messageId: "msg_reply" });
  assert.equal(reply.messageId, "msg_a");
  assert.equal(reply.facts.length, 1);
  // someone else has no record of their own, and never sees Dana's personal fact
  const other = asPerson(h, { kind: "person", id: "usr_maya" }, { respond: { "chat.message.get": () => ({ message: { createdAt: 100 } }) } });
  assert.deepEqual(await used(other.ctx, { threadId: "thr_two", messageId: "msg_a" }), { messageId: "msg_a", facts: [], quotes: [] });
  // a fact deleted since is not shown
  h.ctx.db.run("UPDATE memory_facts SET status = 'removed' WHERE id = 'fct_1'");
  assert.equal((await used(h.ctx, { threadId: "thr_two", messageId: "msg_a" })).facts.length, 1, "removed facts stay readable as history to their owner");
});
