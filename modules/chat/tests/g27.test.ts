// chat.fork and chat.search against the frozen contract: a fork copies up to a message under new ids and links back, keeps the agents, refuses what is sealed or not yours; search finds words
// across the chats a person is in, never another person's chat, names the message so a screen can jump to it, and uses the meaning index only inside what the asker may read.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { g27Handlers, setMeaningIndex } from "../handlers/g27.ts";
import { DANA, INTAKE, MAYA, assertEventsConform, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const g = g27Handlers as unknown as Record<string, Fn>;
const base = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = () => `g27-${++n}`;

const chat = async (hn: Harness, ctx = hn.ctx, agents: string[] = [INTAKE]) => (await base["chat.start"]!(ctx, { kind: "chat", agentIds: agents, idempotencyKey: key() })).thread.threadId as string;
const say = async (ctx: Harness["ctx"], threadId: string, body: string) => (await base["chat.post"]!(ctx, { threadId, body, idempotencyKey: key() })).message.messageId as string;

async function run(hn: Harness, cap: string, ctx: Harness["ctx"], input: Record<string, unknown>) {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  hn.clear();
  const out = await g[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: answer`);
  const def = registry.capabilities.find((c) => c.name === cap)!;
  for (const e of hn.emitted) assert.ok((def.emits as readonly string[]).includes(e.name), `${cap} emitted undeclared ${e.name}`);
  assert.deepEqual(assertEventsConform(hn), [], cap);
  return out;
}

test("the table holds the two capabilities, both frozen chat capabilities with examples that are valid", () => {
  assert.deepEqual(Object.keys(g).sort(), ["chat.fork", "chat.search"]);
  for (const name of Object.keys(g)) {
    const cap = registry.capabilities.find((c) => c.name === name && c.module === "chat")!;
    assert.ok(cap, name);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example ${ex.name}`);
  }
});

test("a fork copies the chat up to the message under new ids, keeps the agents, and starts with a line that links back", async () => {
  const hn = harness();
  const t = await chat(hn);
  const a = await say(hn.ctx, t, "first");
  const b = await say(hn.ctx, t, "second");
  await say(hn.ctx, t, "third, after the fork point");
  const out = await run(hn, "chat.fork", hn.ctx, { threadId: t, messageId: b, idempotencyKey: key() });
  assert.equal(out.copied, 2);
  assert.notEqual(out.thread.threadId, t);
  assert.equal(out.thread.kind, "chat");
  assert.deepEqual(out.thread.agents.map((x: any) => [x.agentId, x.mode]), [[INTAKE, "lead"]]);
  assert.deepEqual(out.thread.members.map((m: any) => m.id), [DANA]);
  const list = await base["chat.messages.list"]!(hn.ctx, { threadId: out.thread.threadId });
  assert.deepEqual(list.messages.slice(1).map((m: any) => m.body), ["first", "second"]);
  assert.match(list.messages[0].body, /^Forked from /);
  assert.equal(list.messages[0].kind, "system");
  assert.deepEqual(list.messages[0].blocks[0].data.threadId, t);
  assert.deepEqual(list.messages[0].blocks[0].data.messageId, b);
  const copied = list.messages.slice(1).map((m: any) => m.messageId);
  assert.ok(!copied.includes(a) && !copied.includes(b), "the copies have ids of their own");
  assert.deepEqual(list.messages.map((m: any) => m.threadSeq), [1, 2, 3], "numbered from 1, gap free");
  assert.deepEqual(hn.named("message.received"), [], "a copy wakes no agent");
});

test("a fork with no message forks from the last one, a title is kept, and a waiting question stays as a record, not an open question", async () => {
  const hn = harness();
  const t = await chat(hn);
  await say(hn.ctx, t, "hello");
  hn.seedQuestion(t, { mode: "single", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], prompt: "Which one?" });
  const out = await run(hn, "chat.fork", hn.ctx, { threadId: t, title: "Take two", idempotencyKey: key() });
  assert.equal(out.thread.title, "Take two");
  assert.equal(out.copied, 2);
  const list = await base["chat.messages.list"]!(hn.ctx, { threadId: out.thread.threadId });
  const q = list.messages.find((m: any) => m.blocks.some((b: any) => b.type === "question"));
  assert.ok(q);
  assert.ok(q.blocks.every((b: any) => b.state !== "waiting"));
});

