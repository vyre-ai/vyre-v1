// Agents reply in the thread under the asking message (lane l-threadreplies): in a project or channel main chat with the switch on, the person's ask stays in the chat and the agent's turn runs and posts
// in the inline thread under it (made if it is not there). With the switch off, in a direct chat, or when the ask is made inside a thread, the reply lands where the ask was made. Real SQLite for the engine
// tables, a small in-memory chat for the other side, a scripted engine.
import test from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../handlers/bridge.ts";
import type { AgentPost, Bridge } from "../handlers/bridge.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { toolRunnerFrom } from "../../../agent/src/turn-engine/tools.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";
import type { EngineCtx } from "../projections.ts";

const MAIN = "thr_project";
const LEAD = "agt_intake";

interface Row { messageId: string; threadId: string; threadSeq: number; author: { kind: string; id: string }; body: string; blocks: unknown[]; mentions: unknown[]; depth: number }
const reply = (text: string): DriverEvent[] => [{ type: "text", text }, { type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "done" }];

function setup(o: { kind?: string; on?: boolean; script?: DriverEvent[]; held?: boolean; agents?: Array<{ agentId: string; mode: "lead" | "listen" }> }) {
  const h = harness();
  const chat: Row[] = [];
  const made: Array<{ threadId: string; messageId: string }> = [];
  const asks: Array<{ threadId: string; messageId: string }> = [];
  const threads = new Map<string, string>();   // asking message -> its thread
  const agents = o.agents ?? [{ agentId: LEAD, mode: "lead" as const }];
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap: string, input: unknown) {
      const b = input as { threadId: string; messageId?: string };
      if (cap === "gate.grants.ask") { asks.push(input as (typeof asks)[number]); return { ok: true }; }
      if (cap === "threads.get") {
        if (b.threadId === MAIN) return { thread: { threadId: MAIN, kind: o.kind ?? "channel", starter: "usr_dana", agents, agentRepliesInThreads: o.on ?? true } };
        return { thread: { threadId: b.threadId, kind: "thread", parentThreadId: MAIN, starter: "usr_dana", agents } };
      }
      if (cap === "agents.get") throw new Error("no such agent");
      if (cap === "chat.thread") {
        made.push(b as { threadId: string; messageId: string });
        const id = threads.get(b.messageId!) ?? `thr_under_${b.messageId}`;
        threads.set(b.messageId!, id);
        return { thread: { threadId: id } };
      }
      if (cap === "chat.message.get") return { message: chat.find((r) => r.messageId === b.messageId && r.threadId === b.threadId) };
      if (cap === "chat.messages.list") return { messages: chat.filter((r) => r.threadId === b.threadId), hasMore: false };
      return h.ctx.call(cap, input);
    },
  };
  let bridge: Bridge;
  const postAs = async (agentId: string, p: AgentPost): Promise<void> => {
    const row: Row = { messageId: p.clientId, threadId: p.threadId, threadSeq: chat.length + 1, author: { kind: "agent", id: agentId }, body: p.body, blocks: p.blocks, mentions: p.mentions, depth: 1 };
    chat.push(row);
    await bridge.onEvent(ctx, { name: "message.received", payload: { messageId: row.messageId, threadId: p.threadId, author: { kind: "agent", id: agentId }, mentions: p.mentions, depth: 1 } });
  };
  bridge = createBridge({ postAs });
  const provider = scriptedProvider({ script: o.script ?? reply("Done.") });
  const open = bridge.tap(provider.openSession);
  const held = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_gate1" }));
  const engine = h.runtime({ openSession: (spec) => open(spec), schedule: () => () => {}, ...(o.held ? { callTool: held } : {}) });
  bridge.attach(engine);
  async function say(body: string, where = MAIN, mentions: Array<{ kind: "agent" | "person"; id: string }> = [], id = `msg_p${chat.length + 1}`) {
    chat.push({ messageId: id, threadId: where, threadSeq: chat.length + 1, author: { kind: "person", id: "usr_dana" }, body, blocks: [], mentions, depth: 0 });
    const result = await bridge.onEvent(ctx, { name: "message.received", payload: { messageId: id, threadId: where, author: { kind: "person", id: "usr_dana" }, mentions, depth: 0, typed: true } });
    if (result.receivedAs) for (const t of new Set([where, ...threads.values()])) { try { await engine.idle(t); } catch { /* not open here */ } }
    await bridge.flush();
    return { id, result };
  }
  return { chat, made, asks, say, engine, bridge };
}

