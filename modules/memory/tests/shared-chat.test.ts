// What one person told their agent stays out of a chat other people read (hole 8): recall leaves the person layer out with more than one person, an agent's own search does too, and exact words from a private
// chat do not surface there. Alone in a chat, nothing changes. A chat that cannot be read counts as shared.
import test from "node:test";
import assert from "node:assert/strict";
import { pointer, search } from "../handlers/facts.ts";
import { quote } from "../handlers/quotes.ts";
import { harness, seedFact } from "../fixtures/harness.ts";

const AGENT = "agt_intake", DANA = "usr_dana";
const two = { "threads.get": () => ({ thread: { kind: "chat", members: [{ kind: "person", id: DANA }, { kind: "person", id: "usr_maya" }, { kind: "agent", id: AGENT }] } }) };

async function seeded(respond?: Record<string, (b: Record<string, unknown>) => unknown>, principal?: { kind: "person" | "agent"; id: string }) {
  const h = harness({ ...(respond ? { respond } : {}), ...(principal ? { principal, actingFor: DANA } : {}) });
  seedFact(h, { id: "fct_p", layer: "person", agentId: AGENT, text: "Dana had private surgery date troubles with her knee" });
  seedFact(h, { id: "fct_a", layer: "agent", agentId: AGENT, text: "The surgery date goes first on the intake form" });
  return h;
}
const said = (o: { lines: Array<{ title: string; fact?: string }> }): string => o.lines.map((l) => l.fact ?? l.title).join(" | ");

test("in a chat with two people the pointer leaves the person layer out, and keeps what the agent knows", async () => {
  const h = await seeded(two);
  const out = await pointer(h.ctx, { threadId: "thr_shared", agentId: AGENT, text: "the surgery date" });
  assert.match(said(out), /intake form/);
  assert.doesNotMatch(said(out), /Dana had/);
});

test("alone with the agent, it stays", async () => {
  const h = await seeded();
  assert.match(said(await pointer(h.ctx, { threadId: "thr_mine", agentId: AGENT, text: "private troubles with her knee" })), /Dana had/);
});

test("a chat that cannot be read counts as shared: private memory stays out unless it is known to be safe", async () => {
  const h = await seeded({ "threads.get": () => { throw new Error("gone"); } });
  assert.doesNotMatch(said(await pointer(h.ctx, { threadId: "thr_x", agentId: AGENT, text: "the surgery date" })), /Dana had/);
});

test("an agent's own search from a shared chat cannot reach the person layer either", async () => {
  const h = await seeded(two, { kind: "agent", id: AGENT });
  const out = await search({ ...h.ctx, thread: "thr_shared" } as never, { q: "surgery", agentId: AGENT, mode: "keyword" });
  assert.equal(JSON.stringify(out).includes("Dana had"), false);
});

test("words from the asker's private chat stay out of a shared chat; words from a channel may come", async () => {
  const hit = (threadKind: string, text: string, threadId: string) => ({ source: "message", ref: `r_${threadId}`, threadId, threadKind, seq: 1, role: "user", author: { kind: "person", id: DANA }, text, at: 1, link: "/x", score: 1 });
  const h = harness({ respond: { ...two, "chat.history.search": () => ({ hits: [hit("chat", "My knee surgery is booked for March.", "thr_p"), hit("channel", "The clinic moved to March.", "thr_c")] }), "search.resolve": () => ({}) } });
  const out = await quote(h.ctx, { q: "March", excludeThreadId: "thr_shared" });
  assert.deepEqual(out.quotes.map((q) => q.threadId), ["thr_c"]);
  const alone = harness({ respond: { "chat.history.search": () => ({ hits: [hit("chat", "My knee surgery is booked for March.", "thr_p")] }), "search.resolve": () => ({}) } });
  assert.equal((await quote(alone.ctx, { q: "March", excludeThreadId: "thr_mine" })).quotes.length, 1);
});
