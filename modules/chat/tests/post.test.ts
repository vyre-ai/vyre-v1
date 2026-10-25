// chat.post (spec 2.5, 3.2, 4.6): who may write where, mentions and the notices people get, hops between agents, routine lines, helper chats and blocks.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { insertThread } from "../projections.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, REVIEWER, assertEventsConform, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const say = (ctx: Harness["ctx"], threadId: string, body: string, extra: Record<string, unknown> = {}) => h["chat.post"]!(ctx, { threadId, body, idempotencyKey: `p${++n}`, ...extra });
const channel = async (hn: Harness, over: Record<string, unknown> = {}) =>
  (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA, LEO], agentIds: [INTAKE, DRAFTER, REVIEWER], idempotencyKey: `c${++n}`, ...over })).channel;
const privateChat = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `s${++n}` })).thread.threadId as string;

test("a post returns the stored message and announces it once with ids and counts, never the text", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  hn.clear();
  const out = await say(hn.ctx, t, "My secret plan", { attachments: ["fil_a1", "fil_a1", "fil_b2"], mentions: [{ kind: "agent", id: INTAKE }, { kind: "agent", id: INTAKE }] });
  assert.equal(out.message.body, "My secret plan");
  assert.deepEqual(out.message.author, { kind: "person", id: DANA });
  assert.equal(out.message.kind, "text");
  assert.deepEqual(out.message.attachments, ["fil_a1", "fil_b2"]);
  assert.equal(out.message.enc, 2, "a private chat is an enc=2 thread");
  assert.deepEqual(hn.names(), ["message.received"]);
  const ev = hn.named("message.received")[0]!;
  assert.deepEqual(ev.payload["mentions"], [{ kind: "agent", id: INTAKE }]);
  assert.equal(ev.payload["hasBlocks"], false);
  assert.ok(!JSON.stringify(ev.payload).includes("My secret plan"));
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a message in a channel is enc 0, and an agent's message is kind agent", async () => {
  const hn = harness();
  const c = await channel(hn);
  const person = await say(hn.ctx, c.mainThreadId, "hello");
  assert.equal(person.message.enc, 0);
  const agent = await say(hn.agent(INTAKE), c.mainThreadId, "Intake is on it");
  assert.equal(agent.message.kind, "agent");
  assert.deepEqual(agent.message.author, { kind: "agent", id: INTAKE });
});

test("a private chat answers to its members and the agents in it, and nobody else", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  assert.equal(await failure(() => say(hn.person(MAYA), t, "hi")), "validation.not_found");
  assert.equal(await failure(() => say(hn.agent(DRAFTER, MAYA), t, "hi")), "validation.not_found");
  assert.equal((await say(hn.agent(INTAKE), t, "I am in this chat")).message.threadSeq, 1);
  // a direct message belongs to both people
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, idempotencyKey: "dm" })).thread.threadId as string;
  assert.equal((await say(hn.person(MAYA), dm, "hi Dana")).message.threadSeq, 1);
  assert.equal(await failure(() => say(hn.person(LEO), dm, "can I join?")), "validation.not_found");
});

test("a direct message notifies the other person; a channel message does not", async () => {
  const hn = harness();
  const dm = (await h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, idempotencyKey: "dm" })).thread.threadId as string;
  hn.clear();
  await say(hn.ctx, dm, "hello Maya");
  assert.deepEqual(hn.names(), ["message.received", "message.direct"]);
  assert.equal(hn.named("message.direct")[0]!.payload["personId"], MAYA);
  hn.clear();
  await say(hn.person(MAYA), dm, "hello Dana");
  assert.equal(hn.named("message.direct")[0]!.payload["personId"], DANA);
  hn.clear();
  await say(hn.agent(INTAKE, DANA), (await h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, agentIds: [INTAKE], idempotencyKey: "dm2" })).thread.threadId, "agent talking");
  assert.equal(hn.named("message.direct").length, 0, "an agent's line is not a message from a person");
  const c = await channel(hn);
  hn.clear();
  await say(hn.ctx, c.mainThreadId, "channel talk");
  assert.deepEqual(hn.names(), ["message.received"]);
});

