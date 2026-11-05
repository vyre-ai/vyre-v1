// "Save as a note?": an agent offers once per topic and rarely, the person's switch can turn it off, Save makes the person's own private note from this chat and message, Not now is remembered,
// and nobody else in the chat can answer it or make the agent post one by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, INTAKE, MAYA, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { DECLINED_MS, TOO_SOON_MS, answer, make, topicKey } from "../handlers/note-offer.ts";
import { post } from "../handlers/post.ts";
import { start } from "../handlers/thread.ts";

const offer = { title: "Weinberger form link", body: "weinbergerlaw.com/intake-form\nSend it with the field list on Wednesday.", topic: "Weinberger intake form" };
const world = (on = true) => harness({ calls: {
  "settings.get": () => ({ row: { value: on } }),
  "notes.create": (i) => ({ note: { noteId: "nte_saved1", title: i["title"] } }),
} });
const chatOf = async (hn: Harness, personId?: string): Promise<string> => (await start(hn.ctx, { kind: "chat", agentIds: [INTAKE], ...(personId ? { personId } : {}) })).thread["threadId"] as string;
const offers = (hn: Harness) => hn.rows("SELECT * FROM chat_note_offer");

test("an agent offers a note: a card with the preview in the chat, in the contract's shape; nothing waits on it", async () => {
  const hn = world();
  const threadId = await chatOf(hn);
  const input = { threadId, ...offer };
  assert.deepEqual(contractErrors("chat.note_offer.make", "in", input), []);
  const out = await make(hn.agent(), input);
  assert.deepEqual(contractErrors("chat.note_offer.make", "out", out), []);
  assert.equal(out.offered, true);
  const msg = hn.rows("SELECT blocks, kind FROM chat_message WHERE id = ?", out.messageId!)[0]!;
  const block = (JSON.parse(String(msg["blocks"])) as { type: string; state: string; data: Record<string, unknown> }[])[0]!;
  assert.deepEqual([block.type, block.state, block.data["title"], block.data["state"]], ["note_offer", "done", "Weinberger form link", "offered"]);
  assert.equal(hn.rows("SELECT state FROM chat_block WHERE id = ?", out.blockId!)[0]!["state"], "done", "the turn does not wait on it");
});

test("the offer is not repeated: the same topic once, nothing within 15 minutes of another, nothing for a day after Not now", async () => {
  const hn = world();
  const threadId = await chatOf(hn);
  const agent = hn.agent();
  assert.equal((await make(agent, { threadId, ...offer })).offered, true);
  assert.deepEqual(await make(agent, { threadId, ...offer, topic: "  weinberger  INTAKE form " }), { offered: false, why: "already_offered" }, "the same topic, however it is written");
  assert.deepEqual(await make(agent, { threadId, title: "Another", body: "Something else", topic: "pricing decision" }), { offered: false, why: "too_soon" });
  hn.advance(TOO_SOON_MS + 1);
  const second = await make(agent, { threadId, title: "Pricing", body: "$1,500 a month", topic: "pricing decision" });
  assert.equal(second.offered, true, "a different topic, once enough time has passed");
  assert.equal(offers(hn).length, 2);
  // Not now: nothing more for a day
  await answer(hn.ctx, { threadId, blockId: second.blockId!, decision: "dismiss" });
  hn.advance(TOO_SOON_MS + 1);
  assert.deepEqual(await make(agent, { threadId, title: "Third", body: "A third thing", topic: "third topic" }), { offered: false, why: "declined_recently" });
  hn.advance(DECLINED_MS);
  assert.equal((await make(agent, { threadId, title: "Third", body: "A third thing", topic: "third topic" })).offered, true);
  assert.equal(topicKey("  A   b "), "a b");
});

