// Where agents reply (lane l-threadreplies): threads.set_agent_replies, its default by kind of chat, who may change it, and the agents of a chat being in the thread under a message.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, DRAFTER, INTAKE, MAYA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const channelOf = async (hn: Harness) => (await h["channels.create"]!(hn.ctx, { name: `room${++n}`, visibility: "public", agentIds: [INTAKE], idempotencyKey: `r${n}` })).channel.mainThreadId as string;
const chatOf = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `d${++n}` })).thread.threadId as string;
const say = async (hn: Harness, threadId: string, body: string) => (await h["chat.post"]!(hn.ctx, { threadId, body, idempotencyKey: `p${++n}` })).message.messageId as string;

test("agents reply in threads by default in a channel and not in a direct chat", async () => {
  const hn = harness();
  assert.equal((await h["threads.get"]!(hn.ctx, { threadId: await channelOf(hn) })).thread.agentRepliesInThreads, true);
  assert.equal((await h["threads.get"]!(hn.ctx, { threadId: await chatOf(hn) })).thread.agentRepliesInThreads, false);
});

test("agents reply in threads only in a channel (a project's main chat is its channel): a group chat, a chat about a record, a task chat and a direct chat stay inline", async () => {
  const hn = harness();
  const on = async (id: string) => (await h["threads.get"]!(hn.ctx, { threadId: id })).thread.agentRepliesInThreads;
  const project = (await h["channels.create"]!(hn.ctx, { name: "Rivera project", visibility: "public", agentIds: [INTAKE], recordId: "rec_project1", idempotencyKey: `pj${++n}` })).channel.mainThreadId as string;
  assert.equal(await on(project), true, "a project's channel");
  assert.equal(await on(await channelOf(hn)), true, "a channel");
  assert.equal(await on(await chatOf(hn)), false, "a direct chat");
  const group = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], personId: MAYA, idempotencyKey: `g${++n}` })).thread.threadId as string;
  assert.equal(await on(group), false, "a group chat");
  const aboutRecord = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], recordId: "rec_project1", idempotencyKey: `r${++n}` })).thread.threadId as string;
  assert.equal(await on(aboutRecord), false, "a chat about a record");
  const task = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], scopeType: "task", scopeId: "tsk_abc", idempotencyKey: `t${++n}` })).thread;
  assert.equal(task.agentRepliesInThreads, undefined, "a task's thread has no such choice at all");
  const ask = (await h["chat.start"]!(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "record", scopeId: "rec_1", idempotencyKey: `a${++n}` })).thread;
  assert.equal(ask.agentRepliesInThreads, undefined, "an Ask pane has none either");
});

test("threads.set_agent_replies stores the choice, answers with the thread and says what changed", async () => {
  const hn = harness();
  const id = await channelOf(hn);
  hn.clear();
  const off = await h["threads.set_agent_replies"]!(hn.ctx, { threadId: id, inThreads: false });
  assert.equal(off.thread.agentRepliesInThreads, false);
  assert.deepEqual(contractErrors("threads.set_agent_replies", "out", off), []);
  assert.deepEqual(hn.named("thread.updated")[0]!.payload, { threadId: id, fields: ["repliesIn"] });
  assert.equal((await h["threads.get"]!(hn.ctx, { threadId: id })).thread.agentRepliesInThreads, false, "it stays off");
  assert.equal((await h["threads.set_agent_replies"]!(hn.ctx, { threadId: id, inThreads: true })).thread.agentRepliesInThreads, true);
  const dm = await chatOf(hn);
  assert.equal((await h["threads.set_agent_replies"]!(hn.ctx, { threadId: dm, inThreads: true })).thread.agentRepliesInThreads, true, "a direct chat can turn it on");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("only someone in the chat changes it, and a thread has no such choice", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  assert.equal(await failure(() => h["threads.set_agent_replies"]!(hn.person(MAYA), { threadId: id, inThreads: false })), "validation.not_found");
  const m = await say(hn, id, "hello");
  const th = (await h["chat.thread"]!(hn.ctx, { threadId: id, messageId: m })).thread.threadId as string;
  assert.equal(await failure(() => h["threads.set_agent_replies"]!(hn.ctx, { threadId: th, inThreads: true })), "validation.bad_input");
  assert.equal(await failure(() => h["threads.set_agent_replies"]!(hn.ctx, { threadId: id, inThreads: "yes" })), "validation.bad_input");
});

test("with the switch on, the agents of the chat are in the thread under a message; with it off they are not", async () => {
  const hn = harness();
  const id = await channelOf(hn);
  await h["threads.add_agent"]?.(hn.ctx, { threadId: id, agentId: DRAFTER, mode: "listen" }).catch(() => undefined);
  const on = (await h["chat.thread"]!(hn.ctx, { threadId: id, messageId: await say(hn, id, "ask") })).thread;
  assert.ok(on.agents.some((a: any) => a.agentId === INTAKE), "the channel's agent answers in the thread");
  await h["threads.set_agent_replies"]!(hn.ctx, { threadId: id, inThreads: false });
  const off = (await h["chat.thread"]!(hn.ctx, { threadId: id, messageId: await say(hn, id, "ask again") })).thread;
  assert.equal(off.agents.length, 0, "no agent in a thread of a chat that keeps replies inline");
});

test("the thread row says how many replies it has and when the last came, for the footer under the ask", async () => {
  const hn = harness();
  const id = await channelOf(hn);
  const m = await say(hn, id, "ask");
  const th = (await h["chat.thread"]!(hn.ctx, { threadId: id, messageId: m })).thread.threadId as string;
  assert.equal((await h["threads.get"]!(hn.ctx, { threadId: th })).thread.replyCount, 0);
  await say(hn, th, "a reply");
  const row = (await h["threads.get"]!(hn.ctx, { threadId: th })).thread;
  assert.equal(row.replyCount, 1);
  assert.equal(typeof row.lastMessageAt, "number");
  assert.equal(row.parentMessageId, m);
});

test("Also post to the chat from a thread copies the words to the chat with a from_thread block", async () => {
  const hn = harness();
  const id = await channelOf(hn);
  const th = (await h["chat.thread"]!(hn.ctx, { threadId: id, messageId: await say(hn, id, "ask") })).thread.threadId as string;
  await h["chat.post"]!(hn.ctx, { threadId: th, body: "Decision: Thursday 14:00.", alsoToChat: true, idempotencyKey: `x${++n}` });
  const main = hn.rows("SELECT body, blocks FROM chat_message WHERE thread = ? ORDER BY threadSeq", id);
  assert.equal(main.length, 2);
  assert.equal(main[1]!["body"], "Decision: Thursday 14:00.");
  assert.match(String(main[1]!["blocks"]), /from_thread/);
});
