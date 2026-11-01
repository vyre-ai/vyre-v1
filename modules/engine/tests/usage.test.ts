// engine.usage.get (the composer model panel) and the account name on engine.accounts.list. Real SQLite for the turn records and the stored limit readings; the accounts, the thread and the
// agent are scripted stand-ins. The answers are checked against the manifest of this module (the generated registry is rebuilt by CI, so new shapes are read from the manifest itself).
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/engine.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { windowFor } from "../../../agent/src/transcript/windows.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { until } from "../../../agent/src/turn-engine/harness.ts";
import { accountsList } from "../handlers/accounts.ts";
import { modelsList } from "../handlers/extra/models.ts";
import { recordAccountLimits, usageGet } from "../handlers/usage.ts";
import { ensureExtra } from "../handlers/extra/schema.ts";
import { ensureRuntime } from "../runtime.ts";
import { hostSeams, handlers } from "../impl.ts";
import { bindEngine } from "../projections.ts";
import { codeOf, harness, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const T = "thr_usage", A = "agt_usage", OTHER = "agt_other";
const CLAUDE = { ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", title: "Claude Code", name: "Dana Claude Max", mine: true, status: "ok" };
const CLAUDE2 = { ref: "#Work_Claude", driver: "claude_code", kind: "subscription", title: "Claude Code", name: "Acme Claude Team", mine: true, status: "ok" };
const KEY = { ref: "#Dana_Anthropic", driver: "anthropic", kind: "api_key", title: "Anthropic", mine: true, status: "ok" };

function setup(o: { model?: string | null; accounts?: unknown[]; resolved?: string | null } = {}) {
  const h = harness({ threads: [{ threadId: T, agents: [{ agentId: A, mode: "lead", ...(o.model === null ? {} : { model: o.model ?? "claude-sonnet-5-5" }) }] }] });
  const accounts = o.accounts ?? [CLAUDE, CLAUDE2, KEY];
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap, input) {
      if (cap === "engine.accounts.list") return { accounts };
      if (cap === "engine.account.resolve") return { accountRef: o.resolved === undefined ? "#Dana_Claude" : o.resolved, payer: "usr_dana", reason: "starter", allowed: true };
      if (cap === "agents.get") return { agent: {} };
      return h.ctx.call(cap, input);
    },
  };
  ensureExtra(h.db);
  return { h, ctx };
}

