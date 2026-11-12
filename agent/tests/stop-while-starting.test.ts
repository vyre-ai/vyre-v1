// A Stop pressed in the moment between the queue and the run (the turn is off the queue and its account is being read) must stop that turn, not find nothing and let it run to the end
// (lead, 12 Nov 2026: the polish walk's Stop that never took under load).
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
const account = (): ResolvedAccount => ({ ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "dana", reason: "starter", itemId: "vit_1" });

test("Stop while the turn's account is still being read stops that turn", async () => {
  const p = scriptedProvider({ script: () => [...Array.from({ length: 40 }, (_, i) => ({ type: "text" as const, text: `word${i} ` })), { type: "done" as const }], beforeEvent: () => new Promise<void>((r) => setTimeout(r, 20)) });
  let release = (): void => undefined;
  const slow = new Promise<void>((res) => { release = res; });
  let asked = 0;
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => { asked += 1; await slow; return account(); } });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "write the long plan" });
  for (let i = 0; i < 50 && asked === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(asked, 1, "the turn is off the queue, reading its account");
  const stopping = engine.stop("T");
  setTimeout(release, 30);
  const r = await stopping;
  assert.equal(r.stopped.length, 1, "the Stop found the turn");
  await engine.idle("T");
  assert.notEqual(engine.turns("T")[0]?.state, "completed", "it did not run to the end");
});
