// no-inference-for-listener (ARCH 6.5, lead ruling 35).
// One lead, listeners, and 50 scripted messages. Provider calls and spend rows exist only
// for the lead and for explicit @mentions. A listener who is never mentioned costs nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../../lib/route.ts";
import type { RouteMessage, RouteThread } from "../../lib/route.ts";
import { fakeLlm } from "../../testkit/providers/llm.ts";
import type { LlmEvent } from "../../testkit/providers/llm.ts";
import { createTurnEngine } from "../src/turn-engine/index.ts";
import type { TurnInput, TurnSession } from "../src/turn-engine/index.ts";

const person = (id: string) => ({ kind: "person" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });

const script: LlmEvent[] = [
  { type: "text", text: "ok" },
  { type: "usage", inputTokens: 2, outputTokens: 1 },
  { type: "done" },
];

function sessionFromLlm(onSend: (input: TurnInput) => void): TurnSession {
  const llm = fakeLlm({ script, latencyMs: 0 });
  return {
    driverId: "fake",
    latencyMs: llm.latencyMs,
    async *send(input: TurnInput) {
      onSend(input);
      for await (const ev of llm.stream({ model: input.model, messages: input.messages })) {
        if (ev.type === "text") yield { type: "text", text: ev.text };
        else if (ev.type === "thinking") yield { type: "thinking", text: ev.text };
        else if (ev.type === "tool_call") yield { type: "tool_call", id: ev.id, name: ev.name, input: ev.input };
        else if (ev.type === "usage") yield { type: "usage", inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costMicros: 7 };
        else if (ev.type === "done") yield { type: "done" };
        else yield { type: "error", message: ev.message };
      }
    },
    inject() {},
    async cancel() {},
  };
}

test("no-inference-for-listener: a listening agent makes zero provider calls until mentioned", async () => {
  const calls: Record<string, number> = { intake: 0, docs: 0, billing: 0, quiet: 0 };
  const opened: Record<string, number> = { intake: 0, docs: 0, billing: 0, quiet: 0 };
  const systems: Record<string, string[]> = { intake: [], docs: [], billing: [], quiet: [] };
  const thread: RouteThread = {
    agents: [
      { id: "intake", mode: "lead" },
      { id: "docs", mode: "listen" },
      { id: "billing", mode: "listen" },
      { id: "quiet", mode: "listen" },
    ],
  };
  const engine = createTurnEngine({
    holder: "host:spc_listen",
    open: (who) => {
      opened[who.id] = (opened[who.id] ?? 0) + 1;
      return sessionFromLlm((input) => {
        calls[who.id] = (calls[who.id] ?? 0) + 1;
        const system = input.messages.find((row) => row.role === "system")?.content ?? "";
        systems[who.id]?.push(system);
      });
    },
  });
  engine.openThread({
    id: "thr",
    kind: "chat",
    starter: "dana",
    starterAccountRef: "#Dana_Key",
    agents: [
      { id: "intake", mode: "lead", name: "Intake", role: "answers first" },
      { id: "docs", mode: "listen", name: "Docs", role: "reviews docs" },
      { id: "billing", mode: "listen", name: "Billing", role: "invoices" },
      { id: "quiet", mode: "listen", name: "Quiet", role: "says nothing" },
    ],
  });

  assert.equal(engine.spend("docs").rows, 0);
  assert.equal(engine.spend("quiet").costMicros, 0);

  const table: RouteMessage[] = [];
  for (let i = 0; i < 50; i++) {
    const message: RouteMessage = {
      author: i % 7 === 0 ? agent("intake") : person("dana"),
      mentions: [],
      depth: i % 7 === 0 ? 1 : 0,
    };
    if (i % 5 === 0) message.mentions = [agent("docs")];
    else if (i % 5 === 1) message.mentions = [person("sam")];
    else if (i % 5 === 2) message.mentions = [agent("billing"), person("sam")];
    table.push(message);
  }

  for (let i = 0; i < table.length; i++) {
    const message = table[i];
    if (!message) throw new Error(`missing message ${i}`);
    const before = { ...calls };
    const direct = route(thread, message);
    const queued = engine.receive({ threadId: "thr", ...message, body: `m${i}` });
    assert.deepEqual(queued.responders, direct.responders, `message ${i}`);
    assert.equal(queued.reason, direct.reason);
    await engine.drain("thr");
    const mentioned = new Set(message.mentions.filter((row) => row.kind === "agent").map((row) => row.id));
    for (const id of ["docs", "billing", "quiet"]) {
      const delta = (calls[id] ?? 0) - (before[id] ?? 0);
      if (!mentioned.has(id)) assert.equal(delta, 0, `${id} ran without an @mention on message ${i}`);
    }
    if (message.mentions.some((row) => row.kind === "person") && mentioned.size === 0) {
      assert.deepEqual(queued.responders, [], "lead never answers a message addressed to a person");
    }
  }

  assert.ok((calls.intake ?? 0) > 0);
  assert.ok((calls.docs ?? 0) > 0);
  assert.ok((calls.billing ?? 0) > 0);
  assert.equal(calls.quiet ?? 0, 0);
  assert.equal(opened.quiet ?? 0, 0);
  assert.equal(opened.docs, calls.docs);
  assert.equal(engine.spend("quiet").rows, 0);
  assert.equal(engine.spend("quiet").costMicros, 0);
  assert.equal(engine.spend("docs").rows, calls.docs ?? 0);
  assert.equal(engine.spend("docs").costMicros, (calls.docs ?? 0) * 7);
  assert.equal(engine.spend("billing").rows, calls.billing ?? 0);
  assert.equal(engine.spend("billing").costMicros, (calls.billing ?? 0) * 7);
  assert.equal(engine.spend("intake").rows, calls.intake ?? 0);

  const leadContext = systems.intake ?? [];
  assert.ok(leadContext.length > 0);
  assert.ok(leadContext.every((text) => text.includes("Docs is listening")));
  assert.ok(leadContext.every((text) => text.includes("Billing is listening")));
  assert.ok(leadContext.every((text) => text.includes("Quiet is listening")));
});