let n = 0;
function turn(h: Harness, o: { agent?: string; tokensIn: number; at: number; thread?: string }): void {
  n += 1;
  h.db.run(
    `INSERT INTO engine_turns (turn_id, thread_id, agent_id, asker, account_ref, engine, model, placement, state, trace_id, run_id, qseq, started_at, ended_at, tokens_in, tokens_out, cost_micros, error, retry_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `trn_u${n}`, o.thread ?? T, o.agent ?? A, "usr_dana", "#Dana_Claude", "claude_code", "claude-sonnet-5-5", "host", "completed", "0".repeat(32), null, n, o.at, o.at + 5, o.tokensIn, 100, 0, null, null,
  );
}

const shape = (v: unknown): string[] => validate(manifest.capabilities!.find((c) => c.name === "engine.usage.get")!.output, v, "", {});

test("context used is the input tokens of the thread's latest turn for that agent, against the window of the agent's model", async () => {
  const { h, ctx } = setup();
  turn(h, { tokensIn: 12_000, at: NOW - 5000 });
  turn(h, { tokensIn: 48_000, at: NOW - 1000 });
  turn(h, { tokensIn: 90_000, at: NOW - 100, agent: OTHER });
  turn(h, { tokensIn: 7_000, at: NOW - 100, thread: "thr_elsewhere" });
  turn(h, { tokensIn: 0, at: NOW });
  const out = await usageGet(ctx, { threadId: T, agentId: A });
  assert.deepEqual(shape(out), []);
  assert.deepEqual(out.context, { used: 48_000, window: 200_000 });
});

test("the window comes from the model catalog: 1M for a [1m] model, GPT-5 at 258,400, and what Set model chose wins", async () => {
  const big = setup({ model: "claude-opus-5[1m]" });
  assert.deepEqual((await usageGet(big.ctx, { threadId: T, agentId: A })).context, { used: 0, window: 1_000_000 });
  const gpt = setup({ model: "gpt-5", accounts: [{ ...KEY, ref: "#Dana_OpenAI", driver: "openai" }], resolved: "#Dana_OpenAI" });
  assert.deepEqual((await usageGet(gpt.ctx, { threadId: T, agentId: A })).context, { used: 0, window: 258_400 });
  const chosen = setup();
  chosen.h.db.run("INSERT INTO engine_agent_state (thread_id, agent_id, mode, model, provider, effort, account_ref, engine, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", T, A, "ask", "gemini-2.5-pro", "google", null, null, null, NOW);
  assert.deepEqual((await usageGet(chosen.ctx, { threadId: T, agentId: A })).context, { used: 0, window: 1_000_000 });
});

test("the context figure never passes the window, and a chat that has not started is zero used, not unknown", async () => {
  const { h, ctx } = setup();
  assert.deepEqual((await usageGet(ctx, { threadId: T, agentId: A })).context, { used: 0, window: 200_000 });
  turn(h, { tokensIn: 450_000, at: NOW });
  assert.deepEqual((await usageGet(ctx, { threadId: T, agentId: A })).context, { used: 200_000, window: 200_000 }, "a turn of several model calls sums their inputs; the figure is held at the window");
});

test("every model the app offers has a window in the catalog, and models.list carries it as contextTokens", async () => {
  for (const [model, provider, want] of [
    ["opus", "anthropic", 200_000], ["sonnet", "anthropic", 200_000], ["haiku", "anthropic", 200_000], ["gpt-5-codex", "openai", 258_400], ["gpt-5", "openai", 258_400],
    ["grok-4", "xai", 256_000], ["grok-code-fast-1", "xai", 256_000], ["gemini-2.5-pro", "google", 1_000_000],
  ] as const) assert.equal(windowFor(model, provider), want, model);
  const h = harness();
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap) {
      if (cap === "providers.list") return { providers: [{ id: "prv_a", providerKey: "anthropic", name: "Anthropic", connection: "api_key", scope: "mine", handle: "#Dana_Anthropic", itemId: "vit_a", engine: "anthropic", spaceMayUse: false, state: "ok" }] };
      if (cap === "providers.test") return { ok: true, models: ["claude-sonnet-5-5", "claude-opus-5[1m]"] };
      return h.ctx.call(cap, {});
    },
  };
  assert.deepEqual((await modelsList(ctx, {})).models.map((m) => [m.model, m.contextTokens]), [["claude-opus-5[1m]", 1_000_000], ["claude-sonnet-5-5", 200_000]]);
});

test("no model name anywhere means no context figure, not a guess", async () => {
  const { ctx } = setup({ model: null });
  const out = await usageGet(ctx, { threadId: T, agentId: A });
  assert.equal(out.context, null);
  assert.deepEqual([out.session, out.week, out.source], [null, null, "none"]);
  assert.deepEqual(shape(out), []);
});

test("session and week are returned only when the provider reported them, per account, and source says provider", async () => {
  const { h, ctx } = setup();
  turn(h, { tokensIn: 1_000, at: NOW - 10 });
  const before = await usageGet(ctx, { threadId: T, agentId: A });
  assert.deepEqual([before.session, before.week, before.source], [null, null, "estimate"], "nothing reported: no meters, and the source is our own count");

  recordAccountLimits(h.db, "#Dana_Claude", { window: "session", pct: 43, resetsAt: NOW + 3_600_000 }, NOW);
  const one = await usageGet(ctx, { threadId: T, agentId: A });
  assert.deepEqual([one.session, one.week, one.source], [{ pct: 43, resetsAt: NOW + 3_600_000 }, null, "provider"]);

  recordAccountLimits(h.db, "#Dana_Claude", { window: "week", pct: 7.1 }, NOW);
  recordAccountLimits(h.db, "#Dana_Claude", { window: "session", pct: 51, resetsAt: NOW + 3_000_000 }, NOW + 1);
  const both = await usageGet(ctx, { threadId: T, agentId: A });
  assert.deepEqual([both.session, both.week], [{ pct: 51, resetsAt: NOW + 3_000_000 }, { pct: 7.1 }], "the latest reading replaces the earlier one");
  assert.deepEqual(shape(both), []);

  const second = await usageGet(ctx, { threadId: T, agentId: A, accountRef: "#Work_Claude" });
  assert.deepEqual([second.session, second.week], [null, null], "another account has its own readings");
  const key = await usageGet(ctx, { threadId: T, agentId: A, accountRef: "#Dana_Anthropic" });
  assert.deepEqual([key.session, key.week, key.account?.provider], [null, null, "anthropic"], "an API key reports no session or week");
});

test("a reading whose window has reset is dropped; nonsense readings are never stored", async () => {
  const { h, ctx } = setup();
  recordAccountLimits(h.db, "#Dana_Claude", { window: "session", pct: 90, resetsAt: NOW - 1 }, NOW - 7_200_000);
  assert.equal((await usageGet(ctx, { threadId: T, agentId: A })).session, null);
  for (const bad of [{ window: "session", pct: -1 }, { window: "session", pct: 101 }, { window: "session", pct: Number.NaN }, { window: "month", pct: 5 }] as const) recordAccountLimits(h.db, "#Dana_Claude", bad as never, NOW);
  recordAccountLimits(h.db, "", { window: "week", pct: 5 }, NOW);
  assert.deepEqual(h.rows("SELECT * FROM engine_account_limits").map((r) => r.account_ref), ["#Dana_Claude"], "only the earlier valid reading is there");
});

test("the account carries the name the person gave it in the Vault, so two Claude accounts read differently", async () => {
  const { ctx } = setup();
  const a = await usageGet(ctx, { threadId: T, agentId: A, accountRef: "#Dana_Claude" });
  const b = await usageGet(ctx, { threadId: T, agentId: A, accountRef: "#Work_Claude" });
  assert.deepEqual([a.account?.name, b.account?.name, a.account?.provider], ["Dana Claude Max", "Acme Claude Team", "anthropic"]);
  const key = await usageGet(ctx, { threadId: T, agentId: A, accountRef: "#Dana_Anthropic" });
  assert.equal(key.account?.name, "Anthropic", "without a Vault name the provider title stands in");
});

test("without an accountRef the account that pays for the next turn is used; none means no account, still with the context", async () => {
  const { ctx } = setup();
  assert.equal((await usageGet(ctx, { threadId: T, agentId: A })).account?.ref, "#Dana_Claude");
  const none = setup({ resolved: null });
  const out = await usageGet(none.ctx, { threadId: T, agentId: A });
  assert.equal(out.account, null);
  assert.deepEqual(out.context, { used: 0, window: 200_000 });
  assert.deepEqual(shape(out), []);
});

test("an account that is not the caller's is not found, and says so in plain words", async () => {
  const { ctx } = setup();
  await assert.rejects(usageGet(ctx, { threadId: T, agentId: A, accountRef: "#Somebody_Else" }), (e) => codeOf(e) === "validation.not_found" && /no such account/.test((e as { error: { message: string } }).error.message));
});

test("accounts.list carries the Vault item name beside the provider title", async () => {
  const h = harness();
  const ctx = {
    ...h.ctx,
    async call() {
      const p = (o: Record<string, unknown>) => ({ providerKey: "anthropic", name: "Claude Code", connection: "subscription", scope: "mine", engine: "claude-code", spaceMayUse: false, state: "ok", ...o });
      return { providers: [p({ id: "prv_1", handle: "#Dana_Claude", itemId: "vit_1", itemName: "Dana Claude Max" }), p({ id: "prv_2", handle: "#Work_Claude", itemId: "vit_2", itemName: "Acme Claude Team" }), p({ id: "prv_3", handle: "#Old", itemId: "vit_3" })] };
    },
  };
  const { accounts } = await accountsList(ctx as never, {});
  assert.deepEqual(accounts.map((a) => [a.ref, a.title, (a as { name?: string }).name]), [["#Dana_Claude", "Claude Code", "Dana Claude Max"], ["#Work_Claude", "Claude Code", "Acme Claude Team"], ["#Old", "Claude Code", undefined]]);
  const row = manifest.capabilities!.find((c) => c.name === "engine.accounts.list")!.output;
  assert.deepEqual(validate(row, { accounts: accounts.map((a) => ({ ...a })) }, "", {}), []);
});

test("a limit window an engine reports during a real turn is stored for the paying account and then shows in usage.get", async () => {
  bindEngine(null);
  const h = harness({ threads: [{ threadId: T, kind: "chat", starter: "usr_dana", agents: [{ agentId: A, mode: "lead" }] }] });
  const script: DriverEvent[] = [{ type: "text", text: "Hi." }, { type: "limits", window: "session", pct: 43, resetsAt: NOW + 3_600_000 }, { type: "usage", inputTokens: 900, outputTokens: 40 }, { type: "done" }];
  const p = scriptedProvider({ script });
  hostSeams.setEngineHost({
    holder: "host:spc_enginetest", openSession: p.openSession, now: () => NOW,
    async call(cap) {
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
      if (cap === "engine.accounts.list") return { accounts: [CLAUDE] };
      if (cap === "engine.turn.record_usage" || cap === "engine.turn.record") return {};
      throw new Error(`unexpected ${cap}`);
    },
  });
  const engine = (await ensureRuntime(h.ctx))!;
  await handlers["engine.stop"]!(h.ctx as never, { threadId: T } as never).catch(() => undefined);
  engine.receive({ threadId: T, author: { kind: "person", id: "usr_dana" }, body: "hello" });
  await engine.idle(T);
  await until(() => h.rows("SELECT * FROM engine_account_limits").length === 1);
  const stored = h.rows("SELECT account_ref, win, pct, resets_at FROM engine_account_limits")[0];
  assert.deepEqual([stored?.account_ref, stored?.win, stored?.pct, stored?.resets_at], ["#Dana_Claude", "session", 43, NOW + 3_600_000]);
  hostSeams.setEngineHost(null);
  const out = await usageGet({ ...h.ctx, async call(cap: string, input: unknown) { return cap === "engine.accounts.list" ? { accounts: [CLAUDE] } : h.ctx.call(cap, input); } } as EngineCtx, { threadId: T, agentId: A, accountRef: "#Dana_Claude" });
  assert.deepEqual(out.session, { pct: 43, resetsAt: NOW + 3_600_000 });
});
