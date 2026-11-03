// The owner's rc.20 test: a model picked in the composer is never run as another one under its name. When no account that can pay serves it, the turn fails in one plain line that names the model
// and what can run, and offers to choose another or run on the person's own computer; nothing is swapped quietly.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, hostSeams } from "../modules/engine/impl.ts";
import { ensureRuntime } from "../modules/engine/runtime.ts";
import { harness } from "../modules/engine/fixtures/harness.ts";
import { scriptedProvider } from "../agent/src/turn-engine/scripted-session.ts";
import { until } from "../agent/src/turn-engine/harness.ts";
import { statusView } from "../apps/app/src/places/chats/conversation/status.ts";
import type { EngineHostSeam } from "../modules/engine/runtime.ts";

const THREAD = "thr_pick";
const THREADS = [{ threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [{ agentId: "agt_intake", mode: "lead" as const, model: "claude-sonnet-5-5" }] }];

test("a picked model no account serves ends the turn with one plain line, and no session runs", async () => {
  const h = harness({ threads: THREADS });
  const provider = scriptedProvider({ script: () => [{ type: "text", text: "Deepseek answered." }, { type: "done" }] });
  const posts: Array<{ blocks: Array<{ type: string; data: Record<string, unknown> }> }> = [];
  const host: EngineHostSeam = {
    holder: "host:spc_enginetest", openSession: provider.openSession, now: () => 1_760_000_000_000,
    postAs: async (_a, post) => { posts.push(post as never); return {}; },
    async call(cap) {
      if (cap === "engine.account.resolve") return { accountRef: null, payer: null, reason: "none", allowed: false, why: "no_model", model: "claude-sonnet-5-5", servedModels: ["glm-5.3", "kimi-k3"] };
      if (cap === "engine.turn.record" || cap === "engine.turn.record_usage") return {};
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
    await until(() => posts.length > 0);
    assert.equal(provider.sessions.length, 0, "nothing ran on another model");
    const block = posts[0]!.blocks.find((b) => b.type === "turn_status")!;
    assert.equal(block.data["code"], "engine.model_unavailable");
    const view = statusView({ type: "turn_status", v: 1, id: "b", data: block.data } as never);
    assert.equal(view.kind, "error");
    const data = (view as { block: { data: { message: string; next: Array<{ key: string }> } } }).block.data;
    assert.match(data.message, /^Claude Sonnet 5\.5 cannot run here: none of the AI accounts you can use on this server serve it\. Models that can: GLM 5\.3, Kimi K3\./);
    assert.deepEqual(data.next.map((n) => n.key), ["pick_model", "run_on_my_computer"]);
  } finally { hostSeams.setEngineHost(null); }
});
