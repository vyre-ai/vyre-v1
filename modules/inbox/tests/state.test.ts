// The Inbox on per-person state (contract P2, step 4): in a shared inbox each person has their own unread, Done hides a conversation for one person only, a new inbound item brings it back for a
// person who had marked it done (and their own reply does not), and a merge or an Undo keeps each person's place. The people here are invented; the data is a real SQLite behind the host's guard.
import test from "node:test";
import assert from "node:assert/strict";
import {
  counts,
  linkMessage,
  listByContact,
  listByThread,
  markRead,
  match,
  thread,
  unmatch,
  unmatched,
} from "../handlers/index.ts";
import { rawDbOf } from "../../../host/src/ctx/db.ts";
import { harness, LEE, link } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { readSeam, thingOf } from "../state.ts";

const MAYA = "usr_maya01";
const JONAS = "usr_jonas1";
const OMAR = "usr_omar01";
const person = (id: string) => ({ kind: "person" as const, id });
const SHARED = "mbx_shared";

function setup(): Harness {
  return harness({ contacts: [{ ...LEE }], people: [MAYA, JONAS, OMAR] });
}
const inbound = (h: Harness, n = 1) =>
  (async () => {
    let out = { conversationId: "" };
    for (let i = 0; i < n; i++) out = await linkMessage(h.ctx, link({ address: "pat@acme.test", mailboxId: SHARED }));
    return out.conversationId;
  })();
const rowsFor = async (h: Harness, who: string) =>
  (await listByContact(h.as(person(who)), {})).rows.map((r) => [r.id, r.unreadCount] as const);
const stateOf = (h: Harness, who: string, id: string) => readSeam(h.ctx).stateOf(who, [thingOf(id)])[0]!;

test("in a shared inbox each person has their own unread: Maya reading does not read it for Jonas", async () => {
  const h = setup();
  const id = await inbound(h, 2);
  assert.deepEqual(await rowsFor(h, MAYA), [[id, 2]]);
  assert.deepEqual(await rowsFor(h, JONAS), [[id, 2]]);
  assert.equal(markRead(h.as(person(MAYA)), { conversationId: id }).conversation.unreadCount, 0);
  assert.deepEqual(await rowsFor(h, MAYA), [[id, 0]]);
  assert.deepEqual(await rowsFor(h, JONAS), [[id, 2]], "Jonas still has both unread");
  const mine = await counts(h.as(person(MAYA)));
  const his = await counts(h.as(person(JONAS)));
  assert.equal(mine.total, 0);
  assert.equal(his.total, 2);
  assert.deepEqual(his.byInbox, [{ kind: "mailbox", id: SHARED, unread: 2 }]);
  assert.deepEqual(mine.byInbox, []);
  // and by thread and in the conversation itself
  const byThread = async (who: string) =>
    (await listByThread(h.as(person(who)), {})).threads.reduce((n, t) => n + t.unread, 0);
  assert.equal(await byThread(MAYA), 0);
  assert.equal(await byThread(JONAS), 2);
  assert.equal((await thread(h.as(person(JONAS)), { conversationId: id })).conversation.unreadCount, 2);
});

test("marking it unread again is the person's own too", async () => {
  const h = setup();
  const id = await inbound(h, 2);
  markRead(h.as(person(MAYA)), { conversationId: id });
  markRead(h.as(person(JONAS)), { conversationId: id });
  assert.equal(markRead(h.as(person(MAYA)), { conversationId: id, read: false }).conversation.unreadCount, 1);
  assert.deepEqual(await rowsFor(h, JONAS), [[id, 0]]);
});

test("marking done hides a conversation from Open for one person only", async () => {
  const h = setup();
  const id = await inbound(h);
  readSeam(h.ctx).set(MAYA, thingOf(id), { done: true }, { trusted: true });
  assert.deepEqual(await rowsFor(h, MAYA), [], "gone from her By contact list");
  assert.deepEqual(await rowsFor(h, JONAS), [[id, 1]]);
  assert.equal((await listByThread(h.as(person(MAYA)), {})).threads.length, 0);
  assert.equal((await listByThread(h.as(person(JONAS)), {})).threads.length, 1);
  assert.equal((await counts(h.as(person(MAYA)))).total, 0, "a done conversation is not in her badge");
  assert.equal((await counts(h.as(person(JONAS)))).total, 1);
  // it is still there to open: the record's own Conversation tab asks for it by contact
  assert.equal((await thread(h.as(person(MAYA)), { contactId: LEE.id })).conversation.id, id);
});

test("a new inbound message brings it back for a person who had marked it done; their own reply does not", async () => {
  const h = setup();
  const id = await inbound(h);
  markRead(h.as(person(MAYA)), { conversationId: id });
  readSeam(h.ctx).set(MAYA, thingOf(id), { done: true }, { trusted: true });
  await linkMessage(h.as(person(MAYA)), link({ address: "pat@acme.test", direction: "out", mailboxId: SHARED }));
  assert.deepEqual(await rowsFor(h, MAYA), [], "her own reply leaves it done");
  assert.notEqual(stateOf(h, MAYA, id).done, null);
  await linkMessage(h.ctx, link({ address: "pat@acme.test", mailboxId: SHARED }));
  assert.deepEqual(await rowsFor(h, MAYA), [[id, 1]], "the new message brings it back");
  assert.equal(stateOf(h, MAYA, id).done, null);
});

