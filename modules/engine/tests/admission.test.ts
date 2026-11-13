// The engine's admission (runtime.ts admission): before a turn runs, the agents module is asked about the agent as the person the turn is for. A paused or deleted agent takes no turn, and nothing
// runs for a person who may no longer ask: the call made as them is refused (removed or suspended), which before let the turn through ("if it cannot answer, the turn goes on"). A status that
// cannot be read at all fails closed. Recovered turns after a restart go through the same door, so a removed person's queued turn never runs.
// @reads /modules/engine/migrations/0001_init.sql
// @reads /modules/engine/migrations/0003_unblock.sql
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, hostSeams } from "../impl.ts";
import { bindEngine } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_admit";
const AGENT = "agt_desk";
const reply: DriverEvent[] = [
  { type: "text", text: "Hello." },
  { type: "usage", inputTokens: 5, outputTokens: 2 },
  { type: "done" },
];

async function turnFor(status: () => unknown): Promise<{ ran: number; failed: Array<{ code?: string }> }> {
  bindEngine(null);
  const h = harness({
    threads: [{ threadId: T, kind: "chat", starter: "usr_tess", agents: [{ agentId: AGENT, mode: "lead" as const }] }],
  });
  const provider = scriptedProvider({ script: reply });
  const chat = [
    {
      messageId: "msg_1",
      threadId: T,
      threadSeq: 1,
      author: { kind: "person", id: "usr_tess" },
      body: "hello",
      blocks: [],
      mentions: [{ kind: "agent", id: AGENT }],
      depth: 0,
    },
  ];
  const read = (cap: string, input: unknown): unknown => {
    const b = input as { messageId?: string };
    if (cap === "threads.get")
      return { thread: { threadId: T, kind: "chat", starter: "usr_tess", agents: [{ agentId: AGENT, mode: "lead" }] } };
    if (cap === "agents.get") throw new Error("no such agent");
    if (cap === "chat.message.get") return { message: chat.find((r) => r.messageId === b.messageId) };
    if (cap === "chat.messages.list") return { messages: chat, hasMore: false };
    return undefined;
  };
  const failed: Array<{ code?: string }> = [];
  hostSeams.setEngineHost({
    holder: "host:spc_admit",
    openSession: provider.openSession,
    now: () => 1_760_000_000_000,
    async call(cap, input) {
      const r = read(cap, input);
      if (r !== undefined) return r;
      if (cap === "agents.status") return status();
      if (cap === "engine.account.resolve")
        return {
          accountRef: "#Tess_Anthropic",
          payer: "usr_tess",
          reason: "starter",
          allowed: true,
          itemId: "vit_aaaaaaaaaaaa",
        };
      if (cap === "engine.accounts.list")
        return { accounts: [{ ref: "#Tess_Anthropic", driver: "claude_code", kind: "subscription" }] };
      if (cap === "engine.turn.record_usage" || cap === "engine.turn.record") {
        const i = input as { phase?: string; error?: { code?: string } };
        if (i.error) failed.push(i.error);
        return {};
      }
      return {};
    },
    postAs: async () => undefined,
  });
  try {
    const ctx: EngineCtx = {
      ...h.ctx,
      async call(cap: string, input: unknown) {
        return read(cap, input) ?? h.ctx.call(cap, input);
      },
    };
    const run = consumers["engine.bridge"].run as (
      ctx: EngineCtx,
      event: { name: string; payload: Record<string, unknown> },
    ) => Promise<unknown>;
    await run(ctx, {
      name: "message.received",
      payload: {
        messageId: "msg_1",
        threadId: T,
        author: { kind: "person", id: "usr_tess" },
        mentions: [{ kind: "agent", id: AGENT }],
        depth: 0,
      },
    });
    await new Promise((done) => setTimeout(done, 300));
    return { ran: provider.specs.length, failed };
  } finally {
    hostSeams.setEngineHost(null);
  }
}

test("an active agent, asked about as an active person: the turn runs", async () => {
  assert.equal((await turnFor(() => ({ status: "awake" }))).ran, 1);
});

test("the person the turn is for was removed or suspended (the call made as them is refused): the turn does not run", async () => {
  // the kernel answers every call of a principal who is not active (removed or suspended) with "suspended" (kernel/src/authorize/index.ts); one it does not know is not a member
  for (const code of ["permission.suspended", "auth.unauthenticated"] as const) {
    const r = await turnFor(() => {
      throw fail(code, "0".repeat(32));
    });
    assert.equal(r.ran, 0, `${code}: no model call for a person who may no longer ask`);
  }
});

test("a refusal about the agent itself (the person may not see it, a chat with someone else's own agent): the turn goes on, as before", async () => {
  assert.equal(
    (
      await turnFor(() => {
        throw fail("permission.not_found", "0".repeat(32));
      })
    ).ran,
    1,
  );
});

test("the agent's status cannot be read at all: the turn does not run (fails closed)", async () => {
  const r = await turnFor(() => {
    throw new Error("the agents module did not answer");
  });
  assert.equal(r.ran, 0);
});

test("a paused agent and a deleted one take no turn, as before", async () => {
  assert.equal((await turnFor(() => ({ status: "paused", reason: "Paused" }))).ran, 0);
  assert.equal(
    (
      await turnFor(() => {
        throw fail("validation.not_found", "0".repeat(32));
      })
    ).ran,
    0,
  );
});
