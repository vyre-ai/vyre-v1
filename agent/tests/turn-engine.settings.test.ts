// How and when an agent answers in one chat (lane l-addsheet, the Add people and agents sheet): Listening, When (topics, hours), Style, and a poke. route() is the one function the composer and the engine share.
import test from "node:test";
import assert from "node:assert/strict";
import { aboutTopics, insideHours, route } from "../../lib/route.ts";
import type { RouteAgent } from "../../lib/route.ts";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent } from "../src/turn-engine/index.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const say = (text: string, extra: Record<string, unknown> = {}) => ({ author: person("dana"), mentions: [], text, ...extra });
const quietTurn: DriverEvent[] = [{ type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];

test("topics: an agent set to Only on topics answers an untagged message only when it is about them; a tag always reaches it", () => {
  const agents: RouteAgent[] = [{ id: "lead", mode: "lead", when: "topics", topics: "invoices, billing" }];
  assert.deepEqual(route({ agents, kind: "chat" }, say("can you chase the invoices from March")).responders, ["lead"]);
  assert.deepEqual(route({ agents, kind: "chat" }, say("what is the weather")).responders, [], "not about its topics: it stays out");
  assert.deepEqual(route({ agents, kind: "chat" }, say("what is the weather", { mentions: [{ kind: "agent", id: "lead" }] })).responders, ["lead"], "a tag always answers");
  assert.ok(aboutTopics("invoices", "one invoice is late"), "singular and plural count");
  assert.ok(!aboutTopics("", "anything"), "no topics match nothing");
});

test("topics on a listener: a tagged-only agent also speaks up when a message is about its topics, and the lead answers as before", () => {
  const agents: RouteAgent[] = [{ id: "lead", mode: "lead" }, { id: "docs", mode: "listen", when: "topics", topics: "contracts" }, { id: "plain", mode: "listen" }];
  assert.deepEqual(route({ agents, kind: "channel" }, say("review the contracts please")).responders, ["lead", "docs"]);
  assert.deepEqual(route({ agents, kind: "channel" }, say("lunch?")).responders, ["lead"]);
});

test("hours: an agent set to Only during hours answers inside them in the speaker's time and is quiet outside, overnight hours wrap", () => {
  const agents: RouteAgent[] = [{ id: "lead", mode: "lead", when: "hours", hoursFrom: "09:00", hoursTo: "17:00" }];
  assert.deepEqual(route({ agents, kind: "chat" }, say("hello", { minutes: 10 * 60 })).responders, ["lead"]);
  assert.deepEqual(route({ agents, kind: "chat" }, say("hello", { minutes: 20 * 60 })).responders, [], "after hours");
  assert.deepEqual(route({ agents, kind: "chat" }, say("hello", { minutes: 20 * 60, mentions: [{ kind: "agent", id: "lead" }] })).responders, ["lead"], "a tag still answers");
  assert.ok(insideHours("22:00", "06:00", 23 * 60) && insideHours("22:00", "06:00", 3 * 60) && !insideHours("22:00", "06:00", 12 * 60), "a night shift wraps midnight");
  assert.ok(insideHours("09:00", "17:00", undefined), "an unknown clock holds nobody back");
});

test("Listening (quiet) never answers, not even tagged or alone in the chat or spoken to with everyone; a poke always does", () => {
  const solo: RouteAgent[] = [{ id: "q", mode: "listen", quiet: true }];
  assert.deepEqual(route({ agents: solo, kind: "chat" }, say("hi")).responders, [], "alone, listening: nothing");
  assert.deepEqual(route({ agents: solo, kind: "chat" }, say("hi", { mentions: [{ kind: "agent", id: "q" }] })).responders, [], "tagged, still listening");
  const two: RouteAgent[] = [{ id: "q", mode: "listen", quiet: true }, { id: "b", mode: "lead" }, { id: "c", mode: "listen" }];
  assert.deepEqual(route({ agents: two, kind: "chat" }, say("both of you, look at this")).responders, ["b", "c"], "everyone does not include a listening agent");
  assert.deepEqual(route({ agents: two, kind: "chat" }, say("poked", { poke: "q" })).responders, ["q"], "a poke starts it now");
  assert.deepEqual(route({ agents: [{ id: "x", mode: "lead", when: "topics", topics: "zzz" }], kind: "chat" }, say("poked", { poke: "x" })).responders, ["x"], "a poke ignores When too");
});

test("the engine: a poked listening agent runs one turn from the last 12 messages, an unpoked one makes no provider call, and the settings change the next message", async () => {
  const p = scriptedProvider({ script: quietTurn });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  const agents: EngineAgent[] = [{ id: "lead", mode: "lead", when: "topics", topics: "invoices" }, { id: "watcher", mode: "listen", quiet: true }];
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents });
  for (let i = 0; i < 20; i++) engine.receive({ threadId: "T", author: person("dana"), body: `weather ${i}` });
  await engine.idle("T");
  assert.equal(p.sends(), 0, "nothing about invoices, nothing quiet is asked: no provider call");
  engine.receive({ threadId: "T", author: person("dana"), body: "poke", mentions: [{ kind: "agent", id: "watcher" }], poke: { agentId: "watcher", by: "dana" } });
  await engine.idle("T");
  assert.equal(p.sends(), 1);
  const input = p.sessions.find((s) => s.spec.agent.id === "watcher")!.inputs[0]!;
  assert.equal(input.history.length, 12, "a poke reads the last 12 messages, a short window");
  assert.equal(input.asker, "dana", "it answers the person who poked");
  // a change made in the chat reaches the next message
  engine.setSettings("T", "lead", {});
  engine.receive({ threadId: "T", author: person("dana"), body: "anything" });
  await engine.idle("T");
  assert.equal(p.sessions.filter((s) => s.spec.agent.id === "lead").length, 1, "When is Always now: the lead answers");
  engine.setSettings("T", "lead", { quiet: true });
  engine.receive({ threadId: "T", author: person("dana"), body: "anything else" });
  await engine.idle("T");
  assert.equal(p.sessions.filter((s) => s.spec.agent.id === "lead").length, 1, "Listening: no more turns");
  assert.deepEqual(route({ agents: [agent("a")].map((a) => ({ id: a.id, mode: "lead" as const })) }, say("x")).responders, ["a"], "the default is unchanged");
});
