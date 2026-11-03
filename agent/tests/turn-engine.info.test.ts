// What a reply's Details show is filled by the turn engine as the turn runs (TurnRow.info): the effort, the account that paid at the end, the first token, the provider's own counts and
// price, every tool call with its duration and whether it was held, and each account switch. A count the provider did not send stays absent (never 0).
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const thread = (agents: EngineAgent[]): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents });
const account = (over: Partial<ResolvedAccount> = {}): ResolvedAccount => ({ ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "dana", reason: "starter", ...over });

function clock() { const c = { t: 1_000_000 }; return { c, now: () => c.t }; }

test("a CLI turn records its effort, account, first token, cache split, price and its own tool steps with durations", async () => {
  const { c, now } = clock();
  const script = (): DriverEvent[] => [
    { type: "block", kind: "tool_call", payload: { id: "tu1", name: "Read" } },
    { type: "block", kind: "tool_input", payload: { id: "tu1", detail: "upload-spec.md" } },
    { type: "block", kind: "tool_result", payload: { id: "tu1", ok: true } },
    { type: "text", text: "Three teammates on this." },
    { type: "usage", inputTokens: 41_280, outputTokens: 1904, cacheReadTokens: 30_000, cacheWriteTokens: 9650, costUsd: 0.42 },
    { type: "done" },
  ];
  const p = scriptedProvider({ script, beforeEvent: () => { c.t += 700; } });
  const engine = createTurnEngine({ holder: "host:s", now, openSession: p.openSession, resolveAccount: async () => account() });
  engine.openThread(thread([{ id: "mira", mode: "lead", model: "claude-opus-5-5", effort: "high" }]));
  engine.receive({ threadId: "T", author: person, body: "Documents next." });
  await engine.idle("T");
  const t = engine.turns("T")[0]!;
  assert.equal(t.state, "completed");
  const info = t.info!;
  assert.equal(info.effort, "high");
  assert.deepEqual(info.account, { ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription" });
  assert.equal(info.cacheReadTokens, 30_000);
  assert.equal(info.cacheWriteTokens, 9650);
  assert.equal(info.reasoningTokens, undefined, "Claude Code does not count reasoning apart: not reported, not 0");
  assert.equal(info.costUsd, 0.42);
  assert.ok(info.firstTokenAt !== undefined && info.firstTokenAt >= t.startedAt);
  assert.equal(info.tools.length, 1);
  const read = info.tools[0]!;
  assert.deepEqual({ id: read.id, name: read.name, detail: read.detail, ok: read.ok }, { id: "tu1", name: "Read", detail: "upload-spec.md", ok: true });
  assert.equal(read.endedAt! - read.startedAt, 1400, "the call took from its call block to its result block");
  assert.deepEqual(info.switches, []);
});

test("an API turn lists each tool call it ran with its duration, and drops the price when one call did not report it", async () => {
  const { c, now } = clock();
  const script = (): DriverEvent[] => [
    { type: "tool_call", id: "c1", name: "records_list", input: { query: "unpaid invoices" } }, { type: "usage", inputTokens: 900, outputTokens: 40, costUsd: 0.01 },
    { type: "text", text: "Found 3." }, { type: "usage", inputTokens: 1050, outputTokens: 6 }, { type: "done" },
  ];
  const p = scriptedProvider({ script });
  const engine = createTurnEngine({
    holder: "host:s", now, openSession: p.openSession, resolveAccount: async () => account({ ref: "#Team_Key", driver: "openrouter", provider: "openrouter", kind: "api_key", shared: true }),
    callTool: async () => { c.t += 2500; return { ok: true, content: [] }; },
  });
  engine.openThread(thread([{ id: "docs", mode: "lead" }]));
  engine.receive({ threadId: "T", author: person, body: "Who owes us?" });
  await engine.idle("T");
  const info = engine.turns("T")[0]!.info!;
  assert.equal(info.tools.length, 1);
  assert.equal(info.tools[0]!.name, "records_list");
  assert.equal(info.tools[0]!.detail, "unpaid invoices", "a short summary of what it was asked");
  assert.equal(info.tools[0]!.endedAt! - info.tools[0]!.startedAt, 2500);
  assert.equal(info.costUsd, undefined, "one call had no price: the turn's price is not reported rather than half of it");
  assert.equal(info.effort, undefined);
  assert.equal(info.account?.shared, true);
});

test("an account switch on a refused key is kept with the turn: from, to and why", async () => {
  const p = scriptedProvider({
    script: (_input, spec) => (spec.account?.ref === "#Dana_Claude"
      ? [{ type: "error", code: "provider.rate_limited", message: "session cap" }]
      : [{ type: "text", text: "Done." }, { type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }]) as DriverEvent[],
  });
  const engine = createTurnEngine({
    holder: "host:s", openSession: p.openSession, resolveAccount: async () => account(),
    nextAccount: async () => account({ ref: "#Team_Anthropic", driver: "anthropic", kind: "api_key", shared: true }),
  });
  engine.openThread(thread([{ id: "mira", mode: "lead" }]));
  engine.receive({ threadId: "T", author: person, body: "Keep going." });
  await engine.idle("T");
  const t = engine.turns("T")[0]!;
  assert.equal(t.state, "completed");
  assert.deepEqual(t.info!.switches.map((s) => [s.from, s.to, s.why]), [["#Dana_Claude", "#Team_Anthropic", "provider.rate_limited"]]);
  assert.equal(t.info!.account?.ref, "#Team_Anthropic", "the account that paid at the end");
});
