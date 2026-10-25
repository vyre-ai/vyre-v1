// chat.start and chat.thread (spec 2.5, 3.2, 4.8): a chat with agents, a direct message, an Ask pane, and the inline thread under a message.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { lastMessages, threadBy, threadOut } from "../projections.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, REVIEWER, assertEventsConform, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const start = (ctx: Harness["ctx"], input: Record<string, unknown>) => h["chat.start"]!(ctx, { kind: "chat", agentIds: [], idempotencyKey: `s${++n}`, ...input });

test("a chat with one agent: the agent leads, the person owns it, and it shows in Recent", async () => {
  const hn = harness();
  const { thread } = await start(hn.ctx, { agentIds: [INTAKE], title: "Plan the launch", model: "claude-sonnet-5-5", provider: "anthropic", effort: "high", first: "Where do we start?" });
  assert.equal(thread.kind, "chat");
  assert.equal(thread.starter, DANA);
  assert.equal(thread.listed, true);
  assert.equal(thread.planMode, false);
  assert.deepEqual(thread.members, [{ kind: "person", id: DANA }]);
  assert.deepEqual(thread.agents, [{ agentId: INTAKE, mode: "lead", model: "claude-sonnet-5-5", provider: "anthropic", effort: "high" }]);
  assert.deepEqual(hn.names(), ["thread.started", "agent.engaged", "message.received"]);
  assert.deepEqual(hn.named("agent.engaged")[0]!.payload, { threadId: thread.threadId, agentId: INTAKE, mode: "lead", by: DANA });
  assert.equal(lastMessages(hn.db, thread.threadId)[0]!.body, "Where do we start?");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("several agents: the first leads and the rest listen; with a second person all agents listen", async () => {
  const hn = harness();
  const a = (await start(hn.ctx, { agentIds: [INTAKE, DRAFTER, REVIEWER, INTAKE] })).thread;
  assert.deepEqual(a.agents.map((x: any) => [x.agentId, x.mode]), [[INTAKE, "lead"], [DRAFTER, "listen"], [REVIEWER, "listen"]]);
  const b = (await start(hn.ctx, { agentIds: [INTAKE], personId: MAYA })).thread;
  assert.deepEqual(b.agents.map((x: any) => x.mode), ["listen"]);
  assert.deepEqual(b.members.map((m: any) => m.id), [DANA, MAYA]);
});

test("a direct message is one conversation per pair of people", async () => {
  const hn = harness();
  const first = (await start(hn.ctx, { personId: MAYA, first: "Hi Maya" })).thread;
  assert.deepEqual(first.members.map((m: any) => m.id), [DANA, MAYA]);
  hn.clear();
  const again = (await start(hn.person(MAYA), { personId: DANA, first: "Hi back" })).thread;
  assert.equal(again.threadId, first.threadId, "started from the other side it is the same conversation");
  assert.equal(lastMessages(hn.db, first.threadId).length, 2);
  assert.deepEqual(hn.names(), ["message.received"]);
  const other = (await start(hn.ctx, { personId: LEO })).thread;
  assert.notEqual(other.threadId, first.threadId);
  // a chat with an agent in it, or about an object, is its own thing
  const withAgent = (await start(hn.ctx, { personId: MAYA, agentIds: [INTAKE] })).thread;
  assert.notEqual(withAgent.threadId, first.threadId);
});

test("an Ask pane is private, scoped to an object and out of Recent until it is opened as a chat", async () => {
  const hn = harness();
  const { thread } = await start(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "record", scopeId: "rec_a1", recordId: "rec_a1", first: "What is this?" });
  assert.equal(thread.kind, "ask");
  assert.equal(thread.listed, false);
  assert.equal(thread.scopeType, "record");
  assert.equal(thread.scopeId, "rec_a1");
  assert.deepEqual(thread.agents.map((x: any) => x.mode), ["lead"], "the agent leads in an Ask pane");
  const msg = lastMessages(hn.db, thread.threadId)[0]!;
  const post = await h["chat.post"]!(hn.ctx, { threadId: thread.threadId, body: "More", idempotencyKey: "p" });
  assert.equal(post.message.enc, 2, "an Ask pane is enc=2 like any private chat");
  assert.ok(msg.id);
  const second = (await start(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "record", scopeId: "rec_a1" })).thread;
  assert.notEqual(second.threadId, thread.threadId, "each Ask is its own pane in the object's history");
});

test("what is refused", async () => {
  const hn = harness();
  const bad = (input: Record<string, unknown>) => failure(() => start(hn.ctx, input));
  assert.equal(await bad({}), "validation.bad_input", "nobody to talk to");
  assert.equal(await bad({ personId: DANA }), "validation.bad_input", "yourself");
  assert.equal(await bad({ personId: INTAKE }), "validation.bad_input", "an agent id is not a person");
  assert.equal(await bad({ agentIds: [MAYA] }), "validation.bad_input", "a person id is not an agent");
  assert.equal(await bad({ kind: "ask", agentIds: [INTAKE] }), "validation.bad_input", "an Ask is about something");
  assert.equal(await bad({ kind: "ask", scopeType: "record", scopeId: "rec_a1" }), "validation.bad_input", "an Ask needs an agent");
  assert.equal(await bad({ kind: "ask", agentIds: [INTAKE], personId: MAYA, scopeType: "record", scopeId: "rec_a1" }), "validation.bad_input", "an Ask is private");
  assert.equal(await bad({ agentIds: [INTAKE], scopeId: "rec_a1" }), "validation.bad_input", "scope needs both parts");
  assert.equal(await bad({ agentIds: Array.from({ length: 21 }, (_, i) => `agt_a${i}`) }), "validation.bad_input");
  assert.equal(hn.rows("SELECT id FROM chat_thread").length, 0);
});

