// A reply's Details (reply-info.ts): engine.turn.record keeps what the turn engine saw and prices the turn at the list price of the day; the bridge links the reply to its turn;
// engine.turn.of_message answers with it, the account, cost and tool arguments only for the asker and the managers of AI spend. engine.turn.get no longer answers a turn of a chat the
// caller cannot open, and shows the in-process engine's tool steps and account switches.
import test from "node:test";
import assert from "node:assert/strict";
import { extraHandlers } from "../handlers/extra/index.ts";
import { linkReply } from "../handlers/extra/reply-info.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";
import type { TurnInfo } from "../../../agent/src/turn-engine/types.ts";

const H = extraHandlers;
const T = "thr_portal";
const MSG = "msg_reply1";

function ctxOf(h: Harness): EngineCtx {
  return { ...h.ctx, call: async (cap: string, input: unknown) => (cap === "settings.get" ? { row: { value: { percent: 0, labels: [] } } } : h.ctx.call(cap, input)) };
}

const apiInfo = (over: Partial<TurnInfo> = {}): TurnInfo => ({
  effort: "medium", account: { ref: "#Team_Anthropic", driver: "anthropic", provider: "anthropic", kind: "api_key", shared: true }, firstTokenAt: 1_000_900,
  cacheReadTokens: 30_000, tools: [{ id: "c1", name: "Read", detail: "upload-spec.md", startedAt: 1_000_200, endedAt: 1_001_000, ok: true }, { id: "c2", name: "records.get", detail: "Client portal", startedAt: 1_001_000, endedAt: 1_001_400, ok: true, held: "tsk_ok1" }],
  switches: [], ...over,
});

async function recordTurn(h: Harness, info: TurnInfo, o: { turnId?: string; model?: string; asker?: string; tokensIn?: number; tokensOut?: number } = {}) {
  const ctx = ctxOf(h);
  const turnId = o.turnId ?? "trn_reply1";
  const base = { threadId: T, turnId, agentId: "agt_mira", qseq: 1, asker: o.asker ?? "usr_dana", ...(o.model === "" ? {} : { model: o.model ?? "claude-sonnet-5-5" }) };
  await H["engine.turn.record"](ctx, { ...base, phase: "started" });
  h.advance(14_000);
  const done = { ...base, phase: "completed" as const, tokensIn: o.tokensIn ?? 41_280, tokensOut: o.tokensOut ?? 1904, info, engine: info.account?.driver ?? "chat", ...(info.account ? { accountRef: info.account.ref } : {}) };
  assert.deepEqual(contractErrors("engine.turn.record", "in", done), [], "the runtime's record with its info is a valid input");
  await H["engine.turn.record"](ctx, done);
  linkReply(h.db, { threadId: T, turnId, messageId: MSG }, h.ctx.now());
  return turnId;
}

test("an API turn records its cost from the list price and its tokens, and the reply's Details show them", async () => {
  const h = harness();
  await recordTurn(h, apiInfo());
  const out = H["engine.turn.of_message"](h.ctx, { threadId: T, messageId: MSG });
  assert.deepEqual(contractErrors("engine.turn.of_message", "out", out), []);
  const { turn } = out;
  assert.equal(turn.model, "claude-sonnet-5-5");
  assert.equal(turn.effort, "medium");
  assert.equal(turn.engine, "anthropic");
  assert.equal(turn.accountKind, "api_key");
  assert.equal(turn.shared, true);
  assert.equal(turn.accountRef, "#Team_Anthropic");
  assert.deepEqual(turn.tokens, { in: 41_280, out: 1904, cacheRead: 30_000 }, "cache writes and reasoning were not reported: absent, not 0");
  // 11,280 plain input at $2, 1,904 output at $10, 30,000 cache reads at $0.20 (per million)
  assert.deepEqual(turn.cost, {
    source: "catalog", micros: 22_560 + 19_040 + 6_000, priceAsOf: "2026-10-06",
    lines: [{ kind: "input", tokens: 11_280, perMillion: 2, micros: 22_560 }, { kind: "output", tokens: 1904, perMillion: 10, micros: 19_040 }, { kind: "cache_read", tokens: 30_000, perMillion: 0.2, micros: 6_000 }],
  });
  assert.equal(h.rows("SELECT cost_micros FROM engine_turns WHERE turn_id = 'trn_reply1'")[0]?.["cost_micros"], 47_600, "the turn row carries the same cost, for spend");
  assert.equal(turn.timing.firstTokenAt, 1_000_900);
  assert.equal(turn.timing.endedAt! - turn.timing.startedAt, 14_000);
  assert.deepEqual(turn.tools, [{ name: "Read", args: "upload-spec.md", ok: true, durationMs: 800 }, { name: "records.get", args: "Client portal", ok: true, durationMs: 400, heldTaskId: "tsk_ok1" }]);
  assert.deepEqual(turn.files, { read: ["upload-spec.md"], written: [] });
  assert.equal(turn.private, false);
  assert.equal(turn.partial, false);
});