test("a reply Maya sends changes nobody's unread, her own included", async () => {
  const h = setup();
  const id = await inbound(h, 2);
  await linkMessage(h.as(person(MAYA)), link({ address: "pat@acme.test", direction: "out", mailboxId: SHARED }));
  assert.deepEqual(await rowsFor(h, MAYA), [[id, 2]]);
  assert.deepEqual(await rowsFor(h, JONAS), [[id, 2]]);
});

test("someone who cannot open the shared inbox has no unread and does not see the conversation", async () => {
  const h = setup();
  h.hideFrom(OMAR, { type: "mailbox", id: SHARED });
  const id = await inbound(h);
  assert.equal(stateOf(h, OMAR, id).unread, 0);
  assert.equal(
    rawDbOf(h.ctx.db)!.all(`SELECT 1 FROM state_person WHERE person = 'usr_omar01'`).length,
    0,
    "no row was made for him",
  );
  assert.equal(stateOf(h, MAYA, id).unread, 1);
  assert.equal(stateOf(h, JONAS, id).unread, 1);
});

test("a message filed twice counts once", async () => {
  const h = setup();
  const once = link({ address: "pat@acme.test", mailboxId: SHARED });
  await linkMessage(h.ctx, once);
  await linkMessage(h.ctx, once);
  const id = (await listByContact(h.ctx, {})).rows[0]!.id;
  assert.equal(stateOf(h, MAYA, id).unread, 1);
  assert.equal(stateOf(h, JONAS, id).unread, 1);
});

test("a missed call is unread by the same rule and clears with its conversation", async () => {
  const h = harness({ contacts: [{ ...LEE }], people: [MAYA, JONAS] });
  await linkMessage(h.ctx, link({ channel: "call", address: "+14155550177", numberId: "num_main1" }));
  const id = (await listByContact(h.ctx, {})).rows[0]!.id;
  assert.equal(stateOf(h, JONAS, id).unread, 1);
  markRead(h.as(person(JONAS)), { conversationId: id });
  assert.equal(stateOf(h, JONAS, id).unread, 0);
  assert.equal(stateOf(h, MAYA, id).unread, 1, "Maya's missed call is still hers");
});

test("a match that folds a sender into a contact keeps each person's place, and Undo gives it back", async () => {
  const h = harness({ contacts: [{ ...LEE }], people: [MAYA, JONAS] });
  const known = (await linkMessage(h.ctx, link({ address: "pat@acme.test", mailboxId: SHARED }))).conversationId;
  // a second address of Pat's writes first as a stranger, with two messages
  const stranger = (await linkMessage(h.ctx, link({ address: "pat@elsewhere.test", mailboxId: SHARED })))
    .conversationId;
  await linkMessage(h.ctx, link({ address: "pat@elsewhere.test", mailboxId: SHARED }));
  assert.notEqual(stranger, known);
  // Jonas has read everything; Maya has read nothing
  markRead(h.as(person(JONAS)), { conversationId: known });
  markRead(h.as(person(JONAS)), { conversationId: stranger });
  const matched = await match(h.ctx, { conversationId: stranger, recordId: LEE.id });
  assert.equal(matched.conversation.id, known, "folded into Pat's own conversation");
  assert.equal(stateOf(h, MAYA, known).unread, 3, "Maya: the one that was there and the two that came in");
  assert.equal(stateOf(h, JONAS, known).unread, 0, "Jonas had read both threads, so the merged one is read");
  assert.equal(
    rawDbOf(h.ctx.db)!.all(`SELECT 1 FROM state_person WHERE id = '${stranger}'`).length,
    0,
    "nothing is left on the folded conversation",
  );
  assert.deepEqual(await rowsFor(h, MAYA), [[known, 3]]);
  const back = await unmatch(h.ctx, { conversationId: known, undoToken: matched.undoToken });
  assert.equal(back.conversation.id, stranger);
  assert.equal(stateOf(h, MAYA, stranger).unread, 2, "Maya's two come back with the stranger");
  assert.equal(stateOf(h, MAYA, known).unread, 1);
  assert.equal(stateOf(h, JONAS, stranger).unread, 0);
  assert.equal(stateOf(h, JONAS, known).unread, 0);
});

test("Unmatched and Needs a match hide what the person marked done, for that person only", async () => {
  const h = harness({ people: [MAYA, JONAS] });
  const a = await linkMessage(h.ctx, link({ address: "who@nowhere.test", mailboxId: SHARED }));
  readSeam(h.ctx).set(MAYA, thingOf(a.conversationId), { done: true }, { trusted: true });
  assert.equal((await unmatched(h.as(person(MAYA)), {})).rows.length, 0);
  assert.equal((await unmatched(h.as(person(JONAS)), {})).rows.length, 1);
});