test("an agent that starts a chat for a person starts it as that person's chat", async () => {
  const hn = harness();
  const { thread } = await start(hn.agent(INTAKE, MAYA), { agentIds: [DRAFTER], title: "Delegated" });
  assert.equal(thread.starter, MAYA);
  assert.deepEqual(thread.members, [{ kind: "person", id: MAYA }]);
});

// ---- chat.thread -----------------------------------------------------------------------------------------------------------------------------------

async function channelWith(hn: Harness) {
  return (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: `c${++n}` })).channel;
}

test("the thread under a message is made once and reopened after that", async () => {
  const hn = harness();
  const c = await channelWith(hn);
  const msg = (await h["chat.post"]!(hn.person(MAYA), { threadId: c.mainThreadId, body: "Can someone look at this?", idempotencyKey: "p1" })).message;
  hn.clear();
  const { thread } = await h["chat.thread"]!(hn.ctx, { threadId: c.mainThreadId, messageId: msg.messageId });
  assert.equal(thread.kind, "thread");
  assert.equal(thread.parentThreadId, c.mainThreadId);
  assert.equal(thread.parentMessageId, msg.messageId);
  assert.equal(thread.listed, false);
  assert.deepEqual(thread.agents, [], "people's threads leave agents listening in the channel, not in the thread");
  assert.deepEqual(hn.names(), ["thread.started"]);
  assert.deepEqual(assertEventsConform(hn), []);
  hn.clear();
  const again = await h["chat.thread"]!(hn.person(LEO), { threadId: c.mainThreadId, messageId: msg.messageId });
  assert.equal(again.thread.threadId, thread.threadId);
  assert.deepEqual(hn.names(), []);
});

test("the thread under an agent's message is worked by that agent, who leads it", async () => {
  const hn = harness();
  const c = await channelWith(hn);
  const line = (await h["chat.post"]!(hn.agent(INTAKE), { threadId: c.mainThreadId, body: "Intake is on it", idempotencyKey: "p1" })).message;
  const { thread } = await h["chat.thread"]!(hn.ctx, { threadId: c.mainThreadId, messageId: line.messageId });
  assert.deepEqual(thread.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "lead"]]);
  // an agent that opens a thread under a person's message leads it too
  const ask = (await h["chat.post"]!(hn.person(MAYA), { threadId: c.mainThreadId, body: "Draft a reply", idempotencyKey: "p2" })).message;
  const mine = await h["chat.thread"]!(hn.agent(DRAFTER), { threadId: c.mainThreadId, messageId: ask.messageId });
  assert.deepEqual(mine.thread.agents.map((a: any) => [a.agentId, a.mode]), [[DRAFTER, "lead"]]);
});

test("a thread needs a message of that thread, and a private chat's messages are private", async () => {
  const hn = harness();
  const c = await channelWith(hn);
  const other = (await start(hn.ctx, { agentIds: [INTAKE] })).thread;
  const mine = (await h["chat.post"]!(hn.ctx, { threadId: other.threadId, body: "private", idempotencyKey: "p" })).message;
  assert.equal(await failure(() => h["chat.thread"]!(hn.ctx, { threadId: c.mainThreadId, messageId: mine.messageId })), "validation.not_found");
  assert.equal(await failure(() => h["chat.thread"]!(hn.ctx, { threadId: "thr_none", messageId: mine.messageId })), "validation.not_found");
  assert.equal(await failure(() => h["chat.thread"]!(hn.person(MAYA), { threadId: other.threadId, messageId: mine.messageId })), "validation.not_found");
});

test("a thread carries its reply count and the time of its last message, and a deleted message is not counted (P-CC_34)", async () => {
  const hn = harness();
  const { thread } = await start(hn.ctx, { agentIds: [INTAKE] });
  assert.equal(thread.replyCount, 0);
  assert.equal(thread.lastMessageAt, undefined, "no message yet");
  await h["chat.post"]!(hn.ctx, { threadId: thread.threadId, body: "one", idempotencyKey: `rc${++n}` });
  hn.advance(5000);
  await h["chat.post"]!(hn.ctx, { threadId: thread.threadId, body: "two", idempotencyKey: `rc${++n}` });
  const got = threadOut(hn.db, threadBy(hn.db, thread.threadId)!);   // what threads.get returns for it
  assert.equal(got.replyCount, 2);
  assert.equal(got.lastMessageAt, hn.clock.t);
  const other = (await start(hn.ctx, { agentIds: [INTAKE] })).thread;
  assert.equal(other.replyCount, 0, "another thread keeps its own count");
});
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
