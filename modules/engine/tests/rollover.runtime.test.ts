// The runtime calls the rollover check after a turn completes (modules/engine/runtime.ts): a Claude Code chat whose turn reported a nearly full window starts a fresh session next time.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, hostSeams } from "../impl.ts";
import { ensureRuntime } from "../runtime.ts";
import { lastCompaction, saveResumeId } from "../cli-sessions.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineHostSeam } from "../runtime.ts";

const THREAD = "thr_roll";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const }] }];
const full: DriverEvent[] = [{ type: "text", text: "Done." }, { type: "usage", inputTokens: 170_000, outputTokens: 40 }, { type: "done" }];

test("a turn that reported 170k of a 200k window is followed by a rollover: the engine session is forgotten, a Vyre summary stands in, and the chat is told", async () => {
  const h = harness({ threads: THREADS });
  const posts: string[] = [];
  const host: EngineHostSeam = {
    holder: "host:spc_enginetest", openSession: scriptedProvider({ script: full }).openSession, now: () => 1_760_000_000_000,
    postAs: async (_a, post) => { posts.push(String(((post as { blocks?: Array<{ data?: { text?: unknown } }> }).blocks ?? [])[0]?.data?.text)); return {}; },
    async call(cap, input) {
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", status: "ok" }] };
      if (cap === "engine.turn.record_usage") return {};
      if (cap === "chat.transcript.summarize") return {};
      if (cap === "chat.transcript.summary") return { summary: "Asked (turn 1): hello" };
      if (cap === "threads.get") return { thread: { mode: "auto", agents: [{ agentId: "agt_intake", model: "claude-sonnet-5-5" }] } };
      throw new Error(`unexpected ${cap} ${JSON.stringify(input)}`);
    },
  };
  hostSeams.setEngineHost(host);
  try {
    const engine = (await ensureRuntime(h.ctx))!;
    await handlers["engine.stop"]!(h.ctx as never, { threadId: THREAD } as never).catch(() => undefined);
    saveResumeId(h.db, { threadId: THREAD, agentId: "agt_intake", person: "usr_dana", driver: "claude_code" }, "7c1e", 1);
    engine.receive({ threadId: THREAD, author: { kind: "person", id: "usr_dana" }, body: "hello" });
    await engine.idle(THREAD);
    await until(() => lastCompaction(h.db, THREAD, "agt_intake") !== null);
    assert.equal(lastCompaction(h.db, THREAD, "agt_intake")!.how, "vyre");
    await until(() => posts.some((p) => /^Started a fresh session to keep the window from filling/.test(p)));
  } finally { hostSeams.setEngineHost(null); }
});
