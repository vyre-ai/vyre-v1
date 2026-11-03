// /usage tells the truth about a turn: the model it really ran (the engine's own default said so, never "unknown"), and the cached part of its input apart from the new part.
import test from "node:test";
import assert from "node:assert/strict";
import { hostSeams, handlers } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { until } from "../../../agent/src/turn-engine/harness.ts";
import type { EngineHostSeam } from "../runtime.ts";

const THREAD = "thr_real";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const }] }];

test("a Claude Code turn with no model named is recorded on the model the engine says it ran, and its cached input is counted apart", async () => {
  const h = harness({ threads: THREADS });
  const script = scriptedProvider({ script: () => [{ type: "text", text: "Hi." }, { type: "usage", inputTokens: 1_000_000, outputTokens: 8_300, contextTokens: 61_000, cacheReadTokens: 940_000, model: "claude-sonnet-5-5" }, { type: "done" }] });
  const host: EngineHostSeam = {
    holder: "host:spc_enginetest", openSession: script.openSession, now: () => 1_760_000_000_000,
    async call(cap, input, as) {
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", status: "ok", mine: true, title: "Claude Code", name: "Claude Code" }] };
      if (cap === "engine.turn.record" || cap === "engine.turn.record_usage") return (handlers as Record<string, (c: unknown, i: unknown) => unknown>)[cap]!({ ...h.ctx, principal: { kind: "person", id: as ?? "usr_dana" } }, input);
      if (cap === "threads.get") return { thread: THREADS[0] };
      throw new Error(`unexpected ${cap}`);
    },
  };
  hostSeams.setEngineHost(host);
  try {
    const engine = (await ensureRuntime(h.ctx))!;
    await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);
    engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
    await engine.idle(THREAD);
    await until(() => h.db.all("SELECT 1 FROM engine_usage").length > 0);
    const rows = h.db.all("SELECT model, tokens_in FROM engine_usage") as Array<{ model: string; tokens_in: number }>;
    assert.deepEqual(rows.map((r) => [r.model, r.tokens_in]), [["claude-sonnet-5-5", 1_000_000]], "the real model, not \"unknown\"");
    const out = (await (handlers as Record<string, (c: unknown, i: unknown) => unknown>)["engine.usage.query"]!({ ...h.ctx, principal: { kind: "person", id: "usr_dana" } }, { by: "model" })) as { rows: Array<{ key: string; totals: { tokensIn: number; cachedIn?: number } }>; totals: { cachedIn?: number } };
    assert.deepEqual(out.rows.map((r) => [r.key, r.totals.tokensIn, r.totals.cachedIn]), [["claude-sonnet-5-5", 1_000_000, 940_000]]);
    assert.equal(out.totals.cachedIn, 940_000);
  } finally { hostSeams.setEngineHost(null); }
});