test("@mentions notify the people named, but a private chat never gains a person", async () => {
  const hn = harness();
  const c = await channel(hn);
  hn.clear();
  await say(hn.ctx, c.mainThreadId, "Maya, Leo and Intake please look", { mentions: [{ kind: "person", id: MAYA }, { kind: "person", id: LEO }, { kind: "agent", id: INTAKE }, { kind: "person", id: DANA }] });
  const mentioned = hn.named("message.mentioned").map((e) => e.payload["personId"]);
  assert.deepEqual(mentioned, [MAYA, LEO], "the author is not told about their own mention, agents get no notice");
  assert.equal(hn.named("message.mentioned")[0]!.payload["inThread"], false);
  assert.deepEqual(assertEventsConform(hn), []);

  const t = await privateChat(hn);
  hn.clear();
  await say(hn.ctx, t, "should Maya see this?", { mentions: [{ kind: "person", id: MAYA }] });
  assert.equal(hn.named("message.mentioned").length, 0);
  assert.deepEqual(hn.named("message.received")[0]!.payload["mentions"], [{ kind: "person", id: MAYA }]);

  assert.equal(await failure(() => say(hn.ctx, t, "x", { mentions: [{ kind: "person", id: INTAKE }] })), "validation.bad_input");
  assert.equal(await failure(() => say(hn.ctx, t, "x", { mentions: [{ kind: "agent", id: MAYA }] })), "validation.bad_input");
});

test("replies in an inline thread reach the author of the message above and the people who already replied, not the writer", async () => {
  const hn = harness();
  const c = await channel(hn);
  const root = (await say(hn.person(MAYA), c.mainThreadId, "Who owns the intake form?")).message.messageId as string;
  const th = (await h["chat.thread"]!(hn.ctx, { threadId: c.mainThreadId, messageId: root })).thread.threadId as string;
  hn.clear();
  await say(hn.ctx, th, "I do", { mentions: [{ kind: "person", id: LEO }] });
  const replied = hn.named("thread.replied");
  assert.deepEqual(replied.map((e) => e.payload["personId"]), [MAYA]);
  assert.equal(replied[0]!.payload["parentThreadId"], c.mainThreadId);
  assert.equal(hn.named("message.mentioned")[0]!.payload["inThread"], true);
  hn.clear();
  await say(hn.person(LEO), th, "me too");
  assert.deepEqual(hn.named("thread.replied").map((e) => e.payload["personId"]).sort(), [DANA, MAYA].sort());
  assert.deepEqual(assertEventsConform(hn), []);
});

test("agents hand work to each other four times, then a person must reply; the limit is the Policies setting", async () => {
  const hn = harness();
  const c = await channel(hn);
  const t = c.mainThreadId as string;
  await say(hn.ctx, t, "Please handle this");
  const chain = [INTAKE, DRAFTER, REVIEWER, INTAKE, DRAFTER];
  const depths: number[] = [];
  for (const a of chain) depths.push((await say(hn.agent(a), t, `${a} here`)).message.depth);
  assert.deepEqual(depths, [0, 1, 2, 3, 4]);
  const failed = await failure(() => say(hn.agent(REVIEWER), t, "one hop too far"));
  assert.equal(failed, "permission.limit");
  assert.equal((await say(hn.agent(DRAFTER), t, "same agent adding more")).message.depth, 4, "an agent following itself is not another hop");
  await say(hn.ctx, t, "carry on");
  assert.equal((await say(hn.agent(REVIEWER), t, "fresh start")).message.depth, 0, "a person's message starts the count again");

  const two = harness({ calls: { "settings.get": () => ({ row: { value: 2 } }) } });
  const c2 = await channel(two);
  await say(two.ctx, c2.mainThreadId, "go");
  assert.equal((await say(two.agent(INTAKE), c2.mainThreadId, "a")).message.depth, 0);
  assert.equal((await say(two.agent(DRAFTER), c2.mainThreadId, "b")).message.depth, 1);
  assert.equal((await say(two.agent(REVIEWER), c2.mainThreadId, "c")).message.depth, 2);
  assert.equal(await failure(() => say(two.agent(INTAKE), c2.mainThreadId, "d")), "permission.limit");
  // a reply to a specific message counts from that message
  const first = (await say(two.ctx, c2.mainThreadId, "another")).message.messageId as string;
  assert.equal((await say(two.agent(INTAKE), c2.mainThreadId, "e", { replyTo: first })).message.depth, 0);
});

