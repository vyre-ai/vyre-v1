// @nocache  (one test starts a real process and reads a fixture file that is not an import, so a pass is never reused from the cache)
// What a subscription engine says about its limit windows: Claude Code's rate_limit_event becomes a limits event (session = five_hour, week = seven_day), only with a number the engine
// gave, and the turn engine hands it to onLimits with the paying account. Nothing is estimated: a line without a number gives nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver } from "../src/drivers/cli/index.ts";
import { collect, driverDeps, newSpy, specOf, turnOf } from "../fixtures/golden-streams/rig.ts";
import { createClaudeDecoder, limitsOf } from "../src/drivers/cli/claude.ts";
import { createCodexDecoder } from "../src/drivers/cli/codex.ts";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { EngineAgent, OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const line = (info: Record<string, unknown>): string => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });

test("a five_hour window with utilization is the session; seven_day is the week; resetsAt seconds become milliseconds", () => {
  const d = createClaudeDecoder();
  assert.deepEqual(d.push(line({ status: "allowed_warning", resetsAt: 1_792_000_000, rateLimitType: "five_hour", utilization: 0.43 })), [{ type: "limits", window: "session", pct: 43, resetsAt: 1_792_000_000_000 }]);
  assert.deepEqual(d.push(line({ status: "allowed", resetsAt: 1_792_500_000, rateLimitType: "seven_day", utilization: 0.071 })), [{ type: "limits", window: "week", pct: 7.1, resetsAt: 1_792_500_000_000 }]);
});

test("a rejected window is full; an allowed one with no number says nothing; other windows and bad lines say nothing", () => {
  assert.deepEqual(limitsOf({ status: "rejected", resetsAt: 1_792_213_200, rateLimitType: "seven_day", overageStatus: "rejected" }), [{ type: "limits", window: "week", pct: 100, resetsAt: 1_792_213_200_000 }]);
  assert.deepEqual(limitsOf({ status: "allowed", resetsAt: 1_792_000_000, rateLimitType: "five_hour" }), []);
  assert.deepEqual(limitsOf({ status: "allowed_warning", rateLimitType: "seven_day_opus", utilization: 0.9 }), []);
  assert.deepEqual(limitsOf({ status: "allowed_warning", rateLimitType: "five_hour", utilization: "high" }), []);
  assert.deepEqual(limitsOf(null), []);
  assert.deepEqual(createClaudeDecoder().push(JSON.stringify({ type: "rate_limit_event" })), []);
});

test("a number above one is already a percent and is capped at 100; a resetsAt that is not a time is left off", () => {
  assert.deepEqual(limitsOf({ rateLimitType: "five_hour", utilization: 62.5, resetsAt: "soon" }), [{ type: "limits", window: "session", pct: 62.5 }]);
  assert.deepEqual(limitsOf({ rateLimitType: "five_hour", utilization: 140 }), [{ type: "limits", window: "session", pct: 100 }]);
});

test("Codex output carries no limit lines, so it reports none", () => {
  const d = createCodexDecoder();
  assert.deepEqual(d.push(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2 } })), [{ type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "end" }]);
});

test("through a real Claude Code session process, the rate_limit_event line arrives as a limits event ahead of the answer", async () => {
  const session = await createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(newSpy())).open(specOf());
  try {
    const events = await collect(session.send(turnOf("limits")));
    assert.deepEqual(events.find((e) => e.type === "limits"), { type: "limits", window: "session", pct: 43, resetsAt: 1_792_000_000_000 });
    assert.equal(events.at(-1)?.type, "done");
  } finally {
    await session.close();
  }
});

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const account = (): ResolvedAccount => ({ ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "dana", reason: "starter", itemId: "vit_1" });

test("the turn engine hands a reported window to onLimits with the paying account, and a throwing onLimits does not fail the turn", async () => {
  const p = scriptedProvider({ script: () => [
    { type: "text", text: "Hi." }, { type: "limits", window: "session", pct: 43, resetsAt: 1_792_000_000_000 }, { type: "limits", window: "week", pct: 7.1 }, { type: "done" },
  ] });
  const seen: Array<[string, string, number, number | undefined]> = [];
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession, resolveAccount: async () => account(),
    onLimits: (acct, r) => { seen.push([acct.ref, r.window, r.pct, r.resetsAt]); },
  });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.deepEqual(seen, [["#Dana_Claude", "session", 43, 1_792_000_000_000], ["#Dana_Claude", "week", 7.1, undefined]]);
  assert.equal(engine.turns("T")[0]?.state, "completed");

  const q = scriptedProvider({ script: () => [{ type: "limits", window: "session", pct: 10 }, { type: "text", text: "ok" }, { type: "done" }] });
  const hurt = createTurnEngine({ holder: "host:s", openSession: q.openSession, resolveAccount: async () => account(), onLimits: () => { throw new Error("db is locked"); } });
  hurt.openThread(thread());
  hurt.receive({ threadId: "T", author: person, body: "hello" });
  await hurt.idle("T");
  assert.equal(hurt.turns("T")[0]?.state, "completed");
});

test("a turn with no account reports nothing, and onLimits is never called without one", async () => {
  const p = scriptedProvider({ script: () => [{ type: "limits", window: "session", pct: 10 }, { type: "text", text: "ok" }, { type: "done" }] });
  let called = 0;
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, onLimits: () => { called += 1; } });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.equal(called, 0);
});