test("a chat that is not yours cannot be forked, and an empty chat has nothing to fork", async () => {
  const hn = harness();
  const mine = await chat(hn);
  const empty = await chat(hn);
  await say(hn.ctx, mine, "private words");
  await assert.rejects(g["chat.fork"]!(hn.person(MAYA), { threadId: mine, idempotencyKey: key() }), (e: any) => /not_found|does not exist/.test(JSON.stringify(e)));
  await assert.rejects(g["chat.fork"]!(hn.ctx, { threadId: empty, idempotencyKey: key() }), (e: any) => /precondition|nothing in this chat/.test(JSON.stringify(e)));
});

test("search finds the words in the chats you are in, names each message, and never reaches another person's chat", async () => {
  const hn = harness();
  const a = await chat(hn);
  const m1 = await say(hn.ctx, a, "The Rivera estate needs a trust amendment before Friday");
  await say(hn.ctx, a, "Unrelated lunch plans");
  const b = await chat(hn);
  await say(hn.ctx, b, "Rivera called about the invoice");
  const theirs = await chat(hn, hn.person(MAYA));
  await say(hn.person(MAYA), theirs, "Rivera secret in Maya's chat");
  const out = await run(hn, "chat.search", hn.ctx, { q: "rivera estate" });
  assert.equal(out.meaning, false, "no meaning index is bound, and the answer says so");
  assert.equal(out.hits[0].messageId, m1, "the message with both words ranks first");
  assert.equal(out.hits[0].threadId, a);
  assert.ok(out.hits[0].threadSeq >= 1);
  assert.match(out.hits[0].snippet, /Rivera estate/);
  assert.deepEqual(out.hits.map((h: any) => h.threadId).filter((x: string) => x === theirs), [], "Maya's chat is not Dana's to search");
  assert.ok(out.hits.every((h: any) => h.found === "keyword"));
  assert.deepEqual(out.hits[0].thread.agentIds, [INTAKE]);
});

test("search can be limited to one chat, treats % and _ as plain characters, and refuses an empty question", async () => {
  const hn = harness();
  const a = await chat(hn);
  const b = await chat(hn);
  await say(hn.ctx, a, "discount of 50% today");
  await say(hn.ctx, b, "discount of 50 dollars");
  const one = await run(hn, "chat.search", hn.ctx, { q: "discount", threadId: a });
  assert.deepEqual(one.hits.map((h: any) => h.threadId), [a]);
  const pct = await run(hn, "chat.search", hn.ctx, { q: "50%" });
  assert.ok(pct.hits.length >= 1);
  await assert.rejects(g["chat.search"]!(hn.ctx, { q: "  " }), (e: any) => /at least one word/.test(JSON.stringify(e)));
});

test("a bound meaning index adds hits that share no words, is cut to the chats the asker may read, and a failing index leaves the word search whole", async () => {
  const hn = harness();
  const a = await chat(hn);
  const near = await say(hn.ctx, a, "Please move the closing to next week");
  const exact = await say(hn.ctx, a, "The closing date is Monday");
  const far = await say(hn.ctx, a, "Let us push it back a week");
  const theirs = await chat(hn, hn.person(MAYA));
  const stolen = await say(hn.person(MAYA), theirs, "closing postponed");
  setMeaningIndex(async () => [{ messageId: near, score: 0.9 }, { messageId: far, score: 0.8 }, { messageId: stolen, score: 0.99 }]);
  try {
    const out = await run(hn, "chat.search", hn.ctx, { q: "closing date", mode: "hybrid" });
    assert.equal(out.meaning, true);
    const ids = out.hits.map((h: any) => h.messageId);
    assert.ok(ids.includes(near) && ids.includes(exact));
    assert.ok(!ids.includes(stolen), "the index never widens access");
    assert.ok(ids.includes(far), "a message that shares no word with the question is found by meaning");
    assert.equal(out.hits.find((h: any) => h.messageId === far).found, "meaning");
    assert.equal(out.hits.find((h: any) => h.messageId === near).found, "both");
    const only = await run(hn, "chat.search", hn.ctx, { q: "postponed rescheduled", mode: "meaning" });
    assert.deepEqual(only.hits.map((h: any) => h.messageId), [near, far]);
    setMeaningIndex(async () => { throw new Error("model not loaded"); });
    const failed = await run(hn, "chat.search", hn.ctx, { q: "closing date" });
    assert.equal(failed.meaning, false);
    assert.ok(failed.hits.some((h: any) => h.messageId === exact));
  } finally { setMeaningIndex(null); }
});

