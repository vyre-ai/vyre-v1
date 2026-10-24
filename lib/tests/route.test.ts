import test from "node:test";
import assert from "node:assert/strict";
import { route, nextDepth, DEFAULT_AGENT_HOPS } from "../route.ts";
import type { RouteThread, RouteMessage } from "../route.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });
const thread: RouteThread = { agents: [{ id: "intake", mode: "lead" }, { id: "docs", mode: "listen" }, { id: "billing", mode: "listen" }] };
const say = (over: Partial<RouteMessage> = {}): RouteMessage => ({ author: person("dana"), mentions: [], ...over });

test("a plain person message goes to the lead only", () => {
  const r = route(thread, say());
  assert.deepEqual(r.responders, ["intake"]);
  assert.equal(r.reason, "lead");
  assert.deepEqual(r.listeners, ["docs", "billing"]);
});

test("@mentioned agents answer, the lead does not", () => {
  const r = route(thread, say({ mentions: [agent("docs")] }));
  assert.deepEqual(r.responders, ["docs"]);
  assert.equal(r.reason, "mention");
});

test("two mentions answer in mention order without duplicates", () => {
  const r = route(thread, say({ mentions: [agent("billing"), agent("docs"), agent("billing")] }));
  assert.deepEqual(r.responders, ["billing", "docs"]);
});

test("addressed to a person with @: nobody answers, not even the lead", () => {
  const r = route(thread, say({ mentions: [person("sam")] }));
  assert.deepEqual(r.responders, []);
  assert.equal(r.reason, "person_addressed");
});

test("an agent mention beats a person mention in the same message", () => {
  const r = route(thread, say({ mentions: [person("sam"), agent("docs")] }));
  assert.deepEqual(r.responders, ["docs"]);
});

test("no lead: nobody answers an unaddressed message", () => {
  const r = route({ agents: [{ id: "docs", mode: "listen" }] }, say());
  assert.deepEqual(r.responders, []);
  assert.equal(r.reason, "no_lead");
});

test("hop limit: an agent message at depth 4 starts nothing, at depth 3 it still may", () => {
  const from = (depth: number) => say({ author: agent("docs"), mentions: [agent("billing")], depth });
  assert.deepEqual(route(thread, from(DEFAULT_AGENT_HOPS - 1)).responders, ["billing"]);
  const stopped = route(thread, from(DEFAULT_AGENT_HOPS));
  assert.deepEqual(stopped.responders, []);
  assert.equal(stopped.reason, "hop_limit");
});

test("hop limit is configurable and a person message is never limited", () => {
  assert.deepEqual(route(thread, say({ author: agent("docs"), mentions: [agent("billing")], depth: 1 }), { agentHops: 1 }).responders, []);
  assert.deepEqual(route(thread, say({ depth: 99 })).responders, ["intake"]);
});

test("an agent never answers its own message", () => {
  assert.deepEqual(route(thread, say({ author: agent("intake"), mentions: [agent("intake")], depth: 0 })).responders, []);
  assert.deepEqual(route(thread, say({ author: agent("intake"), depth: 0 })).responders, []);
  assert.deepEqual(route(thread, say({ author: agent("docs"), depth: 0 })).responders, ["intake"], "another agent's plain message goes to the lead");
});

test("nextDepth: agents add a hop, persons reset", () => {
  assert.equal(nextDepth({ author: agent("a"), depth: 2 }), 3);
  assert.equal(nextDepth({ author: agent("a") }), 1);
  assert.equal(nextDepth({ author: person("p"), depth: 3 }), 0);
});

// No-inference-for-listener input table: whatever a message looks like, a listener is a responder only when it was @mentioned.
test("listener never infers: 50 scripted messages give turns only to the lead and to explicit mentions", () => {
  const table: RouteMessage[] = [];
  for (let i = 0; i < 50; i++) {
    const m: RouteMessage = { author: i % 7 === 0 ? agent("intake") : person("dana"), mentions: [], depth: i % 7 === 0 ? 1 : 0 };
    if (i % 5 === 0) m.mentions = [agent("docs")];
    else if (i % 5 === 1) m.mentions = [person("sam")];
    else if (i % 5 === 2) m.mentions = [agent("billing"), person("sam")];
    table.push(m);
  }
  const listenerIds = new Set(["docs", "billing"]);
  let leadTurns = 0, mentionTurns = 0;
  for (const m of table) {
    const r = route(thread, m);
    const mentioned = new Set(m.mentions.filter((x) => x.kind === "agent").map((x) => x.id));
    for (const id of r.responders) {
      if (listenerIds.has(id)) { assert.ok(mentioned.has(id), `listener ${id} ran without an @mention`); mentionTurns++; }
      else { assert.equal(id, "intake"); leadTurns++; }
    }
    if (m.mentions.some((x) => x.kind === "person") && !mentioned.size) assert.deepEqual(r.responders, [], "lead never answers a message addressed to a person");
  }
  assert.ok(leadTurns > 0 && mentionTurns > 0);
});
