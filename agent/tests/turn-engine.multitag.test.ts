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
