// P-CC_39: threads.erase and channels.erase remove a chat or a channel whole (messages, blocks, plans, agents, members, counters, field clocks, inline threads); chat.transcript.purge removes messages and blocks
// older than a cutoff, oldest first in batches, leaving threads listed in skipThreadIds untouched. Other chats are never touched; erasing twice is `erased: false`.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, DRAFTER, INTAKE, MAYA, assertEventsConform, harness as baseHarness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const notFound = () => Object.assign(new Error("gone"), { error: { code: "validation.not_found" } });
/** The chat harness with the Files calls an erase makes: no file stands at a transcript path unless a test puts one there. */
const files = new Map<string, string>();
const harness = (): ReturnType<typeof baseHarness> => baseHarness({
  calls: {
    "files.resolve": (i) => { const f = files.get(String(i["path"])); if (!f) throw notFound(); return { kind: "file", fileId: f }; },
    "files.delete": () => ({ deleted: true }),
    "files.purge": () => ({ purged: true }),
  },
});
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const key = () => `p${++n}`;
const count = (hn: Harness, table: string): number => hn.rows(`SELECT * FROM ${table}`).length;

async function chat(hn: Harness, words: string): Promise<string> {
  const id = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], first: words, idempotencyKey: key() })).thread.threadId as string;
  return id;
}

test("erase a thread: messages, blocks, plan, members, agents and the counter all go; another chat stays", async () => {
  const hn = harness();
  const gone = await chat(hn, "I am worried about my pending divorce");
  const keep = await chat(hn, "Lunch on Friday");
  hn.seedQuestion(gone, { mode: "single", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], prompt: "Tell me about the settlement?" });
  hn.seedPlan(gone);
  assert.ok(count(hn, "chat_message") >= 4 && count(hn, "chat_block") >= 2 && count(hn, "chat_plan") === 1);
  hn.clear();
  const out = await h["threads.erase"]!(hn.ctx, { threadId: gone, idempotencyKey: key() });
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(hn.rows("SELECT id FROM chat_thread").map((r) => r["id"]), [keep]);
  assert.deepEqual([...new Set(hn.rows("SELECT thread FROM chat_message").map((r) => r["thread"]))], [keep]);
  assert.equal(count(hn, "chat_block"), 0);
  assert.equal(count(hn, "chat_plan"), 0);
  assert.deepEqual(hn.rows("SELECT thread FROM chat_thread_seq").map((r) => r["thread"]), [keep]);
  assert.ok(hn.rows("SELECT thread FROM chat_thread_agent").every((r) => r["thread"] === keep));
  assert.ok(hn.rows("SELECT thread FROM chat_thread_member").every((r) => r["thread"] === keep));
  assert.ok(!JSON.stringify([hn.rows("SELECT * FROM chat_message"), hn.rows("SELECT * FROM chat_block"), hn.emitted]).includes("divorce"), "the words are gone and the event has ids only");
  assert.deepEqual(hn.named("thread.erased").map((e) => e.payload), [{ threadId: gone }]);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.deepEqual(await h["threads.erase"]!(hn.ctx, { threadId: gone, idempotencyKey: key() }), { erased: false });
});

test("erase a channel: its main thread, its threads and its row go; other channels stay", async () => {
  const hn = harness();
  const mk = async (name: string) => (await h["channels.create"]!(hn.ctx, { name, visibility: "public", memberIds: [MAYA], agentIds: [INTAKE, DRAFTER], idempotencyKey: key() })).channel;
  const gone = await mk("Smith matter");
  const keep = await mk("Lunch club");
  await h["chat.post"]!(hn.ctx, { threadId: gone.mainThreadId, body: "The settlement number is confidential", idempotencyKey: key() });
  await h["chat.post"]!(hn.ctx, { threadId: keep.mainThreadId, body: "Pizza at noon", idempotencyKey: key() });
  const out = await h["channels.erase"]!(hn.ctx, { channelId: gone.channelId, idempotencyKey: key() });
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(hn.rows("SELECT id FROM chat_channel").map((r) => r["id"]), [keep.channelId]);
  assert.deepEqual(hn.rows("SELECT id FROM chat_thread").map((r) => r["id"]), [keep.mainThreadId]);
  assert.ok(!JSON.stringify(hn.rows("SELECT * FROM chat_message")).includes("confidential"));
  assert.deepEqual(hn.named("channel.erased").map((e) => e.payload), [{ channelId: gone.channelId }]);
  assert.deepEqual(await h["channels.erase"]!(hn.ctx, { channelId: gone.channelId, idempotencyKey: key() }), { erased: false });
});

test("transcript purge removes old messages and their blocks, oldest first in batches, and leaves skipped threads whole", async () => {
  const hn = harness();
  const old = await chat(hn, "old chat one");
  const held = await chat(hn, "old chat held");
  await h["chat.post"]!(hn.ctx, { threadId: old, body: "second old message", idempotencyKey: key() });
  await h["chat.post"]!(hn.ctx, { threadId: held, body: "second held message", idempotencyKey: key() });
  hn.advance(400 * 86_400_000);
  const young = await chat(hn, "young chat");
  const cutoff = hn.clock.t - 30 * 86_400_000;
  const before = count(hn, "chat_message");
  hn.clear();
  const first = await h["chat.transcript.purge"]!(hn.ctx, { before: cutoff, limit: 1, skipThreadIds: [held], idempotencyKey: key() });
  assert.equal(first.removed, 1);
  assert.equal(first.more, true);
  const rest = await h["chat.transcript.purge"]!(hn.ctx, { before: cutoff, skipThreadIds: [held], idempotencyKey: key() });
  assert.equal(rest.more, false);
  const left = new Set(hn.rows("SELECT thread FROM chat_message").map((r) => r["thread"]));
  assert.ok(left.has(held) && left.has(young), "the held chat and the young chat keep their messages");
  assert.ok(!left.has(old), "the old chat lost its messages");
  assert.ok(count(hn, "chat_message") < before);
  assert.equal(hn.rows("SELECT id FROM chat_thread").length, 3, "the threads themselves stay");
  assert.deepEqual(await h["chat.transcript.purge"]!(hn.ctx, { before: cutoff, skipThreadIds: [held], idempotencyKey: key() }), { removed: 0, more: false });
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a transcript file at chats/<id>/transcript.md goes with its chat: deleted and purged, versions with it", async () => {
  files.clear();
  const hn = harness();
  const gone = await chat(hn, "private words");
  files.set(`chats/${gone}/transcript.md`, "fil_trans0001");
  hn.clear();
  assert.deepEqual(await h["threads.erase"]!(hn.ctx, { threadId: gone, idempotencyKey: key() }), { erased: true });
  assert.deepEqual(hn.callLog.map((c) => [c.cap, c.input["fileId"] ?? c.input["path"]]), [["files.resolve", `chats/${gone}/transcript.md`], ["files.delete", "fil_trans0001"], ["files.purge", "fil_trans0001"]]);
  assert.equal(count(hn, "chat_thread"), 0);
  files.clear();
});
