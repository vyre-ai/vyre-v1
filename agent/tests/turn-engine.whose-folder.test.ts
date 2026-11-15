// F75: who pays for a turn is not whose folder it works in. In a chat with other people each person's message runs for that person, so the agent works in that person's own folder for the chat (and, on a
// shared agent's computer, as that person's own user), even when the account that pays is another person's: the one Ada connected, or a key of the Space.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const thread: OpenThread = {
  id: "T",
  kind: "channel",
  starter: "ada",
  agents: [{ id: "nova", mode: "lead", model: "glm-5" }],
};
/** Ada's account pays for every turn in the chat, whoever asked. */
const adaPays: ResolvedAccount = {
  ref: "#Ada_Go",
  driver: "opencode_go",
  provider: "opencode_go",
  kind: "api_key",
  payer: "ada",
  reason: "starter",
} as ResolvedAccount;

test("a message from Bea in Ada's chat runs for Bea, whoever's account pays; the spend still goes to the payer", async () => {
  const p = scriptedProvider({ script: () => [{ type: "text", text: "ok" }, { type: "usage", inputTokens: 10, outputTokens: 4 }, { type: "done" }] });
  const e = createTurnEngine({ holder: "h", openSession: p.openSession, resolveAccount: async () => adaPays });
  e.openThread(thread);
  e.receive({ threadId: "T", author: { kind: "person", id: "ada" }, body: "from Ada" });
  await e.idle("T");
  e.receive({ threadId: "T", author: { kind: "person", id: "bea" }, body: "from Bea" });
  await e.idle("T");
  assert.deepEqual(
    p.specs.map((s) => s.asker),
    ["ada", "bea"],
    "the session of each turn is opened for the person who asked: their folder, their user",
  );
  assert.deepEqual(
    e.turns("T").map((t) => t.asker),
    ["ada", "bea"],
  );
  assert.deepEqual(
    e.spend().map((x) => x.payer),
    ["ada", "ada"],
    "Ada's account paid for both",
  );
});
