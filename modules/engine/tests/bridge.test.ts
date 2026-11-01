// The chat to engine bridge (P-L2_23a): a person's message reaches engine.receive under chat's own id, the agent's text and blocks come back as chat posts in order,
// a routine turn is labelled via, and the agent's own posts never loop back into the engine. Real SQLite for the engine tables, a small in-memory chat for the other side.
import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../handlers/bridge.ts";
import type { AgentPost, Bridge, StreamEvent } from "../handlers/bridge.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_estate";
const LEAD = "agt_intake";
const WATCHER = "agt_watch";

interface ChatRow { messageId: string; threadId: string; threadSeq: number; author: { kind: string; id: string }; body: string; blocks: unknown[]; mentions: unknown[]; via?: { routineOwner: string }; depth: number; attachments?: string[] }

function setup(opts: { agentModel?: string; stream?: (e: StreamEvent) => void; addressAsker?: (threadId: string, agentId: string) => boolean; agents?: Array<{ agentId: string; mode: "lead" | "listen"; watches?: string }>; script: readonly DriverEvent[] | ((i: TurnInput) => readonly DriverEvent[]) }) {
  const h = harness();
  const chat: ChatRow[] = [];
  const echoes: Array<{ id: string; result: unknown }> = [];
  const agents = opts.agents ?? [{ agentId: LEAD, mode: "lead" as const }];
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap: string, input: unknown) {
      const b = input as { threadId: string; messageId?: string; fileId?: string };
      if (cap === "threads.get") return { thread: { threadId: T, kind: "chat", starter: "usr_dana", agents } };
      if (cap === "agents.get") { if (!opts.agentModel) throw new Error("no such agent"); return { agent: { agentId: LEAD, model: opts.agentModel } }; }
      if (cap === "chat.message.get") return { message: chat.find((r) => r.messageId === b.messageId) };
      if (cap === "files.get") { if (b.fileId === "fil_gone") throw new Error("not found"); return { file: { fileId: b.fileId, name: b.fileId === "fil_1" ? "brief.docx" : "other.pdf" } }; }
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
  bridge = createBridge({ postAs, ...(opts.stream ? { stream: opts.stream } : {}), ...(opts.addressAsker ? { addressAsker: opts.addressAsker } : {}) });
  const provider = scriptedProvider({ script: opts.script });
  const engine = h.runtime({ openSession: bridge.tap(provider.openSession), schedule: () => () => {} });
  bridge.attach(engine);
  /** A person writes in chat: stored there first, then the consumer runs on message.received. */
  async function say(body: string, mentions: Array<{ kind: "agent" | "person"; id: string }> = [], id = `msg_p${chat.length + 1}`, extra: { attachments?: string[]; blocks?: unknown[] } = {}) {
    chat.push({ messageId: id, threadId: T, threadSeq: chat.length + 1, author: { kind: "person", id: "usr_dana" }, body, blocks: extra.blocks ?? [], mentions, depth: 0, ...(extra.attachments ? { attachments: extra.attachments } : {}) });
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

test("a missing engine and an unreadable Vault carry what the chat needs to say precisely: the program, the Vault's own code, nothing else", async () => {
  const missing = setup({ script: [{ type: "error", code: "engine.cli_missing", message: "codex is not installed on this computer." }] });
  await missing.say("Go");
  assert.deepEqual(missing.chat.find((r) => r.author.id === LEAD)?.blocks, [{ type: "turn_status", v: 1, data: { state: "failed", turnId: missing.engine.turns(T)[0]?.id, code: "engine.cli_missing", program: "codex" } }]);
  const free = setup({ script: [{ type: "error", code: "engine.cli_missing", message: "rm -rf is not installed" }] });
  await free.say("Go");
  assert.equal((free.chat.find((r) => r.author.id === LEAD)?.blocks[0] as { data: Record<string, unknown> }).data["program"], undefined, "only the engines are named");
  const vault = setup({ script: [{ type: "error", code: "engine.vault_unreadable", message: "The Vault could not be read (provider.unavailable)." }] });
  await vault.say("Go");
  assert.equal((vault.chat.find((r) => r.author.id === LEAD)?.blocks[0] as { data: Record<string, unknown> }).data["reason"], "provider.unavailable");
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

test("a reply that is addressed to the asker (a reviewer's verdict) carries an @mention of the person, so no agent answers it", async () => {
  const s = setup({ script: reply("Approved."), addressAsker: (_t, agent) => agent === LEAD });
  await s.say("check this");
  assert.deepEqual(s.chat.at(-1)?.mentions, [{ kind: "person", id: "usr_dana" }]);
  assert.equal(s.engine.messages(T).filter((m) => m.author.kind === "agent").at(-1)?.mentions.some((m) => m.kind === "person"), true, "the engine routes the reply with the mention, so the lead does not answer it");
  const plain = setup({ script: reply("Done.") });
  await plain.say("do this");
  assert.deepEqual(plain.chat.at(-1)?.mentions, []);
});

test("a live turn streams start, each piece of text, end, then the message it became, in that order", async () => {
  const seen: StreamEvent[] = [];
  const s = setup({ stream: (e) => seen.push(e), script: [{ type: "text", text: "Hel" }, { type: "text", text: "lo." }, { type: "usage", inputTokens: 1, outputTokens: 1 }, { type: "done" }] });
  await s.say("hi");
  const post = s.chat.find((r) => r.author.id === LEAD);
  assert.deepEqual(seen.map((e) => e.kind), ["start", "delta", "delta", "end", "final"]);
  assert.deepEqual(seen.filter((e) => e.kind === "delta").map((e) => (e as { text: string }).text), ["Hel", "lo."]);
  assert.equal(new Set(seen.map((e) => e.turnId)).size, 1, "one turn id on every event");
  const last = seen[seen.length - 1] as Extract<StreamEvent, { kind: "final" }>;
  assert.equal(last.messageId, post?.messageId, "the final event names the chat message the turn became");
  assert.equal(seen.every((e) => e.threadId === T && e.agentId === LEAD), true);
});

test("a stream listener that throws never fails the turn or the post", async () => {
  const s = setup({ stream: () => { throw new Error("socket gone"); }, script: reply("Fine.") });
  await s.say("hi");
  assert.equal(s.engine.turns(T)[0]?.state, "completed");
  assert.equal(s.chat.filter((r) => r.author.id === LEAD).length, 1);
});

test("a failed turn ends the stream as failed and its final names the status post", async () => {
  const seen: StreamEvent[] = [];
  const s = setup({ stream: (e) => seen.push(e), script: [{ type: "text", text: "Part" }, { type: "error", code: "provider.down", message: "boom", retryable: false }] });
  await s.say("hi");
  const end = seen.find((e) => e.kind === "end") as Extract<StreamEvent, { kind: "end" }> | undefined;
  assert.equal(end?.state, "failed");
  const fin = seen[seen.length - 1] as Extract<StreamEvent, { kind: "final" }>;
  assert.equal(fin.kind, "final");
  assert.equal(fin.messageId, s.chat.find((r) => r.author.id === LEAD)?.messageId);
});

test("the agent is told which files and links came with a message, by name, and chat keeps the words as typed", async () => {
  const s = setup({ script: reply("Read it.") });
  const refs = { id: "blk_r", type: "refs", v: 1, state: "done", data: { refs: [{ kind: "record", id: "rec_2", title: "Rivera Holdings" }] } };
  const { id } = await s.say("Please summarise", [], "msg_pf", { attachments: ["fil_1", "fil_gone"], blocks: [refs] });
  const seen = s.provider.sessions[0]?.inputs[0]?.trigger?.body ?? "";
  assert.equal(seen, "Please summarise\n\n[Attached: brief.docx (file fil_1)]\n[Attached: file fil_gone]\n[Linked: Rivera Holdings (record rec_2)]");
  assert.equal(s.chat.find((r) => r.messageId === id)?.body, "Please summarise");
});

test("a message with nothing attached reaches the agent exactly as typed", async () => {
  const s = setup({ script: reply("Ok.") });
  await s.say("Just words");
  assert.equal(s.provider.sessions[0]?.inputs[0]?.trigger?.body, "Just words");
});

test("a chat that pins no model runs on the agent's own model, so the turn and its usage name it", async () => {
  const s = setup({ agentModel: "claude-haiku-5-5", script: reply("Hi.") });
  await s.say("Hello");
  assert.equal(s.engine.turns(T)[0]?.model, "claude-haiku-5-5");
  const none = setup({ script: reply("Hi.") });
  await none.say("Hello");
  assert.equal(none.engine.turns(T)[0]?.model ?? null, null, "an agent with no model of its own leaves the turn unpinned");
});
