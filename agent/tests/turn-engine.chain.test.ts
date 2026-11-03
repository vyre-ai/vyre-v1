// An agent that @mentions another agent hands on the person who asked, never the chat's starter: a chained turn runs for the person whose message started the chain, on their account and
// under their access. A chain with no person behind it (an agent's own post that no person asked for) does not run as anyone: it stops and says so.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread, TurnInput } from "../src/turn-engine/index.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const agents = (): EngineAgent[] => [{ id: "agt_x", mode: "listen" }, { id: "agt_y", mode: "listen" }, { id: "agt_z", mode: "listen" }];
const channel = (over: Partial<OpenThread> = {}): OpenThread => ({ id: "T", kind: "channel", starter: "usr_alice", agents: agents(), ...over });

/** X hands to Y, Y hands to Z, Z just answers. */
const relay = (input: TurnInput): DriverEvent[] => {
  const next = input.agent.id === "agt_x" ? "agt_y" : input.agent.id === "agt_y" ? "agt_z" : null;
  return [{ type: "text", text: `${input.agent.id} here` }, { type: "usage", inputTokens: 5, outputTokens: 1 }, { type: "done", ...(next ? { mentions: [agent(next)] } : {}) }];
};

test("Bob asks X in Alice's channel, X mentions Y: Y runs for Bob, never for Alice, and Bob pays", async () => {
  const p = scriptedProvider({ script: relay });
  const asked: string[] = [];
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession,
    resolveAccount: async (q) => { asked.push(`${q.agentId}:${q.askerId}`); return { ref: `#${q.askerId}`, driver: "anthropic", provider: "anthropic", kind: "api_key", payer: q.askerId, reason: "steerer" }; },
  });
  engine.openThread(channel());
  engine.receive({ threadId: "T", author: person("usr_bob"), mentions: [agent("agt_x")], body: "X, look it up" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => [t.agentId, t.asker, t.state]), [["agt_x", "usr_bob", "completed"], ["agt_y", "usr_bob", "completed"], ["agt_z", "usr_bob", "completed"]]);
  assert.deepEqual(asked, ["agt_x:usr_bob", "agt_y:usr_bob", "agt_z:usr_bob"], "every account in the chain was asked for Bob");
  assert.deepEqual(p.specs.map((s) => s.asker), ["usr_bob", "usr_bob", "usr_bob"], "every session was opened as Bob");
  assert.deepEqual(engine.spend().map((s) => s.payer), ["usr_bob", "usr_bob", "usr_bob"]);
});

test("without an account resolver the engine's own choice also follows the chain", async () => {
  const p = scriptedProvider({ script: relay });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(channel());
  engine.receive({ threadId: "T", author: person("usr_bob"), mentions: [agent("agt_x")], body: "go" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => [t.asker, t.payerReason]), [["usr_bob", "steerer"], ["usr_bob", "steerer"], ["usr_bob", "steerer"]]);
});

test("the starter's own chain is still the starter's", async () => {
  const p = scriptedProvider({ script: relay });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(channel());
  engine.receive({ threadId: "T", author: person("usr_alice"), mentions: [agent("agt_x")], body: "go" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.asker), ["usr_alice", "usr_alice", "usr_alice"]);
});

test("an agent's message from the chat carries the person it spoke for: the hop runs for them", async () => {
  const p = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(channel());
  engine.receive({ threadId: "T", author: agent("agt_x"), mentions: [agent("agt_y")], depth: 1, body: "Y, over to you", asker: "usr_bob" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => [t.agentId, t.asker, t.state]), [["agt_y", "usr_bob", "completed"]]);
});

test("a chain with no person behind it stops and asks: no session, no account, a no_asker failure", async () => {
  const p = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }] });
  const asked: string[] = [];
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession,
    admit: async (q) => { asked.push(`admit:${q.asker}`); return null; },
    resolveAccount: async (q) => { asked.push(`resolve:${q.askerId}`); return { ref: "#k", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: q.askerId, reason: "starter" }; },
  });
  engine.openThread(channel());
  engine.receive({ threadId: "T", author: agent("agt_x"), mentions: [agent("agt_y")], depth: 1, body: "Y, do the thing" });
  await engine.idle("T");
  assert.equal(p.specs.length, 0, "no session was opened for anyone");
  assert.deepEqual(asked, [], "no account was looked up, so nobody pays");
  const turns = engine.turns("T");
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.state, "failed");
  assert.equal(turns[0]?.error?.code, "no_asker");
  assert.notEqual(turns[0]?.asker, "usr_alice", "the turn is not recorded as the starter's");
  assert.ok(engine.events("T").some((e) => e.type === "turn.failed" && e.code === "no_asker"));
});

test("a watcher does not act on an agent's post that no person is behind", async () => {
  const p = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread(channel({ agents: [{ id: "agt_x", mode: "listen" }, { id: "agt_w", mode: "listen", watching: true }] }));
  const r = engine.receive({ threadId: "T", author: agent("agt_x"), body: "status line", depth: 0 });
  await engine.idle("T");
  assert.deepEqual(r.responders, []);
  assert.equal(engine.turns("T").length, 0);
  // the same post carrying Bob does wake the watcher, as a routine that runs for Bob
  engine.receive({ threadId: "T", author: agent("agt_x"), body: "status line", depth: 0, asker: "usr_bob" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => [t.agentId, t.asker, t.routine]), [["agt_w", "usr_bob", true]]);
});
