// A person who tags two agents in one message asks both: each runs once, for that person (G51, chat gap 14 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent } from "../src/turn-engine/index.ts";

const quiet: DriverEvent[] = [{ type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];
const crew = (): EngineAgent[] => [
  { id: "dex", name: "Dex", mode: "lead" },
  { id: "nova", name: "Nova", mode: "listen" },
];

test("@Dex @Nova in one message starts both agents", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: crew() });
  const r = engine.receive({
    threadId: "T",
    author: { kind: "person", id: "dana" },
    mentions: [
      { kind: "agent", id: "dex" },
      { kind: "agent", id: "nova" },
    ],
    body: "@Dex @Nova look at this",
  });
  assert.deepEqual(r.responders, ["dex", "nova"]);
  assert.equal(r.qseqs.length, 2);
  await engine.idle("T");
  assert.equal(p.sessions.filter((s) => s.spec.agent.id === "dex").length, 1);
  assert.equal(p.sessions.filter((s) => s.spec.agent.id === "nova").length, 1);
});

test("agents asked together are told to open with an Answer line; an agent asked alone is not", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: crew() });
  const dana = { kind: "person" as const, id: "dana" };
  engine.receive({
    threadId: "T",
    author: dana,
    mentions: [
      { kind: "agent", id: "dex" },
      { kind: "agent", id: "nova" },
    ],
    body: "@Dex @Nova which?",
  });
  await engine.idle("T");
  const notices = p.sessions.flatMap((s) => s.inputs.map((i) => i.notice ?? ""));
  assert.equal(notices.length, 2);
  for (const n of notices) assert.match(n, /Answer: /);
  engine.receive({ threadId: "T", author: dana, mentions: [{ kind: "agent", id: "dex" }], body: "@Dex again" });
  await engine.idle("T");
  const last = p.sessions.flatMap((s) => s.inputs).at(-1)!;
  assert.equal(last.notice ?? "", "", "one agent asked alone gets no round note");
});

test("rewind: messages the person went back over are not read as history by the next turn, and the chat still holds them", async () => {
  const p = scriptedProvider({ script: quiet });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "dex", name: "Dex", mode: "lead" }] });
  const dana = { kind: "person" as const, id: "dana" };
  const first = engine.receive({ threadId: "T", author: dana, mentions: [], body: "first ask" });
  await engine.idle("T");
  const second = engine.receive({ threadId: "T", author: dana, mentions: [], body: "second ask" });
  await engine.idle("T");
  // go back to before the second ask: everything after the first ask's turn is hidden
  const seqOf = (id: string): number => engine.messages("T").find((m) => m.id === id)!.threadSeq;
  engine.hide("T", seqOf(second.messageId) - 1, 1000);
  engine.receive({ threadId: "T", author: dana, mentions: [], body: "third ask" });
  await engine.idle("T");
  const last = p.sessions.flatMap((s) => s.inputs).at(-1)!;
  const read = last.history.map((m) => m.body);
  assert.ok(read.includes("first ask"));
  assert.ok(!read.includes("second ask"), "hidden from the agent");
  assert.ok(engine.messages("T").some((m) => m.body === "second ask"), "still in the chat");
  void first;
});