test("an agent that posts because of a routine carries the owner on the message and the event; nobody else may", async () => {
  const hn = harness();
  const c = await channel(hn);
  hn.clear();
  const out = await say(hn.agent(INTAKE), c.mainThreadId, "Weekly digest", { via: { routineOwner: MAYA } });
  assert.deepEqual(out.message.via, { routineOwner: MAYA });
  assert.equal(hn.named("message.received")[0]!.payload["via"], MAYA);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.equal(await failure(() => say(hn.ctx, c.mainThreadId, "I pretend", { via: { routineOwner: MAYA } })), "validation.bad_input");
  const stored = hn.rows("SELECT via FROM chat_message WHERE id = ?", out.message.messageId)[0]!;
  assert.deepEqual(JSON.parse(String(stored["via"])), { routineOwner: MAYA });
  const plain = await say(hn.ctx, c.mainThreadId, "plain");
  assert.equal(plain.message.via, undefined);
});

test("a helper chat takes no messages from people; the helper itself may write", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  const helper = insertThread(hn.ctx, { kind: "helper", title: "Firms 1-3", starter: DANA, parentThreadId: t, listed: false });
  hn.raw.run("INSERT INTO chat_thread_agent (id, thread, agentId, mode, version) VALUES ('tha_h1', ?, ?, 'lead', 0)", helper.id, DRAFTER);
  assert.equal(await failure(() => say(hn.ctx, helper.id, "can you also check X?")), "validation.bad_input");
  const out = await say(hn.agent(DRAFTER), helper.id, "Found three firms");
  assert.equal(out.message.threadSeq, 1);
  assert.equal(out.message.enc, 2, "a helper under a private chat is part of it");
});

test("blocks get ids and the trace; questions and plans have their own tools", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  const out = await say(hn.agent(INTAKE), t, "Here is the record", { blocks: [{ type: "record_card", v: 1, data: { recordId: "rec_a1" } }] });
  const b = out.message.blocks[0];
  assert.equal(b.type, "record_card");
  assert.match(b.id, /^blk_[0-9a-z]+$/);
  assert.equal(b.traceId, "0123456789abcdef0123456789abcdef");
  assert.equal(hn.named("message.received").pop()!.payload["hasBlocks"], true);
  assert.equal(await failure(() => say(hn.ctx, t, "x", { blocks: [{ type: "plan", v: 1, data: {} }] })), "validation.bad_input");
  assert.equal(await failure(() => say(hn.ctx, t, "x", { blocks: [{ type: "Not A Type", v: 1, data: {} }] })), "validation.bad_input");
  // a post may be nothing but a block, or nothing but a file
  assert.equal((await say(hn.agent(INTAKE), t, "", { blocks: [{ type: "record_card", v: 1, data: {} }] })).message.threadSeq, 2);
  assert.equal((await say(hn.ctx, t, "", { attachments: ["fil_x1"] })).message.threadSeq, 3);
});

test("size limits: a message holds 100,000 characters, a post 50 mentions", async () => {
  const hn = harness();
  const t = await privateChat(hn);
  assert.equal(await failure(() => say(hn.ctx, t, "x".repeat(100_001))), "validation.bad_input");
  assert.equal((await say(hn.ctx, t, "x".repeat(100_000))).message.threadSeq, 1);
  const many = Array.from({ length: 51 }, (_, i) => ({ kind: "person", id: `usr_p${i}` }));
  assert.equal(await failure(() => say(hn.ctx, t, "hi", { mentions: many })), "validation.bad_input");
});
