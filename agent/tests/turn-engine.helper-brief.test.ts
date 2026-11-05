// The first line of a helper's chat is the lead's brief to the helper, not a hand-off: it is not cut by the mention-hop limit, however long the lead's chat already is. A later agent mention in the helper's chat still is.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const account = (): ResolvedAccount => ({ ref: "#A", driver: "anthropic", provider: "anthropic", kind: "api_key", payer: "dana", reason: "starter", itemId: "vit_1" });
const say = [{ type: "text" as const, text: "Done." }, { type: "done" as const }];
const helper = (): OpenThread => ({ id: "H", kind: "helper", starter: "dana", agents: [{ id: "coder", mode: "lead" }] });

test("a brief from the lead at a deep hop count still starts the helper's first turn", async () => {
  const p = scriptedProvider({ script: () => say });
  const e = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  e.openThread(helper());
  const r = e.receive({ threadId: "H", author: { kind: "agent", id: "lead" }, mentions: [{ kind: "agent", id: "coder" }], depth: 7, body: "Write file 4.", asker: "dana" });
  assert.deepEqual(r.responders, ["coder"]);
  await e.idle("H");
  assert.equal(p.sessions.length, 1, "the coder had its first turn");
});

test("an agent mention after the brief in the same helper chat is still cut at the hop limit", async () => {
  const p = scriptedProvider({ script: () => say });
  const e = createTurnEngine({ holder: "host:s", openSession: p.openSession, resolveAccount: async () => account() });
  e.openThread(helper());
  e.receive({ threadId: "H", author: { kind: "agent", id: "lead" }, mentions: [{ kind: "agent", id: "coder" }], depth: 1, body: "brief" });
  await e.idle("H");
  const r = e.receive({ threadId: "H", author: { kind: "agent", id: "lead" }, mentions: [{ kind: "agent", id: "coder" }], depth: 7, body: "again" });
  assert.deepEqual(r.responders, []);
});
