// Switch engine mid-thread (engine.switch, spec 4.14, ARCH 6.9): a thread that ran on Claude Code moves to an API driver and the new engine still knows what was done.
// The Claude Code side is a session file read through importClaudeSession; the API side is a fake driver behind the turn engine that answers from what its first message holds.
import test from "node:test";
import assert from "node:assert/strict";
import { createTranscript, createTurnBuilder, importClaudeSession, personTurn, switchEngine, withoutSeed, SEED_OPEN } from "../src/transcript/index.ts";
import type { EngineRef, Transcript } from "../src/transcript/index.ts";
import { FAKE_KEY, northwindSession } from "../src/transcript/fixtures/claude-session.ts";
import { blockErrors, eventErrors } from "../src/transcript/fixtures/contract.ts";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";

const T = "thr_northwind";
const NOW = 1_760_000_000_000;
const CLAUDE_CODE: EngineRef = { driver: "claude_code", provider: "anthropic", model: "claude-sonnet-4-5" };
const API: EngineRef = { driver: "anthropic", provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" };

function loaded(): Transcript {
  const tr = createTranscript();
  const imp = importClaudeSession(northwindSession(), { threadId: T, personId: "usr_alex", agentId: "agt_intake" });
  for (const t of imp.turns) tr.append(t);
  return tr;
}

/** The API driver's whole job here: a user message of seed + the person's words goes to the model, which can only use what is in it. */
function model(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  const m = /\[main ([0-9a-f]{7})\]/.exec(messages.map((x) => x.content).join("\n"));
  return m ? `The fix is commit ${m[1]}.` : "I do not know which commit that was.";
}

test("switch Claude Code to an API driver mid-thread keeps context; the model_switch block is emitted", async () => {
  const tr = loaded();
  assert.equal(tr.count(T), 4, "two requests and two answers came out of the session file");

  const res = await switchEngine({ transcript: tr, now: () => NOW }, { threadId: T, agentId: "agt_intake", from: CLAUDE_CODE, to: API, by: "usr_alex" });

  // The quiet line, the event and the block.
  assert.equal(res.quietLine, "Switched to Anthropic, picked up from the last 4 turns");
  assert.equal(res.handoffTurns, 4);
  assert.equal(res.returning, false);
  assert.deepEqual(res.event, { threadId: T, agentId: "agt_intake", from: "claude_code", to: "anthropic", handoffTurns: 4, by: "usr_alex" });
  assert.deepEqual(eventErrors("turn.engine_switched", res.event), []);
  assert.equal(res.block.type, "model_switch");
  assert.equal(res.block.v, 1);
  assert.match(res.block.id, /^blk_[a-z0-9]+$/);
  assert.match(res.block.traceId, /^[0-9a-f]{32}$/);
  assert.deepEqual(blockErrors("model_switch", res.block.data), []);
  assert.deepEqual(res.block.data.from, { provider: "anthropic", model: "claude-sonnet-4-5" });
  assert.deepEqual(res.block.data.to, { provider: "anthropic", model: "claude-sonnet-5-5", effort: "high" });
  assert.equal(res.block.data.scope, "thread");
  assert.deepEqual(tr.switches(T).map((r) => [r.from.driver, r.to.driver, r.atTurn, r.handoffTurns]), [["claude_code", "anthropic", 4, 4]]);

  // What the new engine is handed.
  const seed = res.seed.text;
  assert.ok(seed.startsWith(SEED_OPEN));
  assert.ok(seed.endsWith("\n]"));
  assert.match(seed, /Fix the order form on the Northwind Bakery site/);
  assert.match(seed, /draft a note to kit/);
  assert.match(seed, /OrderForm\.js/, "the files it worked on");
  assert.match(seed, /\[main a1b2c3d\] validate the order before submit/, "what the commit printed");
  assert.match(seed, /chats\/thr_northwind\/transcript\.md/);
  assert.match(seed, /transcript_get/);
  assert.ok(!seed.includes(FAKE_KEY), "a pasted key never reaches another engine");
  assert.match(seed, /\[Stripe key redacted …ke12\]/);
  assert.ok(!seed.includes("Read the component first"), "thinking is the old engine's own");
  assert.ok(!seed.includes("subagent chatter"), "a subagent's lines are not the conversation");
  assert.equal(withoutSeed(`${seed}\n\nAnd the follow up?`), "And the follow up?", "the person's words are found after the seed");

  // The new engine, behind the turn engine, answers a question only the old engine's work can answer.
  const driver = scriptedProvider({
    script: (input) => [{ type: "text", text: model([{ role: "user", content: `${seed}\n\n${input.trigger?.body ?? ""}` }]) }, { type: "usage", inputTokens: 900, outputTokens: 8 }, { type: "done" }],
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: driver.openSession });
  engine.openThread({ id: T, kind: "chat", starter: "usr_alex", agents: [{ id: "agt_intake", mode: "lead", model: API.model }] });
  engine.receive({ threadId: T, author: { kind: "person", id: "usr_alex" }, body: "Which commit fixed it?" });
  await engine.idle(T);
  const answer = engine.messages(T).find((m) => m.author.kind === "agent");
  assert.equal(answer?.body, "The fix is commit a1b2c3d.");
  // Without the hand-over the same model knows nothing: the context came from the transcript.
  assert.equal(model([{ role: "user", content: "Which commit fixed it?" }]), "I do not know which commit that was.");

  // The API driver writes its own turn into the same transcript, in the same shape.
  tr.append(personTurn({ threadId: T, authorId: "usr_alex", text: "Which commit fixed it?", at: NOW + 1000 }));
  const b = createTurnBuilder({ threadId: T, authorId: "agt_intake", engine: API.driver, model: API.model, now: () => NOW + 2000 });
  b.push({ type: "text", text: "The fix is commit a1b2c3d." });
  b.push({ type: "usage", inputTokens: 900, outputTokens: 8 });
  const written = tr.append(b.build());
  assert.deepEqual([written.n, written.engine, written.model, written.tokens], [6, "anthropic", "claude-sonnet-5-5", { in: 900, out: 8 }]);
  assert.deepEqual(written.links, [{ kind: "commit", ref: "a1b2c3d" }], "the commit it names is a link");
});

test("switching back hands the first engine what was said while it was away", async () => {
  const tr = loaded();
  await switchEngine({ transcript: tr, now: () => NOW }, { threadId: T, agentId: "agt_intake", from: CLAUDE_CODE, to: API, by: "usr_alex" });
  tr.append(personTurn({ threadId: T, authorId: "usr_alex", text: "Add a unit test for an empty cart.", at: NOW + 10 }));
  const b = createTurnBuilder({ threadId: T, authorId: "agt_intake", engine: "anthropic", model: API.model, now: () => NOW + 20 });
  b.push({ type: "text", text: "Added OrderForm.empty.test.js; it passes." });
  tr.append(b.build());

  const back = await switchEngine({ transcript: tr, now: () => NOW + 30 }, { threadId: T, agentId: "agt_intake", from: API, to: CLAUDE_CODE, by: "usr_alex" });
  assert.equal(back.returning, true);
  assert.equal(back.handoffTurns, 2, "only what was said since it left");
  assert.equal(back.quietLine, "Switched back to Claude Code, caught up on 2 turns since it left");
  assert.match(back.seed.text, /Said while you were away/);
  assert.match(back.seed.text, /empty cart/);
  assert.match(back.seed.text, /OrderForm\.empty\.test\.js/);
  assert.ok(!back.seed.text.includes("Fix the order form"), "what it already knew is not repeated");
  assert.deepEqual(blockErrors("model_switch", back.block.data), []);
  assert.deepEqual(tr.switches(T).map((r) => r.to.driver), ["anthropic", "claude_code"]);
});

test("a thread with no turns switches without a hand-over, and a summarizer that fails does not stop the switch", async () => {
  const tr = createTranscript();
  const empty = await switchEngine({ transcript: tr }, { threadId: "thr_new", agentId: "agt_intake", from: CLAUDE_CODE, to: API, by: "usr_alex" });
  assert.equal(empty.quietLine, "Switched to Anthropic");
  assert.equal(empty.handoffTurns, 0);
  assert.ok(empty.seed.text.startsWith(SEED_OPEN));

  const long = createTranscript();
  for (let i = 1; i <= 30; i++) long.append(personTurn({ threadId: T, authorId: "usr_alex", text: `request number ${i} about the bakery`, at: NOW + i }));
  const res = await switchEngine(
    { transcript: long, now: () => NOW, summarize: async () => { throw new Error("the cheap model is down"); } },
    { threadId: T, agentId: "agt_intake", from: CLAUDE_CODE, to: API, by: "usr_alex" },
  );
  assert.equal(res.handoffTurns, 20);
  assert.equal(res.quietLine, "Switched to Anthropic, picked up from the summary and the last 20 turns");
  assert.equal(long.summary(T)?.by, "extract", "the plain extract stood in for the summarizer");
  assert.equal(long.summary(T)?.upTo, 10);
  assert.match(res.seed.text, /Asked \(turn 1\): request number 1 about the bakery/);
});
