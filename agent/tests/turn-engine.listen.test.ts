// Listener cost (ARCH 6.5, lead ruling 35): a listening agent makes zero provider calls and has zero spend rows until it is @mentioned.
import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../../lib/route.ts";
import type { RouteMessage } from "../../lib/route.ts";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent } from "../src/turn-engine/index.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const quiet: DriverEvent[] = [{ type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];
const agents = (): EngineAgent[] => [
  { id: "intake", mode: "lead", role: "Answers new questions" },
  { id: "docs", mode: "listen", role: "Reviews documents" },
  { id: "billing", mode: "listen", role: "Handles invoices" },
];

test("no-inference-for-listener: 50 scripted messages give turns only to the lead and to explicit @mentions, zero spend for listeners", async () => {
  const table: RouteMessage[] = [];
  for (let i = 0; i < 50; i++) {
    const m: RouteMessage = { author: i % 7 === 0 ? agent("intake") : person("dana"), mentions: [], depth: i % 7 === 0 ? 1 : 0 };
    if (i % 5 === 0) m.mentions = [agent("docs")];
    else if (i % 5 === 1) m.mentions = [person("sam")];
    else if (i % 5 === 2) m.mentions = [agent("billing"), person("sam")];
    table.push(m);
  }
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
  let wantLead = 0, wantDocs = 0, wantBilling = 0;
  for (const m of table) {
    for (const id of route({ agents: agents() }, m).responders) {
      if (id === "intake") wantLead++;
      else if (id === "docs") wantDocs++;
      else wantBilling++;
    }
    engine.receive({ threadId: "T", author: m.author, mentions: m.mentions, ...(m.depth === undefined ? {} : { depth: m.depth }) });
  }
  await engine.idle("T");
  const ran = (id: string): number => p.sessions.filter((s) => s.spec.agent.id === id).length;
  assert.ok(wantLead > 0 && wantDocs > 0 && wantBilling > 0, "the table exercises all three");
  assert.equal(ran("intake"), wantLead);
  assert.equal(ran("docs"), wantDocs, "docs ran only for messages that @mentioned it");
  assert.equal(ran("billing"), wantBilling);
  assert.equal(p.sends(), wantLead + wantDocs + wantBilling, "no provider call beyond the routed turns");
  const spendBy = (id: string): number => engine.spend().filter((s) => s.agentId === id).length;
  assert.equal(spendBy("docs"), wantDocs);
  assert.equal(spendBy("billing"), wantBilling);
});

test("a channel of listeners makes zero provider calls for 20 messages, then exactly one when one is @mentioned", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "C", kind: "channel", starter: "dana", agents: [{ id: "docs", mode: "listen" }, { id: "billing", mode: "listen" }] });
  for (let i = 0; i < 20; i++) engine.receive({ threadId: "C", author: person(i % 2 ? "dana" : "sam"), body: `chatter ${i}` });
  await engine.idle("C");
  assert.equal(p.sends(), 0);
  assert.equal(p.sessions.length, 0, "no engine session was even opened");
  assert.deepEqual(engine.spend(), []);
  assert.deepEqual(engine.turns("C"), []);
  engine.receive({ threadId: "C", author: person("dana"), mentions: [agent("billing")], body: "@billing what is open?" });
  await engine.idle("C");
  assert.equal(p.sends(), 1);
  assert.equal(p.sessions[0]?.spec.agent.id, "billing");
  assert.equal(engine.spend().length, 1);
});

test("the lead's context names the listeners and their role lines; the listeners themselves run nothing", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
  engine.receive({ threadId: "T", author: person("dana"), body: "who handles my invoice?" });
  await engine.idle("T");
  assert.equal(p.sessions.length, 1);
  assert.deepEqual(p.sessions[0]?.inputs[0]?.listeners, [{ id: "docs", role: "Reviews documents" }, { id: "billing", role: "Handles invoices" }]);
  assert.equal(p.sessions[0]?.inputs[0]?.agent.id, "intake");
});

test("an invoked listener is a normal turn on its own, and a mentioned listener sees the lead as a listener-free peer", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
  engine.receive({ threadId: "T", author: person("dana"), mentions: [agent("docs")], body: "Ask Docs to review this" });
  await engine.idle("T");
  assert.deepEqual(p.sessions.map((s) => s.spec.agent.id), ["docs"], "the lead did not also answer");
  assert.equal(engine.turns("T")[0]?.asker, "dana");
});
