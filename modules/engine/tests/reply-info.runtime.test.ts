// End to end on the runtime: a chat turn on a CLI engine reports what its stream said (cache split, the engine's price, its own tool steps) with the turn, the bridge posts the reply and
// links it to the turn, and engine.turn.of_message finds the turn from the chat message id.
// @reads /modules/engine/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, hostSeams } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const THREAD = "thr_details";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const, model: "claude-sonnet-5-5" }] }];
const turnOut: DriverEvent[] = [
  { type: "block", kind: "tool_call", payload: { id: "tu1", name: "Read" } },
  { type: "block", kind: "tool_input", payload: { id: "tu1", detail: "brief.md" } },
  { type: "block", kind: "tool_result", payload: { id: "tu1", ok: true } },
  { type: "text", text: "Read it." },
  { type: "usage", inputTokens: 5000, outputTokens: 120, cacheReadTokens: 4000, cacheWriteTokens: 600, costUsd: 0.0123 },
  { type: "done" },
];

test("a CLI turn's usage, price and steps reach the turn record, and the posted reply finds its turn", async () => {
  const h = harness({ threads: THREADS });
  const p = scriptedProvider({ script: turnOut });
  const posts: string[] = [];
  const metered: Array<Record<string, unknown>> = [];
  hostSeams.setEngineHost({
    holder: "host:spc_enginetest", openSession: p.openSession, now: () => h.clock.t,
    async call(cap, input) {
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Key", payer: "usr_dana", reason: "starter", allowed: true };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Key", driver: "claude_code", provider: "anthropic", kind: "api_key", status: "ok" }] };
      if (cap === "engine.turn.record") return handlers[cap]!(h.ctx as never, input as never);
      if (cap === "threads.get") return { thread: THREADS[0] };
      if (cap === "engine.turn.record_usage") { metered.push(input as Record<string, unknown>); return {}; }
      if (cap === "agents.status") return {};
      throw new Error(`unexpected ${cap}`);
    },
    postAs: async (_agentId, post) => { posts.push(post.clientId); return {}; },
  });
  const engine = (await ensureRuntime(h.ctx))!;
  await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);   // opens the thread in the engine, as the runtime test does
  engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "Read the brief" });
  await engine.idle(THREAD);
  await until(() => posts.length > 0 && h.rows("SELECT 1 FROM engine_turn_info WHERE reply_message_id IS NOT NULL AND info IS NOT NULL").length > 0);
  const { turn } = await (handlers as unknown as Record<string, (c: never, i: never) => Promise<{ turn: Record<string, any> }>>)["engine.turn.of_message"]!(h.ctx as never, { threadId: THREAD, messageId: posts[0]! } as never);
  assert.equal(turn["model"], "claude-sonnet-5-5");
  assert.deepEqual(turn["tokens"], { in: 5000, out: 120, cacheRead: 4000, cacheWrite: 600 });
  assert.deepEqual(turn["tools"].map((x: any) => [x.name, x.args, x.ok]), [["Read", "brief.md", true]]);
  assert.equal(turn["partial"], false);
  assert.deepEqual(metered.map((m) => [m["tokensIn"], m["tokensOut"], m["costMicros"]]), [[5000, 120, 12_300]], "spend is metered at the engine's own price, not 0");
  hostSeams.setEngineHost(null);
});
