// A message that arrives before the engine runtime exists still gets its turn. The runtime is built by the first engine call and by a periodic job, so the first message after a server restart used to find
// no engine and be skipped ("engine_not_running") with no turn and no failure shown. The bridge consumer now builds the runtime first.
// @reads /modules/engine/migrations/0001_init.sql
// @reads /modules/engine/migrations/0003_unblock.sql
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, hostSeams } from "../impl.ts";
import { bindEngine } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineCtx } from "../projections.ts";
import type { EngineHostSeam } from "../runtime.ts";

const T = "thr_boot";
const AGENT = "agt_intake";
const reply: DriverEvent[] = [{ type: "text", text: "Hello." }, { type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "done" }];

test("the first message after a restart, with no engine call before it, runs a turn: the bridge consumer builds the runtime", async () => {
  bindEngine(null);
  const h = harness({ threads: [{ threadId: T, kind: "chat", starter: "usr_dana", agents: [{ agentId: AGENT, mode: "lead" as const }] }] });
  const provider = scriptedProvider({ script: reply });
  const posts: string[] = [];
  const chat = [{ messageId: "msg_1", threadId: T, threadSeq: 1, author: { kind: "person", id: "usr_dana" }, body: "hello", blocks: [], mentions: [{ kind: "agent", id: AGENT }], depth: 0 }];
  const readChat = (cap: string, input: unknown): unknown => {
    const b = input as { messageId?: string };
    if (cap === "threads.get") return { thread: { threadId: T, kind: "chat", starter: "usr_dana", agents: [{ agentId: AGENT, mode: "lead" }] } };
    if (cap === "agents.get") throw new Error("no such agent");
    if (cap === "chat.message.get") return { message: chat.find((r) => r.messageId === b.messageId) };
    if (cap === "chat.messages.list") return { messages: chat, hasMore: false };
    return undefined;
  };
  const host: EngineHostSeam = {
    holder: "host:spc_boot", openSession: provider.openSession, now: () => 1_760_000_000_000,
    async call(cap, input) {
      const read = readChat(cap, input);
      if (read !== undefined) return read;
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Anthropic", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Anthropic", driver: "claude_code", kind: "subscription" }] };
      if (cap === "engine.turn.record_usage" || cap === "engine.turn.record") return {};
      throw new Error(`unexpected ${cap}`);
    },
    postAs: async (_agent, p) => { posts.push(p.body); },
  };
  hostSeams.setEngineHost(host);
  try {
    const ctx: EngineCtx = { ...h.ctx, async call(cap: string, input: unknown) { return readChat(cap, input) ?? h.ctx.call(cap, input); } };
    // no engine capability has run and no periodic pass has happened: the runtime does not exist yet
    const run = consumers["engine.bridge"].run as (ctx: EngineCtx, event: { name: string; payload: Record<string, unknown> }) => Promise<{ skipped?: string; receivedAs?: string[] }>;
    const res = await run(ctx, { name: "message.received", payload: { messageId: "msg_1", threadId: T, author: { kind: "person", id: "usr_dana" }, mentions: [{ kind: "agent", id: AGENT }], depth: 0 } });
    assert.equal(res.skipped, undefined, "the message was not skipped for want of an engine");
    assert.deepEqual(res.receivedAs, [AGENT]);
    for (let i = 0; i < 100 && provider.specs.length === 0; i++) await new Promise((done) => setTimeout(done, 20));
    assert.equal(provider.specs.length, 1, "the agent's turn ran");
  } finally { hostSeams.setEngineHost(null); }
});

test("whoever posts, the owner, a member or a hook (an agent), the bridge consumer builds the runtime: it does not depend on the poster's own engine call", async () => {
  for (const author of [{ kind: "person", id: "usr_owner" }, { kind: "person", id: "usr_member" }, { kind: "agent", id: "agt_other" }]) {
    bindEngine(null);
    const h = harness({ threads: [{ threadId: T, kind: "chat", starter: "usr_owner", agents: [{ agentId: AGENT, mode: "lead" as const }] }] });
    const provider = scriptedProvider({ script: reply });
    const chat = [{ messageId: "msg_9", threadId: T, threadSeq: 1, author, body: "hello", blocks: [], mentions: [{ kind: "agent", id: AGENT }], depth: author.kind === "agent" ? 1 : 0 }];
    const read = (cap: string, input: unknown): unknown => {
      const b = input as { messageId?: string };
      if (cap === "threads.get") return { thread: { threadId: T, kind: "chat", starter: "usr_owner", agents: [{ agentId: AGENT, mode: "lead" }] } };
      if (cap === "agents.get") throw new Error("no such agent");
      if (cap === "chat.message.get") return { message: chat.find((r) => r.messageId === b.messageId) };
      if (cap === "chat.messages.list") return { messages: chat, hasMore: false };
      return undefined;
    };
    hostSeams.setEngineHost({
      holder: "host:spc_boot", openSession: provider.openSession, now: () => 1_760_000_000_000,
      async call(cap, input) {
        const r = read(cap, input); if (r !== undefined) return r;
        if (cap === "engine.account.resolve") return { accountRef: "#Owner_Anthropic", payer: "usr_owner", reason: "starter", allowed: true, itemId: "vit_aaaaaaaaaaaa" };
        if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Owner_Anthropic", driver: "claude_code", kind: "subscription" }] };
        if (cap === "engine.turn.record_usage" || cap === "engine.turn.record") return {};
        throw new Error(`unexpected ${cap}`);
      },
      postAs: async () => undefined,
    });
    try {
      const ctx: EngineCtx = { ...h.ctx, async call(cap: string, input: unknown) { return read(cap, input) ?? h.ctx.call(cap, input); } };
      const run = consumers["engine.bridge"].run as (ctx: EngineCtx, event: { name: string; payload: Record<string, unknown> }) => Promise<{ skipped?: string; receivedAs?: string[] }>;
      const res = await run(ctx, { name: "message.received", payload: { messageId: "msg_9", threadId: T, author, mentions: [{ kind: "agent", id: AGENT }], depth: author.kind === "agent" ? 1 : 0 } });
      assert.equal(res.skipped, undefined, `${author.id}: not skipped for want of an engine`);
      for (let i = 0; i < 100 && provider.specs.length === 0; i++) await new Promise((done) => setTimeout(done, 20));
      assert.equal(provider.specs.length, 1, `${author.id}: the agent's turn ran`);
    } finally { hostSeams.setEngineHost(null); }
  }
});
