// A thread belongs to everyone on it (owner, 3 Nov, live case anonymised): Andrey sends "Welcome to Scout, Josh" to Josh with you on Cc, Josh replies. Under
// Andrey and under Josh the same thread shows whole, with both messages, and its read state is shared. inbox.threads gives an agent the same threads.
import test from "node:test";
import assert from "node:assert/strict";
import { linkMessage, markRead } from "../handlers/match.ts";
import { listByContact, thread, threads } from "../handlers/views.ts";
import { codeOf, contractErrors, harness, link, NOW } from "../fixtures/harness.ts";
import type { Contact } from "../fixtures/harness.ts";

const IRFAD = "irfad@northwind.test", JOSH_AT = "josh@cohenshah.test", ANDREY_AT = "andrey@scout.test";
const JOSH: Contact = { id: "rec_josh01", type: "contact", name: "Josh Cohen", emails: [JOSH_AT], phones: [], owner: "usr_maya01" };
const ANDREY: Contact = { id: "rec_andrey1", type: "contact", name: "Andrey Volkov", emails: [ANDREY_AT], phones: [], owner: "usr_maya01" };
const SUBJECT = "Welcome to Scout, Josh";

function setup() {
  return harness({
    contacts: [JOSH, ANDREY],
    mail: [
      { id: "eml_w1", threadId: "thr_scout", subject: SUBJECT, from: ANDREY_AT, to: [JOSH_AT], cc: [IRFAD], body: "Welcome to Scout. Your workspace is ready.", at: NOW, role: "cc" },
      { id: "eml_w2", threadId: "thr_scout", subject: `RE: ${SUBJECT}`, from: JOSH_AT, to: [ANDREY_AT], cc: [IRFAD], body: "Thanks Andrey. I am in and the team is set up.", at: NOW + 60_000, role: "cc" },
    ],
  });
}

const email = (address: string, id: string, at: number, participants: string[]) => ({ ...link({ address, id, at }), threadId: "thr_scout", subject: SUBJECT, participants });

async function scout(h: ReturnType<typeof setup>) {
  const a = await linkMessage(h.ctx, email(ANDREY_AT, "eml_w1", NOW, [ANDREY_AT, JOSH_AT, IRFAD]));
  const j = await linkMessage(h.ctx, email(JOSH_AT, "eml_w2", NOW + 60_000, [JOSH_AT, ANDREY_AT, IRFAD]));
  return { andreyConv: a.conversationId, joshConv: j.conversationId };
}

test("Andrey's message files under Andrey and Josh's reply under Josh, and each of them is on the other's email too", async () => {
  const h = setup();
  const { andreyConv, joshConv } = await scout(h);
  assert.notEqual(andreyConv, joshConv);
  assert.deepEqual(h.rows(`SELECT "itemId", "contactId" FROM inbox_party`).map((r) => `${r.itemId} ${r.contactId}`).sort(), ["mail_message:eml_w1 rec_josh01", "mail_message:eml_w2 rec_andrey1"]);
  // the flat history of each contact has both messages too
  for (const contactId of [JOSH.id, ANDREY.id]) {
    const t = await thread(h.ctx, { contactId });
    assert.deepEqual(t.items.map((i) => i.id), ["eml_w1", "eml_w2"]);
  }
  const rows = await listByContact(h.ctx, {});
  assert.deepEqual(rows.rows.map((r) => [r.displayName, r.unreadCount]).sort(), [["Andrey Volkov", 2], ["Josh Cohen", 2]]);
});

test("the same thread shows in full under both contacts: one thread, both messages, each sender named", async () => {
  const h = setup();
  await scout(h);
  for (const contactId of [JOSH.id, ANDREY.id]) {
    const out = await threads(h.ctx, { contactId });
    assert.deepEqual(contractErrors("inbox.threads", "out", out), []);
    assert.equal(out.threads.length, 1, contactId);
    const t = out.threads[0]!;
    assert.equal(t.threadId, "thr_scout");
    assert.equal(t.subject, SUBJECT);
    assert.equal(t.role, "cc");
    assert.deepEqual(t.messages.map((m) => [m.message.id, (m.message.from as { address: string }).address]), [["eml_w1", ANDREY_AT], ["eml_w2", JOSH_AT]]);
    assert.deepEqual([t.messageCount, t.unread], [2, 2]);
  }
});

test("read under one contact is read under the other", async () => {
  const h = setup();
  const { andreyConv } = await scout(h);
  markRead(h.ctx, { conversationId: (await threads(h.ctx, { contactId: JOSH.id })).conversation.id });
  const underAndrey = await threads(h.ctx, { contactId: ANDREY.id });
  assert.deepEqual(underAndrey.threads[0]!.messages.map((m) => m.unread), [false, false]);
  assert.equal(h.rows(`SELECT "unreadCount" FROM inbox_conversation WHERE id = ?`, andreyConv)[0]!.unreadCount, 0);
});

test("threads come newest first, page by cursor, and a thread mail will not read is left out", async () => {
  const h = setup();
  h.mail.set("eml_o1", { id: "eml_o1", threadId: "thr_old", subject: "Intake form", from: JOSH_AT, to: [IRFAD], body: "Here it is.", at: NOW - 86_400_000 });
  await linkMessage(h.ctx, { ...link({ address: JOSH_AT, id: "eml_o1", at: NOW - 86_400_000 }), threadId: "thr_old", subject: "Intake form", participants: [JOSH_AT, IRFAD] });
  await scout(h);
  const all = await threads(h.ctx, { contactId: JOSH.id });
  assert.deepEqual(all.threads.map((t) => t.threadId), ["thr_scout", "thr_old"]);
  const one = await threads(h.ctx, { contactId: JOSH.id, limit: 1 });
  assert.deepEqual([one.threads.map((t) => t.threadId), one.next, one.total], [["thr_scout"], "1", 2]);
  const two = await threads(h.ctx, { contactId: JOSH.id, limit: 1, cursor: one.next ?? "" });
  assert.deepEqual(two.threads.map((t) => t.threadId), ["thr_old"]);
  h.mail.delete("eml_o1");
  assert.deepEqual((await threads(h.ctx, { contactId: JOSH.id })).threads.map((t) => t.threadId), ["thr_scout"]);
});

test("a conversation or contact is needed, and one the caller may not see is not found", async () => {
  const h = setup();
  await scout(h);
  await assert.rejects(threads(h.ctx, {}), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(threads(h.ctx, { contactId: "rec_nobody1" }), (e) => codeOf(e) === "validation.not_found");
  const conv = (await threads(h.ctx, { contactId: JOSH.id })).conversation.id;
  h.denied.add(`conversation:${conv}`);
  await assert.rejects(threads(h.ctx, { contactId: JOSH.id }), (e) => codeOf(e) === "permission.not_found");
});