test("the person's switch turns offers off: nothing is posted and the agent is told why", async () => {
  const hn = world(false);
  const threadId = await chatOf(hn);
  assert.deepEqual(await make(hn.agent(), { threadId, ...offer }), { offered: false, why: "off" });
  assert.equal(hn.rows("SELECT id FROM chat_message WHERE thread = ?", threadId).length, 0);
  assert.equal(offers(hn).length, 0);
  // a setting that cannot be read leaves offers on
  const broken = harness({ calls: { "settings.get": () => { throw new Error("down"); } } });
  assert.equal((await make(broken.agent(), { threadId: await chatOf(broken), ...offer })).offered, true);
});

test("Save makes the person's own private note, saved from this chat and the message, and the card says saved; saving twice is one note", async () => {
  const hn = world();
  const threadId = await chatOf(hn);
  const made = await make(hn.agent(), { threadId, ...offer });
  hn.clear();
  const out = await answer(hn.ctx, { threadId, blockId: made.blockId!, decision: "save" });
  assert.deepEqual(contractErrors("chat.note_offer.answer", "out", out), []);
  assert.deepEqual(out, { state: "saved", noteId: "nte_saved1" });
  const call = hn.callLog.find((c) => c.cap === "notes.create")!;
  assert.deepEqual(call.input, { title: offer.title, body: offer.body, source: { threadId, messageId: made.messageId }, idempotencyKey: `offer:${made.blockId}` }, "only what the card showed, from this chat and this message, no share");
  const data = (JSON.parse(String(hn.rows("SELECT blocks FROM chat_message WHERE id = ?", made.messageId!)[0]!["blocks"])) as { data: Record<string, unknown> }[])[0]!.data;
  assert.deepEqual([data["state"], data["noteId"]], ["saved", "nte_saved1"]);
  const again = await answer(hn.ctx, { threadId, blockId: made.blockId!, decision: "save" });
  assert.equal(again.noteId, "nte_saved1");
  assert.equal(hn.callLog.filter((c) => c.cap === "notes.create").length, 1, "the second Save made no second note");
  assert.equal(await failure(() => answer(hn.ctx, { threadId, blockId: made.blockId!, decision: "dismiss" })), "validation.precondition_failed", "Not now after Save comes too late");
});

test("in a chat other people read: the note is still the person's own and private, and only they can answer the offer", async () => {
  const hn = world();
  const threadId = await chatOf(hn, MAYA);
  const made = await make(hn.agent(INTAKE, DANA), { threadId, ...offer });
  assert.equal(made.offered, true);
  // Maya, who reads the chat, cannot save or dismiss Dana's offer
  assert.equal(await failure(() => answer(hn.person(MAYA), { threadId, blockId: made.blockId!, decision: "save" })), "validation.not_found");
  assert.equal(hn.callLog.filter((c) => c.cap === "notes.create").length, 0);
  // Dana's Save is notes.create as Dana, with no one else named
  await answer(hn.ctx, { threadId, blockId: made.blockId!, decision: "save" });
  const call = hn.callLog.find((c) => c.cap === "notes.create")!;
  assert.deepEqual(Object.keys(call.input).sort(), ["body", "idempotencyKey", "source", "title"], "no share, no people, no space");
});

test("only Vyre writes the card: an agent cannot post an offer with chat.post, a person cannot make one, and an offer needs a title, words and a topic", async () => {
  const hn = world();
  const threadId = await chatOf(hn);
  const block = { type: "note_offer", v: 1, data: { title: "x", body: "y", state: "offered" } };
  assert.equal(await failure(() => post(hn.agent(), { threadId, body: "hi", blocks: [block], idempotencyKey: "k1" } as never)), "validation.bad_input");
  assert.equal(await failure(() => make(hn.ctx, { threadId, ...offer })), "permission.no_grant");
  assert.equal(await failure(() => make(hn.agent(), { threadId, ...offer, title: " " })), "validation.bad_input");
  assert.equal(await failure(() => make(hn.agent(), { threadId, ...offer, body: "" })), "validation.bad_input");
  assert.equal(await failure(() => make(hn.agent(), { threadId, ...offer, topic: "" })), "validation.bad_input");
  assert.equal(await failure(() => make(hn.agent(), { threadId, ...offer, messageId: "msg_nope" })), "validation.not_found");
});
