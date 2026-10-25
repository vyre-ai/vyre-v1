// The chat to engine bridge (P-L2_23a): a person's message reaches engine.receive under chat's own id, the agent's text and blocks come back as chat posts in order,
// a routine turn is labelled via, and the agent's own posts never loop back into the engine. Real SQLite for the engine tables, a small in-memory chat for the other side.
import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../handlers/bridge.ts";
import type { AgentPost, Bridge } from "../handlers/bridge.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_estate";
const LEAD = "agt_intake";
const WATCHER = "agt_watch";

interface ChatRow { messageId: string; threadId: string; threadSeq: number; author: { kind: string; id: string }; body: string; blocks: unknown[]; mentions: unknown[]; via?: { routineOwner: string }; depth: number }

function setup(opts: { agents?: Array<{ agentId: string; mode: "lead" | "listen"; watches?: string }>; script: readonly DriverEvent[] | ((i: TurnInput) => readonly DriverEvent[]) }) {
  const h = harness();
  const chat: ChatRow[] = [];
  const echoes: Array<{ id: string; result: unknown }> = [];
  const agents = opts.agents ?? [{ agentId: LEAD, mode: "lead" as const }];
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap: string, input: unknown) {
      const b = input as { threadId: string; messageId?: string };
      if (cap === "threads.get") return { thread: { threadId: T, kind: "chat", starter: "usr_dana", agents } };
      if (cap === "chat.message.get") return { message: chat.find((r) => r.messageId === b.messageId) };
      if (cap === "chat.messages.list") return { messages: chat.filter((r) => r.threadId === b.threadId), hasMore: false };
      return h.ctx.call(cap, input);
    },
  };
  let bridge: Bridge;
  const postAs = async (agentId: string, p: AgentPost): Promise<void> => {
    // chat.post as the agent: stored under the clientId, then message.received like any message
    const row: ChatRow = { messageId: p.clientId, threadId: p.threadId, threadSeq: chat.length + 1, author: { kind: "agent", id: agentId }, body: p.body, blocks: p.blocks, mentions: p.mentions, depth: 1, ...(p.via ? { via: p.via } : {}) };
    chat.push(row);
    const result = await bridge.onEvent(ctx, { name: "message.received", payload: { messageId: row.messageId, threadId: T, author: { kind: "agent", id: agentId }, mentions: p.mentions, depth: 1 } });
    echoes.push({ id: row.messageId, result });
  };
  bridge = createBridge({ postAs });
  const provider = scriptedProvider({ script: opts.script });
  const engine = h.runtime({ openSession: bridge.tap(provider.openSession), schedule: () => () => {} });
  bridge.attach(engine);
  /** A person writes in chat: stored there first, then the consumer runs on message.received. */
  async function say(body: string, mentions: Array<{ kind: "agent" | "person"; id: string }> = [], id = `msg_p${chat.length + 1}`) {
    chat.push({ messageId: id, threadId: T, threadSeq: chat.length + 1, author: { kind: "person", id: "usr_dana" }, body, blocks: [], mentions, depth: 0 });
    const result = await bridge.onEvent(ctx, { name: "message.received", payload: { messageId: id, threadId: T, author: { kind: "person", id: "usr_dana" }, mentions, depth: 0 } });
    if (result.receivedAs) await engine.idle(T);   // a skipped message opened no thread
    await bridge.flush();
    return { id, result };
  }
  return { h, chat, echoes, ctx, bridge, engine, provider, say };
}

const reply = (text: string): DriverEvent[] => [{ type: "text", text }, { type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "done" }];
const dbIds = (h: Harness): string[] => h.rows("SELECT id FROM engine_messages ORDER BY thread_seq").map((r) => String(r["id"]));

test("a person's message reaches engine.receive under chat's own id and the engine has nothing else to read", async () => {
  const s = setup({ script: reply("Done.") });
  const { id, result } = await s.say("Please draft the closing letter.");
  assert.deepEqual(result, { receivedAs: [LEAD] });
  assert.equal(s.engine.turns(T).length, 1);
  assert.equal(s.engine.turns(T)[0]?.state, "completed");
  assert.equal(s.provider.sessions[0]?.inputs[0]?.trigger?.id, id, "the turn's trigger is the chat message, same id");
  assert.equal(s.provider.sessions[0]?.inputs[0]?.trigger?.body, "Please draft the closing letter.");
  assert.equal(dbIds(s.h)[0], id, "engine_messages holds the chat id");
});

test("the agent's text and blocks come back as one chat post by the agent, text first, blocks in order", async () => {
  const s = setup({
    script: [
      { type: "text", text: "Looking." }, { type: "block", kind: "chart", payload: { n: 1 } }, { type: "text", text: " Found it." },
      { type: "block", kind: "table", payload: { n: 2 } }, { type: "done" },
    ],
  });
  await s.say("What did we file?");
  const posts = s.chat.filter((r) => r.author.id === LEAD);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.body, "Looking. Found it.");
  assert.deepEqual(posts[0]?.blocks, [{ type: "chart", v: 1, data: { n: 1 } }, { type: "table", v: 1, data: { n: 2 } }]);
  assert.equal(posts[0]?.via, undefined, "a person's turn carries no routine label");
});

