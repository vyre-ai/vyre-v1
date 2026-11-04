// The first reply of a new chat keeps its Details: the turn is linked to the message the bridge posted and engine.turn.of_message finds it.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, hostSeams } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineHostSeam } from "../runtime.ts";

const THREAD = "thr_first";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const, model: "claude-sonnet-5-5" }] }];
const say: DriverEvent[] = [{ type: "text", text: "Hello." }, { type: "usage", inputTokens: 900, outputTokens: 40 }, { type: "done" }];

test("a new chat's first reply has its turn: of_message answers with the model and the account", async () => {
  const h = harness({ threads: THREADS });
  const posts: Array<{ clientId: string }> = [];
  const host: EngineHostSeam = {
    holder: "host:spc_enginetest", openSession: scriptedProvider({ script: say }).openSession, now: () => 1_760_000_000_000,
    postAs: async (_a, post) => { posts.push(post as never); return {}; },
    async call(cap, input, as) {
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", status: "ok", mine: true }] };
      if (cap === "engine.turn.record" || cap === "engine.turn.record_usage" || cap === "engine.turn.of_message") return (handlers as Record<string, (c: unknown, i: unknown) => unknown>)[cap]!(h.ctx, input);
      if (cap === "threads.get") return { thread: THREADS[0] };
      if (cap === "chat.transcript.summarize" || cap === "chat.transcript.append") return {};
      throw new Error(`unexpected ${cap} ${as ?? ""}`);
    },
  };
  hostSeams.setEngineHost(host);
  try {
    const engine = (await ensureRuntime(h.ctx))!;
    await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);
    engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
    await engine.idle(THREAD);
    await until(() => posts.length > 0);
    await new Promise<void>((r) => setTimeout(r, 200));
    const out = (await (handlers as Record<string, (c: unknown, i: unknown) => unknown>)["engine.turn.of_message"]!({ ...h.ctx, principal: { kind: "person", id: "usr_dana" } }, { threadId: THREAD, messageId: posts[0]!.clientId })) as { turn: { model: string; paid?: string; accountRef?: string } };
    assert.equal(out.turn.model, "claude-sonnet-5-5");
  } finally { hostSeams.setEngineHost(null); }
});
