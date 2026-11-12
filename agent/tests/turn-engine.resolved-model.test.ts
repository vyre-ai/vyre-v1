// A thread opened with no model on its agent (boot recovery opens threads from the chat's own record, which names no model when the chat runs on the agent's own) runs each turn on the model the
// account resolver chose for it (the chat's pick, else the agent's own model): never an empty one (release gate, 12 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const thread = (model?: string): OpenThread => ({
  id: "T",
  kind: "chat",
  starter: "dana",
  agents: [{ id: "ops", mode: "lead", ...(model === undefined ? {} : { model }) }],
});
const account = (model?: string): ResolvedAccount =>
  ({
    ref: "#Dana_Go",
    driver: "opencode_go",
    provider: "opencode_go",
    kind: "api_key",
    payer: "dana",
    reason: "starter",
    ...(model ? { model } : {}),
  }) as ResolvedAccount;

test("an agent the thread names no model for runs on the resolver's model; one with a model keeps its own; an empty model counts as none", async () => {
  for (const [opened, resolved, want] of [
    [undefined, "deepseek-v4.1-flash", "deepseek-v4.1-flash"],
    ["", "deepseek-v4.1-flash", "deepseek-v4.1-flash"],
    ["glm-5", "deepseek-v4.1-flash", "glm-5"],
  ] as const) {
    const p = scriptedProvider({ script: () => [{ type: "text", text: "ok" }, { type: "done" }] });
    const e = createTurnEngine({
      holder: "h",
      openSession: p.openSession,
      resolveAccount: async () => account(resolved),
    });
    e.openThread(thread(opened));
    e.receive({ threadId: "T", author: { kind: "person", id: "dana" }, body: "hi" });
    await e.idle("T");
    assert.equal(p.specs[0]?.agent.model, want, `opened with ${JSON.stringify(opened)}`);
    assert.equal(e.turns("T")[0]?.model, want);
  }
});

test("a chat with no model fails each turn with engine.no_model, and that never parks the agent: the next message still runs once a model is picked", async () => {
  let picked = false;
  const p = scriptedProvider({
    script: () =>
      (picked
        ? [{ type: "text", text: "ok" }, { type: "done" }]
        : [{ type: "error", code: "engine.no_model", message: "No model is set for this chat." }]) as never,
  });
  const e = createTurnEngine({ holder: "h", openSession: p.openSession, resolveAccount: async () => account() });
  e.openThread(thread());
  for (let i = 0; i < 4; i++) {
    e.receive({ threadId: "T", author: { kind: "person", id: "dana" }, body: `try ${i}` });
    await e.idle("T");
  }
  assert.deepEqual(
    e.turns("T").map((t) => t.error?.code),
    ["engine.no_model", "engine.no_model", "engine.no_model", "engine.no_model"],
    "every message ran and said so; none was held back",
  );
  picked = true;
  e.receive({ threadId: "T", author: { kind: "person", id: "dana" }, body: "now" });
  await e.idle("T");
  assert.equal(e.turns("T").at(-1)?.state, "completed");
});