test("a fork of a chat that had other people in it stays private to the forker: it cannot become a channel with anyone, so their words go nowhere new", async () => {
  const hn = harness();
  const room = (await base["channels.create"]!(hn.ctx, { name: "intake", visibility: "invite", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: key() })).channel;
  await say(hn.person(MAYA), room.mainThreadId, "Maya's words, not for outsiders");
  const out = await run(hn, "chat.fork", hn.ctx, { threadId: room.mainThreadId, idempotencyKey: key() });
  const forked = out.thread.threadId as string;
  assert.deepEqual(out.thread.members.map((m: any) => m.id), [DANA]);
  await assert.rejects(base["threads.members.add"]!(hn.ctx, { threadId: forked, personId: "usr_leo" }), (e: any) => /never gains people/.test(JSON.stringify(e)));
  await assert.rejects(base["threads.make_channel"]!(hn.ctx, { threadId: forked, personId: "usr_leo" }), (e: any) => /private_fork|stays private/.test(JSON.stringify(e)));
  assert.equal(hn.rows("SELECT COUNT(*) AS n FROM chat_channel")[0]?.n, 1, "no channel was made from the copy");
});

test("a fork of a chat with only the forker in it may still become a channel, as any private chat may", async () => {
  const hn = harness();
  const t = await chat(hn);
  await say(hn.ctx, t, "just me");
  const out = await run(hn, "chat.fork", hn.ctx, { threadId: t, idempotencyKey: key() });
  const made = await base["threads.make_channel"]!(hn.ctx, { threadId: out.thread.threadId, personId: MAYA, idempotencyKey: key() });
  assert.ok(made.channel.channelId);
});

test("meaning comes from the memory module's ranker: only messages this person may read are scored, low scores are ignored, and empty scores or a failing ranker leave the word search whole", async () => {
  const seen: Array<{ query: string; ids: string[] }> = [];
  const hn0 = harness();
  const a = await chat(hn0);
  const far = await say(hn0.ctx, a, "Let us push it back a week");
  const unrelated = await say(hn0.ctx, a, "Lunch is at noon");
  const theirs = await chat(hn0, hn0.person(MAYA));
  const secret = await say(hn0.person(MAYA), theirs, "Maya private plan");
  let mode: "scores" | "empty" | "throw" = "scores";
  const hn = harness({ raw: hn0.raw, calls: { "memory.meaning.rank": (i: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    seen.push({ query: i.query, ids: i.candidates.map((c: { id: string }) => c.id) });
    if (mode === "throw") throw new Error("not set up");
    return { scores: mode === "empty" ? [] : i.candidates.map((c: { id: string }) => ({ id: c.id, score: c.id === far ? 0.8 : c.id === unrelated ? 0.1 : 0 })), meaning: { state: "on" } };
  } } });
  const out = await run(hn, "chat.search", hn.ctx, { q: "postpone the closing" });
  assert.equal(out.meaning, true);
  assert.ok(out.hits.some((h: any) => h.messageId === far && h.found === "meaning"));
  assert.ok(!out.hits.some((h: any) => h.messageId === unrelated), "a low score is not a match");
  assert.ok(seen[0]!.ids.includes(far) && !seen[0]!.ids.includes(secret), "Maya's message was never sent to the ranker");
  assert.ok(seen[0]!.ids.length <= 200);
  mode = "empty";
  assert.equal((await run(hn, "chat.search", hn.ctx, { q: "postpone the closing" })).meaning, false);
  mode = "throw";
  const failed = await run(hn, "chat.search", hn.ctx, { q: "lunch noon" });
  assert.equal(failed.meaning, false);
  assert.ok(failed.hits.some((h: any) => h.messageId === unrelated), "the words still find it");
  const kw = await run(hn, "chat.search", hn.ctx, { q: "lunch", mode: "keyword" });
  assert.equal(kw.meaning, false);
});
