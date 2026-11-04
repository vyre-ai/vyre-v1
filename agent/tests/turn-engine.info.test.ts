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

test("the turn keeps who paid and why: the account's name and whose it is", async () => {
  const run = async (acct: ResolvedAccount): Promise<string | undefined> => {
    const { c, now } = clock();
    const p = scriptedProvider({ script: () => [{ type: "text", text: "Hi." }, { type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }], beforeEvent: () => { c.t += 10; } });
    const engine = createTurnEngine({ holder: "host:s", now, openSession: p.openSession, resolveAccount: async () => acct });
    engine.openThread(thread([{ id: "mira", mode: "lead", model: "claude-opus-5-5" }]));
    engine.receive({ threadId: "T", author: person, body: "Hello." });
    await engine.idle("T");
    return engine.turns("T")[0]!.info!.paid;
  };
  assert.equal(await run(account({ kind: "api_key", ref: "#Dana_Key", name: "Dana Anthropic" })), "Dana Anthropic \u00b7 your key");
  assert.equal(await run(account({ kind: "subscription", name: "Claude Code" })), "Claude Code \u00b7 your sign-in");
  assert.match((await run(account({ kind: "api_key", ref: "#Team", name: "Team key", shared: true, via: "chat_key" })))!, /^Team key \u00b7 The agent's own account/);
  assert.equal(await run(account({ kind: "api_key", ref: "#Team", name: "OpenCode Go", shared: true, via: "space", fellBack: true })), "OpenCode Go \u00b7 Space account");
});

test("the turn keeps the model that really ran, not the one asked for, and the context of its last call, not the sum of its calls", async () => {
  const run = async (o: { account?: ResolvedAccount; session?: string; events: DriverEvent[]; asked?: string }) => {
    const { c, now } = clock();
    const p = scriptedProvider({ script: () => o.events, beforeEvent: () => { c.t += 10; } });
    const open = async (spec: Parameters<typeof p.openSession>[0]) => Object.assign(await p.openSession(spec), o.session ? { model: o.session } : {});
    const engine = createTurnEngine({ holder: "host:s", now, openSession: open as never, resolveAccount: async () => o.account ?? account() });
    engine.openThread(thread([{ id: "mira", mode: "lead", model: o.asked ?? "claude-sonnet-5-5" }]));
    engine.receive({ threadId: "T", author: person, body: "Hello." });
    await engine.idle("T");
    return engine.turns("T")[0]!;
  };
  const usage = (extra: object = {}): DriverEvent[] => [{ type: "text", text: "Hi." }, { type: "usage", inputTokens: 1_000_000, outputTokens: 8_300, contextTokens: 61_000, cacheReadTokens: 940_000, ...extra } as DriverEvent, { type: "done" }];
  // a session that says which model it runs (a swapped one) is what the record keeps
  assert.equal((await run({ session: "glm-5.3", events: usage() })).model, "glm-5.3");
  // the engine's own report of the model it ran wins over an alias or a blank
  assert.equal((await run({ asked: "sonnet", events: usage({ model: "claude-sonnet-5-5" }) })).model, "claude-sonnet-5-5");
  // a team chat swapped to the account's own default is not the model that was asked for
  assert.equal((await run({ account: account({ modelFallback: { from: "claude-sonnet-5-5" } }), events: usage() })).model, null);
  assert.equal((await run({ account: account({ modelFallback: { from: "claude-sonnet-5-5", to: "glm-5.3" } }), events: usage() })).model, "glm-5.3");
  // nothing said otherwise: the asked model
  const plain = await run({ events: usage() });
  assert.equal(plain.model, "claude-sonnet-5-5");
  assert.equal(plain.tokensIn, 1_000_000, "the turn's input adds up every call");
  assert.equal(plain.info!.contextTokens, 61_000, "the context is what the last call was shown");
});
