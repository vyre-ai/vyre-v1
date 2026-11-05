// Agents hand work to each other with an @mention (owner ruling 4 Nov 2026): at most three hand-offs follow one person's message, the same two agents never pass it back and forth more than twice, the turn it
// starts runs for the person whose message started the chain, and the result says who asked whom.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent } from "../src/turn-engine/index.ts";

const agent = (id: string) => ({ kind: "agent" as const, id });
const quiet: DriverEvent[] = [{ type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];
const team = (): EngineAgent[] => [{ id: "intake", name: "Intake", mode: "lead" }, { id: "docs", name: "Docs", mode: "listen" }, { id: "billing", name: "Billing", mode: "listen" }];

test("a hand-off by @mention runs the second agent once, for the person who asked, and says who asked whom", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: team() });
  const r = engine.receive({ threadId: "T", author: agent("intake"), mentions: [agent("docs")], depth: 1, asker: "dana", body: "@Docs check this" });
  assert.deepEqual(r.responders, ["docs"]);
  assert.deepEqual(r.chain, { from: "intake", to: ["docs"] });
  await engine.idle("T");
  assert.equal(p.sessions.filter((s) => s.spec.agent.id === "docs").length, 1);
  assert.equal(engine.spend().find((s) => s.agentId === "docs")?.payer, "dana", "the original asker pays");
});

test("the chain stops after three hand-offs", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: team() });
  engine.receive({ threadId: "T", author: { kind: "person", id: "dana" }, mentions: [], body: "go" });
  const hops = [["intake", "docs"], ["docs", "billing"], ["billing", "intake"], ["intake", "docs"]] as const;
  const ran = hops.map(([from, to], i) => engine.receive({ threadId: "T", author: agent(from), mentions: [agent(to)], depth: i + 1, asker: "dana", body: "next" }).responders.length);
  assert.deepEqual(ran, [1, 1, 1, 0], "the fourth hand-off does not run");
});

test("the same two agents never pass it back and forth more than twice", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: team() });
  engine.receive({ threadId: "T", author: { kind: "person", id: "dana" }, mentions: [], body: "go" });
  const passes = [["intake", "docs"], ["docs", "intake"], ["intake", "docs"]] as const;
  const ran = passes.map(([from, to], i) => engine.receive({ threadId: "T", author: agent(from), mentions: [agent(to)], depth: i + 1, asker: "dana", body: "back" }).responders.length);
  assert.deepEqual(ran, [1, 1, 0], "the third pass between the same pair is dropped");
});

test("a held message is kept in the chat and wakes nobody", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: team() });
  const held = engine.receive({ threadId: "T", author: agent("intake"), mentions: [agent("docs")], depth: 1, asker: "dana", body: "result one", hold: true });
  assert.deepEqual(held.responders, []);
  assert.deepEqual(held.qseqs, []);
  assert.ok(held.messageId, "it is stored");
  await engine.idle("T");
  assert.equal(p.sessions.length, 0, "no turn ran");
  const next = engine.receive({ threadId: "T", author: agent("intake"), mentions: [agent("docs")], depth: 1, asker: "dana", body: "result two" });
  assert.deepEqual(next.responders, ["docs"], "the next, unheld message wakes as usual");
});

test("a held message wakes its agents when it is released, once", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: team() });
  const held = engine.receive({ threadId: "T", author: agent("intake"), mentions: [agent("docs")], depth: 1, asker: "dana", body: "result", hold: true });
  const woke = engine.release("T", held.messageId);
  assert.deepEqual(woke?.responders, ["docs"]);
  await engine.idle("T");
  assert.equal(p.sessions.filter((s) => s.spec.agent.id === "docs").length, 1);
  assert.equal(engine.release("T", held.messageId), null, "a second release does nothing");
});
