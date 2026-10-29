// memory.quote, memory.remember and memory.forget: the exact-recall read and the two thin tools every model gets. Access for a quote is the chat module's (tested in modules/chat/tests/history.test.ts);
// here the chat answer is a stand-in and the test checks what memory adds: names, shape, and that no refusal turns into text.
import test from "node:test";
import assert from "node:assert/strict";
import { quote } from "../handlers/quotes.ts";
import { forget, remember } from "../handlers/tools.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";

const hit = {
  source: "message", ref: "msg_a1", messageId: "msg_a1", threadId: "thr_1", threadTitle: "Retainers", threadKind: "chat", seq: 4, role: "person", author: { kind: "person", id: "usr_dana" },
  text: "The Henderson retainer is capped at 4,500 dollars per month.", at: 1_760_000_000_000, link: "vyre://thread/thr_1?m=msg_a1", score: 1.5,
};

test("a quote carries the exact words, the author's name, the time and a link", async () => {
  const h = harness({ respond: { "chat.history.search": () => ({ hits: [hit] }), "search.resolve": () => ({ hit: { title: "Dana Cole" } }) } });
  const out = await quote(h.ctx, { q: "Henderson retainer cap" });
  assert.deepEqual(contractErrors("memory.quote", "out", out), []);
  assert.equal(out.quotes[0]!.text, hit.text);
  assert.equal(out.quotes[0]!.author.name, "Dana Cole");
  assert.equal(out.quotes[0]!.link, "vyre://thread/thr_1?m=msg_a1");
  assert.deepEqual(h.calls("chat.history.search")[0]!.input, { q: "Henderson retainer cap" });
});

test("a quote needs words or a ref, and a line the asker may not open gives no quote", async () => {
  const h = harness({ respond: { "chat.history.search": () => ({ hits: [] }) } });
  await assert.rejects(() => quote(h.ctx, {}), /Say what to quote/);
  assert.deepEqual((await quote(h.ctx, { ref: "msg_zzz" })).quotes, []);
});

test("remember: in your own layer it is current at once, with its source; forget closes it", async () => {
  const h = harness();
  const out = await remember(h.ctx, { text: "Dana prefers calls before 10am", kind: "profile", threadId: "thr_1" });
  assert.deepEqual(contractErrors("memory.remember", "out", out), []);
  assert.equal(out.merged, true);
  assert.equal(out.fact.status, "current");
  assert.equal(out.fact.layer, "person");
  assert.equal(out.fact.sourceKind, "chat");
  assert.equal(out.fact.sourceRef, "thr_1");
  const gone = await forget(h.ctx, { factIds: [out.fact.factId] });
  assert.deepEqual(gone, { removed: 1 });
  assert.equal(h.rows("SELECT status FROM memory_facts WHERE id = ?", out.fact.factId)[0]!["status"], "removed");
  await assert.rejects(() => forget(h.ctx, { factIds: [] }), /Name the facts/);
});