const agentPosts = (s: ReturnType<typeof setup>) => s.chat.filter((r) => r.author.kind === "agent");

test("in a project chat with the switch on, the agent's reply lands in the thread under the ask and the chat keeps only the ask", async () => {
  const s = setup({ script: reply("Harbor looks best.") });
  const { id, result } = await s.say("Compare the two quotes.");
  assert.deepEqual(result, { receivedAs: [LEAD] });
  assert.deepEqual(s.made, [{ threadId: MAIN, messageId: id }], "the thread under the ask was made");
  const posts = agentPosts(s);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.threadId, `thr_under_${id}`, "the reply is in the thread");
  assert.equal(posts[0]!.body, "Harbor looks best.");
  assert.equal(s.chat.filter((r) => r.threadId === MAIN).length, 1, "the main chat holds the ask and nothing else");
  assert.ok(s.asks.some((a) => a.threadId === `thr_under_${id}`), "what the person asked opens its acts in the thread where the turn runs");
});

test("a channel behaves the same: the reply goes to the thread of the message that asked", async () => {
  const s = setup({ kind: "channel" });
  const { id } = await s.say("Who owns the Rivera file?");
  assert.equal(agentPosts(s)[0]!.threadId, `thr_under_${id}`);
});

test("a second ask gets its own thread; the first thread is left alone", async () => {
  const s = setup({});
  const a = await s.say("First question.");
  const b = await s.say("Second question.");
  const where = agentPosts(s).map((r) => r.threadId);
  assert.deepEqual(where, [`thr_under_${a.id}`, `thr_under_${b.id}`]);
});

test("with the switch off the reply stays in the chat and no thread is made", async () => {
  const s = setup({ on: false });
  await s.say("Compare the two quotes.");
  assert.equal(s.made.length, 0);
  assert.equal(agentPosts(s)[0]!.threadId, MAIN);
});

test("a direct chat stays inline", async () => {
  const s = setup({ kind: "chat", on: true });
  await s.say("Hello.");
  assert.equal(s.made.length, 0);
  assert.equal(agentPosts(s)[0]!.threadId, MAIN);
});

test("people talking to each other, with nobody asking an agent, make no thread", async () => {
  const s = setup({ agents: [{ agentId: LEAD, mode: "listen" }] });
  const { result } = await s.say("Lunch at noon?");
  assert.equal(s.made.length, 0, "no thread is made for a message no agent answers");
  assert.equal(result.receivedAs?.length ?? 0, 0);
  assert.equal(agentPosts(s).length, 0);
});

test("an ask made inside a thread is answered in that thread", async () => {
  const s = setup({});
  const { id } = await s.say("Compare the two quotes.");
  const thread = `thr_under_${id}`;
  await s.say("Without tax, please.", thread);
  assert.equal(s.made.length, 1, "no second thread under a reply in a thread");
  assert.deepEqual(agentPosts(s).map((r) => r.threadId), [thread, thread]);
});

test("a person's @mention of a listening agent in the chat is answered in the thread too", async () => {
  const s = setup({ agents: [{ agentId: LEAD, mode: "listen" }] });
  const { id } = await s.say("@Intake what is due?", MAIN, [{ kind: "agent", id: LEAD }]);
  assert.equal(agentPosts(s)[0]!.threadId, `thr_under_${id}`);
});

test("an approval asked in the thread rises to the chat as one quiet line that opens the thread; the thread keeps the card", async () => {
  const s = setup({ held: true, script: [{ type: "text", text: "Booking." }, { type: "tool_call", id: "call_1", name: "mail_send", input: { to: "pat@acme.test" } }, { type: "done" }] });
  const { id } = await s.say("Book the vendor call.");
  const thread = `thr_under_${id}`;
  const inThread = agentPosts(s).filter((r) => r.threadId === thread);
  assert.ok(inThread.some((r) => JSON.stringify(r.blocks).includes('"waiting"')), "the thread holds the waiting turn");
  const quiet = s.chat.filter((r) => r.threadId === MAIN && r.author.kind === "agent");
  assert.equal(quiet.length, 1, "one line in the chat");
  const blocks = JSON.stringify(quiet[0]!.blocks);
  assert.match(blocks, /needs your OK/);
  assert.ok(blocks.includes(thread), "and it names the thread it opens");
  assert.equal(quiet[0]!.body, "", "no words of the work come to the chat");
});