test("a sign-in turn is in the plan: no dollar figure, whatever the engine printed", async () => {
  const h = harness();
  await recordTurn(h, apiInfo({ account: { ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription" }, costUsd: 0.81 }), { model: "opus" });
  const { turn } = H["engine.turn.of_message"](h.ctx, { threadId: T, messageId: MSG });
  assert.deepEqual(turn.cost, { source: "subscription" });
  assert.equal(h.rows("SELECT cost_micros FROM engine_turns")[0]?.["cost_micros"], 0);
});

test("an API key turn the provider priced itself shows that price; a model with no list price says so instead of a number", async () => {
  const h = harness();
  await recordTurn(h, apiInfo({ account: { ref: "#Dana_Key", driver: "claude_code", provider: "anthropic", kind: "api_key" }, costUsd: 0.4213 }));
  assert.deepEqual(H["engine.turn.of_message"](h.ctx, { threadId: T, messageId: MSG }).turn.cost, { source: "reported", micros: 421_300 });

  const h2 = harness();
  await recordTurn(h2, apiInfo({ account: { ref: "#Team_Go", driver: "opencode_go", provider: "opencode_go", kind: "api_key", shared: true } }), { model: "glm-5.3" });
  const t2 = H["engine.turn.of_message"](h2.ctx, { threadId: T, messageId: MSG }).turn;
  assert.deepEqual(t2.cost, { source: "unknown" });
  assert.equal(t2.tokens.cacheWrite, undefined);
});

test("another member of a shared chat sees the model, agent, asker, where and tokens, but not the account, the cost or the tool arguments", async () => {
  const h = harness();
  await recordTurn(h, apiInfo());
  const omar = harness({ raw: h.raw, principal: { kind: "person", id: "usr_omar" }, manager: false });
  const seen = H["engine.turn.of_message"](omar.ctx, { threadId: T, messageId: MSG });
  assert.deepEqual(contractErrors("engine.turn.of_message", "out", seen), [], "the member's view is a valid output too");
  const { turn } = seen;
  assert.equal(turn.private, true);
  assert.equal(turn.asker, "usr_dana");
  assert.equal(turn.model, "claude-sonnet-5-5");
  assert.equal(turn.accountRef, undefined);
  assert.equal(turn.cost, undefined);
  assert.deepEqual(turn.tools.map((x) => [x.name, x.args]), [["Read", undefined], ["records.get", undefined]]);
  assert.deepEqual(turn.files, { read: [], written: [] });
  assert.equal(turn.tokens.in, 41_280);
  // the asker sees it all without being a manager
  const dana = harness({ raw: h.raw, principal: { kind: "person", id: "usr_dana" }, manager: false });
  assert.equal(H["engine.turn.of_message"](dana.ctx, { threadId: T, messageId: MSG }).turn.private, false);
});

test("a reply with no recorded turn is not found; an older turn with only its row is partial", async () => {
  const h = harness();
  assert.throws(() => H["engine.turn.of_message"](h.ctx, { threadId: T, messageId: "msg_nope" }), (e) => codeOf(e) === "validation.not_found");
  const ctx = ctxOf(h);
  await H["engine.turn.record"](ctx, { threadId: T, turnId: "trn_old1", agentId: "agt_mira", qseq: 1, asker: "usr_dana", phase: "completed", tokensIn: 10, tokensOut: 2 });
  linkReply(h.db, { threadId: T, turnId: "trn_old1", messageId: "msg_old1" }, 1);
  const old = H["engine.turn.of_message"](h.ctx, { threadId: T, messageId: "msg_old1" });
  assert.deepEqual(contractErrors("engine.turn.of_message", "out", old), []);
  const { turn } = old;
  assert.equal(turn.partial, true);
  assert.deepEqual(turn.tools, []);
  assert.equal(turn.cost, undefined);
});

test("engine.turn.get: the in-process engine's tool steps and account switches show, and a turn of a chat the caller cannot open does not exist for them", async () => {
  const h = harness();
  await recordTurn(h, apiInfo({ switches: [{ at: 1_000_100, from: "#Dana_Claude", to: "#Team_Anthropic", why: "provider.rate_limited" }] }));
  const { what } = H["engine.turn.get"](h.ctx, { turnId: "trn_reply1" });
  assert.deepEqual(what.steps.map((s) => [s.kind, s.title, s.ok]), [["tool_call", "Read", true], ["tool_result", "Read", true], ["tool_call", "records.get", true], ["tool_result", "records.get", true]]);
  assert.deepEqual(what.fallbacks, [{ kind: "backup_key", to: "#Team_Anthropic", at: 1_000_100 }]);
  const outsider = harness({ raw: h.raw, principal: { kind: "person", id: "usr_eve" }, manager: false });
  assert.throws(() => H["engine.turn.get"](outsider.ctx, { turnId: "trn_reply1" }), (e) => codeOf(e) === "validation.not_found");
  const asker = harness({ raw: h.raw, principal: { kind: "person", id: "usr_dana" }, manager: false });
  assert.equal(H["engine.turn.get"](asker.ctx, { turnId: "trn_reply1" }).what.turn.turnId, "trn_reply1", "the asker always sees their own turn");
});