test("posts go out in the order of the turns", async () => {
  let n = 0;
  const s = setup({ script: () => reply(`Answer ${++n}`) });
  await s.say("one");
  await s.say("two");
  await s.say("three");
  assert.deepEqual(s.chat.filter((r) => r.author.id === LEAD).map((r) => r.body), ["Answer 1", "Answer 2", "Answer 3"]);
  assert.deepEqual(s.chat.map((r) => r.threadSeq), [1, 2, 3, 4, 5, 6].slice(0, s.chat.length));
});

test("the agent's own post never loops back: one turn per person message, one row per message, ids shared with chat", async () => {
  const s = setup({ script: reply("Done.") });
  const { id } = await s.say("Hello");
  assert.equal(s.engine.turns(T).length, 1, "no second turn from the echo");
  const post = s.chat.find((r) => r.author.id === LEAD);
  assert.ok(post);
  assert.deepEqual(s.echoes.map((e) => e.result), [{ skipped: "known" }], "the echo is recognised by the engine's own row");
  assert.deepEqual(dbIds(s.h), [id, post.messageId], "engine_messages is chat's id list, nothing more");
  // a replay of the person's message (the consumer runs at least once) is not received twice
  const again = await s.bridge.onEvent(s.ctx, { name: "message.received", payload: { messageId: id, threadId: T, author: { kind: "person", id: "usr_dana" }, mentions: [], depth: 0 } });
  assert.deepEqual(again, { skipped: "known" });
  await s.engine.idle(T);
  assert.equal(s.engine.turns(T).length, 1);
});

test("a routine turn posts with via.routineOwner", async () => {
  const s = setup({ agents: [{ agentId: WATCHER, mode: "listen", watches: "channel" }], script: reply("Noted.") });
  await s.say("New filing arrived."); // no lead, nobody mentioned: the watcher acts unasked
  const post = s.chat.find((r) => r.author.id === WATCHER);
  assert.ok(post, "the watcher posted");
  assert.deepEqual(post.via, { routineOwner: "usr_dana" });
});

test("a turn with blocks and no text posts the blocks, and the bridge's own post is skipped by the consumer", async () => {
  const s = setup({ script: [{ type: "block", kind: "chart", payload: { n: 1 } }, { type: "done" }] });
  await s.say("Chart it");
  const post = s.chat.find((r) => r.author.id === LEAD);
  assert.ok(post);
  assert.equal(post.body, "");
  assert.deepEqual(post.blocks, [{ type: "chart", v: 1, data: { n: 1 } }]);
  assert.ok(post.messageId.startsWith("msg_brg"));
  assert.deepEqual(s.echoes.map((e) => e.result), [{ skipped: "own_post" }]);
  assert.equal(s.engine.turns(T).length, 1);
});

test("a failed turn becomes a status block in the chat", async () => {
  const s = setup({ script: [{ type: "error", code: "rate_limited", message: "slow down" }] });
  await s.say("Go");
  const post = s.chat.find((r) => r.author.id === LEAD);
  assert.ok(post);
  assert.deepEqual(post.blocks, [{ type: "turn_status", v: 1, data: { state: "failed", turnId: s.engine.turns(T)[0]?.id, code: "rate_limited" } }]);
});

test("an agent message the engine did not write is received like any other (an outside post)", async () => {
  const s = setup({ agents: [{ agentId: LEAD, mode: "lead" }, { agentId: "agt_docs", mode: "listen" }], script: reply("Seen.") });
  await s.say("hi");
  s.chat.push({ messageId: "msg_outside", threadId: T, threadSeq: 9, author: { kind: "agent", id: "agt_docs" }, body: "FYI", blocks: [], mentions: [], depth: 0 });
  const r = await s.bridge.onEvent(s.ctx, { name: "message.received", payload: { messageId: "msg_outside", threadId: T, author: { kind: "agent", id: "agt_docs" }, mentions: [], depth: 0 } });
  assert.deepEqual(r, { receivedAs: [LEAD] }, "no echo guard hides a message the engine never stored");
  await s.engine.idle(T);
  assert.ok(dbIds(s.h).includes("msg_outside"));
});

test("history is copied under chat ids when the thread first opens, and an edit reaches the mirror", async () => {
  const s = setup({ script: reply("ok") });
  s.chat.push({ messageId: "msg_old1", threadId: T, threadSeq: 1, author: { kind: "person", id: "usr_dana" }, body: "earlier", blocks: [], mentions: [], depth: 0 });
  const { id } = await s.say("now");
  assert.deepEqual(dbIds(s.h).slice(0, 2), ["msg_old1", id]);
  assert.equal(s.provider.sessions[0]?.inputs[0]?.history[0]?.body, "earlier");
  s.chat.find((r) => r.messageId === id)!.body = "now, corrected";
  await s.bridge.onEvent(s.ctx, { name: "message.edited", payload: { messageId: id, threadId: T } });
  assert.equal(s.h.rows("SELECT body FROM engine_messages WHERE id = ?", id)[0]?.["body"], "now, corrected");
});

test("a thread with no agents is left alone, and a host without an engine skips", async () => {
  const s = setup({ agents: [], script: reply("x") });
  const { result } = await s.say("anyone?");
  assert.deepEqual(result, { skipped: "no_agents" });
  assert.equal(s.h.rows("SELECT id FROM engine_messages").length, 0);
  const bare = createBridge({ postAs: async () => {} });
  assert.deepEqual(await bare.onEvent(s.ctx, { name: "message.received", payload: { messageId: "msg_x", threadId: T } }), { skipped: "engine_not_running" });
});
