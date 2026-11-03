// Ask the Space (owner decision, 3 Nov 2026): the module's own rules, on the in-memory harness. The end-to-end proof on a Team daemon is test/search.ask.team.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { NO_ACCESS, ask, citations, keywords } from "../handlers/ask.ts";
import { contractErrors, harness, seed } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const ACCOUNTS = [
  { ref: "#Team", driver: "anthropic", kind: "api_key", title: "Team AI", mine: false, status: "ok", spaceKey: true },
  { ref: "#Mine", driver: "claude_code", kind: "subscription", title: "Claude Code", mine: true, status: "ok" },
];
function rig(accounts: unknown[] = ACCOUNTS, text = "The deposit is 4200 dollars [1]."): { h: Harness; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const h = harness({ respond: { "engine.accounts.list": () => ({ accounts }), "engine.complete": (i) => { sent.push(i); return { text, tokensIn: 1, tokensOut: 1 }; }, "chat.messages.list": () => ({ messages: [] }) } });
  seed(h, { id: "thr_a", title: "Rivera channel", kind: "chat", body: "The Rivera lease deposit is 4200 dollars, due Thursday." });
  seed(h, { id: "rec_secret", title: "Rivera settlement terms", kind: "record", body: "settlement 9100000" });
  seed(h, { id: "mem_x", title: "Rivera nickname", kind: "memory", body: "my private nickname for the Rivera lease is Skylark" });
  h.deny("record:rec_secret");
  return { h, sent };
}

test("the answer is made from rows the asker may read, on a Mine account first, and its citations name real sources", async () => {
  const { h, sent } = rig(undefined, "The deposit is 4200 dollars [1]. More is elsewhere [5].");
  const out = await ask(h.ctx, { q: "what is the Rivera lease deposit" });
  assert.equal(out.state, "answered");
  assert.equal(out.answer, "The deposit is 4200 dollars [1]. More is elsewhere.");
  assert.deepEqual(out.cited, [1]);
  assert.deepEqual(contractErrors("search.ask", "out", out), []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!["accountRef"], "#Mine", "the asker's own account before the Space's");
  const prompt = String(sent[0]!["prompt"]);
  assert.ok(prompt.includes("4200 dollars"));
  assert.ok(!/9100000|Skylark/.test(prompt), "not the row she cannot read, not the private profile");
  assert.ok(out.sources.every((s) => s.kind !== "memory" && s.id !== "rec_secret"));
});

test("with nothing the asker may read, the answer is the no-access line and no model is called", async () => {
  const { h, sent } = rig();
  const out = await ask(h.ctx, { q: "settlement 9100000" });
  assert.deepEqual([out.state, out.answer, out.sources], ["no_access", NO_ACCESS, []]);
  assert.equal(sent.length, 0);
});

test("no AI account to answer on: the sources still come back and nothing is sent", async () => {
  const { h, sent } = rig([{ ref: "#Old", driver: "anthropic", kind: "api_key", title: "Old", mine: true, status: "expired" }]);
  const out = await ask(h.ctx, { q: "Rivera lease deposit" });
  assert.equal(out.state, "no_account");
  assert.ok(out.sources.length > 0);
  assert.equal(sent.length, 0);
});

test("a model that says it sees nothing, or fails, never shows an invented answer", async () => {
  const none = rig(undefined, `${NO_ACCESS}`);
  assert.deepEqual([(await ask(none.h.ctx, { q: "Rivera lease deposit" })).state, (await ask(none.h.ctx, { q: "Rivera lease deposit" })).sources], ["no_access", []]);
  const h = harness({ respond: { "engine.accounts.list": () => ({ accounts: ACCOUNTS }), "engine.complete": () => { throw new Error("limit"); } } });
  seed(h, { id: "fil_a", title: "Rivera deposit.md", kind: "file", body: "Rivera lease deposit 4200" });
  const out = await ask(h.ctx, { q: "Rivera lease deposit" });
  assert.deepEqual([out.state, out.answer], ["failed", undefined]);
  assert.ok(out.sources.length > 0);
});

test("citations keep only marks that name a listed source, in the order first cited; keywords drop the question words", () => {
  assert.deepEqual(citations("A [2]. B [1][2]. C [7].", 3), { text: "A [2]. B [1][2]. C.", cited: [2, 1] });
  assert.equal(keywords("What did Elena say about the lease?"), "elena lease");
  assert.equal(keywords("what is the"), "what is the");
});
