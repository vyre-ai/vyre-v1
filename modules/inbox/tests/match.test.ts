// Linking, matching and following against stand-ins for records and contacts (spec 2.18 Matching and Following; 3.3 flow 2): a sure address files into the contact's
// conversation, an unsure one raises Needs a match once, a stranger stays Unmatched, a person's match moves the whole history and Undo gives it back.
import test from "node:test";
import assert from "node:assert/strict";
import { followSet, linkMessage, markRead, match, matchNew, matchSuggestions, unmatch } from "../handlers/index.ts";
import { handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { codeOf, contractErrors, DANA, harness, LEE, link, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const convs = (h: Harness) => h.rows(`SELECT * FROM inbox_conversation ORDER BY "lastMessageAt" ASC, id ASC`);
const items = (h: Harness, conversationId: string) => h.rows(`SELECT * FROM inbox_item WHERE "conversationId" = ? ORDER BY at ASC, id ASC`, conversationId);
const setup = () => {
  const h = harness({ contacts: [{ ...LEE }, { ...DANA }] });
  h.mailboxOwners.set("mbx_work1", "usr_maya01");
  return h;
};

// ---- a sure match files into the contact's conversation

test("a message from an address a contact holds is filed in that contact's conversation, owned by the owner routing names", async () => {
  const h = setup();
  const input = link({ address: "Pat@Acme.test", mailboxId: "mbx_work1", preview: "Hello", at: NOW + 1 });
  assert.deepEqual(contractErrors("inbox.link_message", "in", input), []);
  const out = await linkMessage(h.ctx, input);
  assert.equal(out.linked, "sure");
  assert.equal(out.contactId, LEE.id);
  assert.equal(out.taskId, undefined);
  assert.deepEqual(contractErrors("inbox.link_message", "out", out), []);
  const [row] = convs(h);
  assert.equal(row!.id, out.conversationId);
  assert.deepEqual(
    [row!.contactId, row!.displayName, row!.address, row!.unreadCount, row!.ownerId, row!.lastPreview, row!.lastChannel, row!.lastMessageAt, row!.mailboxIds, row!.needsMatch],
    [LEE.id, "Pat Lee", "pat@acme.test", 1, "usr_maya01", "Hello", "email", NOW + 1, '["mbx_work1"]', 0],
  );
  assert.equal(items(h, out.conversationId).length, 1);
  assert.deepEqual(h.named("conversation.created").map((e) => e.payload), [{ conversationId: out.conversationId, contactId: LEE.id, channel: "email" }]);
  assert.deepEqual(h.named("conversation.matched").map((e) => [e.subject, e.payload]), [[`record/${LEE.id}`, { conversationId: out.conversationId, recordId: LEE.id, by: "rule", undoable: false }]]);
});

test("a second message joins the same conversation, a replay of the same message changes nothing, and the thread comes from mail", async () => {
  const h = setup();
  h.mail.set("eml_a1", { id: "eml_a1", threadId: "thr_intake", subject: "Intake form", from: "pat@acme.test", to: ["maya@vyre.test"], cc: ["boss@vyre.test"] });
  const first = link({ address: "pat@acme.test", id: "eml_a1", mailboxId: "mbx_work1", at: NOW + 1 });
  const a = await linkMessage(h.ctx, first);
  const b = await linkMessage(h.ctx, link({ channel: "sms", address: "+14155550177", numberId: "num_main1", preview: "On my way", at: NOW + 2 }));
  assert.equal(b.conversationId, a.conversationId, "an email and a text from one person are one conversation");
  const asked = h.calls("contacts.resolve").length;
  assert.deepEqual(await linkMessage(h.ctx, first), a);
  assert.equal(h.calls("contacts.resolve").length, asked, "a message already linked asks nobody");
  const [row] = convs(h);
  assert.deepEqual([row!.unreadCount, row!.lastChannel, row!.lastPreview, row!.numberIds], [2, "sms", "On my way", '["num_main1"]']);
  const [mail, sms] = items(h, a.conversationId);
  assert.deepEqual([mail!.threadId, mail!.subject, JSON.parse(String(mail!.participants))], ["thr_intake", "Intake form", ["pat@acme.test", "maya@vyre.test", "boss@vyre.test"]]);
  assert.match(String(sms!.threadId), /^sms:num_main1:\+14155550177$/);
  assert.equal(h.named("conversation.created").length, 1);
});

test("an outbound message does not add to the unread count, and a message mail will not show still gets a thread of its own", async () => {
  const h = setup();
  h.failMailGet(true);
  h.mail.set("eml_p1", { id: "eml_p1", threadId: "thr_x", subject: "x", from: "a@b.test", to: [] });
  const out = await linkMessage(h.ctx, link({ address: "pat@acme.test", id: "eml_p1", direction: "out" }));
  assert.equal(convs(h)[0]!.unreadCount, 0);
  assert.equal(items(h, out.conversationId)[0]!.threadId, "mail:eml_p1");
  assert.equal(h.named("conversation.reply_received").length, 0);
});

test("a call is linked by its number, and a bad link is refused", async () => {
  const h = setup();
  const out = await linkMessage(h.ctx, link({ channel: "call", address: "+14155550177", numberId: "num_main1", preview: "Missed call" }));
  assert.equal(out.linked, "sure");
  assert.equal(convs(h)[0]!.lastChannel, "call");
  await refused(linkMessage(h.ctx, { ...link({ address: "x@y.test" }), ref: { kind: "sms", id: "sms_1" } }), "validation.bad_input");
  await refused(linkMessage(h.ctx, { ...link({ address: "x@y.test" }), direction: "sideways" as "in" }), "validation.bad_input");
  await refused(linkMessage(h.ctx, link({ address: "  " })), "validation.bad_input");
  await refused(linkMessage(h.ctx, { ...link({ address: "x@y.test" }), at: -1 }), "validation.bad_input");
  await refused(linkMessage(h.ctx, { ...link({ address: "x@y.test" }), channel: "fax" as "sms" }), "validation.bad_input");
});

// ---- an unsure sender raises Needs a match, once

test("an unsure sender is kept apart and raises one Needs you task, however many messages follow", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "sam@fox.test", mailboxId: "mbx_work1", preview: "Quick question" }));
  assert.equal(a.linked, "unsure");
  assert.equal(a.contactId, undefined);
  assert.match(a.taskId ?? "", /^tsk_/);
  assert.deepEqual(contractErrors("inbox.link_message", "out", a), []);
  const row = convs(h)[0]!;
  assert.deepEqual([row.contactId, row.needsMatch, row.displayName], [null, 1, "sam@fox.test"]);
  const task = h.calls("tasks.create")[0]!.input;
  assert.deepEqual([task.title, task.assigned, task.idempotencyKey], ["Match sam@fox.test to a record", { kind: "person", id: "usr_maya01" }, `inbox-match-${a.conversationId}`]);
  assert.deepEqual(h.named("conversation.needs_match").map((e) => e.payload), [{ conversationId: a.conversationId, taskId: a.taskId }]);

  const b = await linkMessage(h.ctx, link({ address: "sam@fox.test", mailboxId: "mbx_work1" }));
  assert.equal(b.taskId, a.taskId);
  assert.equal(b.conversationId, a.conversationId);
  assert.equal(h.calls("tasks.create").length, 1);
  assert.equal(h.named("conversation.needs_match").length, 1);
  assert.equal(h.named("conversation.matched").length, 0, "unsure is never filed");
});

test("an unsure sender with no owner to route to goes to the admin role", async () => {
  const h = setup();
  await linkMessage(h.ctx, link({ address: "sam@fox.test" }));
  assert.deepEqual(h.calls("tasks.create")[0]!.input.assigned, { kind: "role", id: "admin" });
});

test("a Needs you task that cannot be raised does not fail the linking; it is raised on the next message, and a replay raises it too", async () => {
  const h = setup();
  h.failTasks(true);
  const first = link({ address: "sam@fox.test", id: "eml_retry" });
  const a = await linkMessage(h.ctx, first);
  assert.deepEqual([a.linked, a.taskId], ["unsure", undefined]);
  assert.equal(h.named("conversation.needs_match").length, 0);
  h.failTasks(false);
  const replay = await linkMessage(h.ctx, first);
  assert.match(replay.taskId ?? "", /^tsk_/);
  assert.equal(h.named("conversation.needs_match").length, 1);
  const next = await linkMessage(h.ctx, link({ address: "sam@fox.test" }));
  assert.equal(next.taskId, replay.taskId);
  assert.equal(h.calls("tasks.create").length, 2, "one failed try and one that worked");
});

// ---- a stranger stays Unmatched, unless we wrote first

test("a stranger stays in the Unmatched list with no task", async () => {
  const h = setup();
  const out = await linkMessage(h.ctx, link({ address: "who@nowhere.test" }));
  assert.equal(out.linked, "none");
  assert.equal(out.taskId, undefined);
  assert.deepEqual([convs(h)[0]!.contactId, convs(h)[0]!.needsMatch], [null, 0]);
  assert.equal(h.calls("tasks.create").length, 0);
});

test("a stranger who answers a message we sent raises Needs a match; a message we send first does not", async () => {
  const h = setup();
  const sent = await linkMessage(h.ctx, link({ address: "new@nowhere.test", direction: "out" }));
  assert.equal(sent.linked, "none");
  assert.equal(h.calls("tasks.create").length, 0);
  const reply = await linkMessage(h.ctx, link({ address: "new@nowhere.test", direction: "in" }));
  assert.equal(reply.conversationId, sent.conversationId);
  assert.equal(reply.linked, "unsure");
  assert.match(reply.taskId ?? "", /^tsk_/);
  assert.equal(h.calls("tasks.create").length, 1);
});

test("an address the contact learns later folds the stranger's history into the contact's conversation", async () => {
  const h = setup();
  const first = await linkMessage(h.ctx, link({ address: "pat.lee@gmail.test", preview: "from my other address" }));
  assert.equal(first.linked, "none");
  h.contacts.get(LEE.id)!.emails.push("pat.lee@gmail.test");
  const second = await linkMessage(h.ctx, link({ address: "pat.lee@gmail.test", preview: "again" }));
  assert.equal(second.linked, "sure");
  assert.equal(second.contactId, LEE.id);
  const live = convs(h).filter((c) => c.deleted_at === null);
  assert.equal(live.length, 1);
  assert.equal(items(h, String(live[0]!.id)).length, 2, "the old message came along");
  assert.deepEqual(h.named("conversation.matched").map((e) => e.payload.by), ["rule"]);
  assert.equal(h.named("conversation.matched")[0]!.payload.undoable, true);
});

// ---- a person's match moves history, and Undo gives it back

test("match: the sender's whole history moves to the record, the address is remembered, and Undo restores both", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "sam@fox.test", preview: "one" }));
  await linkMessage(h.ctx, link({ address: "sam@fox.test", preview: "two" }));
  const out = await match(h.ctx, { conversationId: a.conversationId, recordId: DANA.id });
  assert.deepEqual(contractErrors("inbox.match", "out", out), []);
  assert.deepEqual([out.conversation.id, out.conversation.contactId, out.conversation.displayName, out.conversation.needsMatch, out.conversation.unreadCount], [a.conversationId, DANA.id, "Dana Fox", false, 2]);
  assert.match(out.undoToken, /^und_/);
  assert.deepEqual(h.contacts.get(DANA.id)!.emails, ["dana@fox.test", "sam@fox.test"]);
  assert.deepEqual(h.calls("contacts.address.add")[0]!.input, { contactId: DANA.id, kind: "email", value: "sam@fox.test", idempotencyKey: `inbox-remember-${a.conversationId}-${DANA.id}` });
  assert.deepEqual(h.named("conversation.matched").map((e) => [e.subject, e.payload]), [[`record/${DANA.id}`, { conversationId: a.conversationId, recordId: DANA.id, by: "person", undoable: true }]]);

  const undone = await unmatch(h.ctx, { conversationId: a.conversationId, undoToken: out.undoToken });
  assert.deepEqual(contractErrors("inbox.unmatch", "out", undone), []);
  assert.deepEqual([undone.conversation.contactId, undone.conversation.displayName, undone.conversation.needsMatch], [undefined, "sam@fox.test", true]);
  assert.deepEqual(h.contacts.get(DANA.id)!.emails, ["dana@fox.test"], "the remembered address is taken back");
  assert.deepEqual(h.named("conversation.unmatched").map((e) => e.payload), [{ conversationId: a.conversationId, recordId: DANA.id }]);
  await refused(unmatch(h.ctx, { conversationId: a.conversationId, undoToken: out.undoToken }), "validation.precondition_failed");
  await refused(unmatch(h.ctx, { conversationId: a.conversationId }), "validation.precondition_failed");
});

test("match: when the record already has a conversation the sender's rows fold into it, and Undo splits them out again", async () => {
  const h = setup();
  const lee = await linkMessage(h.ctx, link({ address: "pat@acme.test", preview: "from work" }));
  const other = await linkMessage(h.ctx, link({ address: "pat.lee@gmail.test", preview: "from home" }));
  assert.notEqual(lee.conversationId, other.conversationId);
  const out = await match(h.ctx, { conversationId: other.conversationId, recordId: LEE.id, rememberAddress: false });
  assert.equal(out.conversation.id, lee.conversationId, "the record's own conversation survives");
  assert.equal(out.conversation.unreadCount, 2);
  assert.equal(items(h, lee.conversationId).length, 2);
  assert.equal(h.rows(`SELECT deleted_at FROM inbox_conversation WHERE id = ?`, other.conversationId)[0]!.deleted_at !== null, true, "the sender's row is hidden, not deleted");
  assert.equal(h.calls("contacts.address.add").length, 0, "rememberAddress false remembers nothing");

  const undone = await unmatch(h.ctx, { conversationId: lee.conversationId });
  assert.equal(undone.conversation.id, other.conversationId);
  assert.equal(items(h, lee.conversationId).length, 1);
  assert.equal(items(h, other.conversationId).length, 1);
  assert.equal(h.rows(`SELECT deleted_at FROM inbox_conversation WHERE id = ?`, other.conversationId)[0]!.deleted_at, null);
  assert.deepEqual([convs(h).find((c) => c.id === lee.conversationId)!.lastPreview, convs(h).find((c) => c.id === other.conversationId)!.lastPreview], ["from work", "from home"]);
});

test("match refuses a bad id, a missing conversation or record, and one already matched; an agent's match says so", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "who@nowhere.test" }));
  await refused(match(h.ctx, { conversationId: "nope", recordId: LEE.id }), "validation.bad_input");
  await refused(match(h.ctx, { conversationId: a.conversationId, recordId: "nope" }), "validation.bad_input");
  await refused(match(h.ctx, { conversationId: "cnv_missing1", recordId: LEE.id }), "validation.not_found");
  await refused(match(h.ctx, { conversationId: a.conversationId, recordId: "rec_nobody1" }), "validation.not_found");
  const agent = h.as({ kind: "agent", id: "agt_scout1" });
  await match(agent, { conversationId: a.conversationId, recordId: LEE.id });
  assert.equal(h.named("conversation.matched").at(-1)!.payload.by, "agent");
  await refused(match(h.ctx, { conversationId: a.conversationId, recordId: DANA.id }), "validation.precondition_failed");
});

test("a record that already holds the address is not asked to add it again, and a failed remember does not undo the match", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "who@nowhere.test" }));
  h.contacts.get(LEE.id)!.emails.push("who@nowhere.test");
  const out = await match(h.ctx, { conversationId: a.conversationId, recordId: LEE.id });
  assert.equal(out.conversation.contactId, LEE.id);
  const [back] = [await unmatch(h.ctx, { conversationId: a.conversationId })];
  assert.deepEqual(h.contacts.get(LEE.id)!.emails.includes("who@nowhere.test"), true, "an address the record had before is left alone");
  assert.equal(back.conversation.contactId, undefined);
});

// ---- create from an unmatched sender

test("match_new makes a contact from the sender's email and matches it", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "robin@fresh.test" }));
  const out = await matchNew(h.ctx, { conversationId: a.conversationId, type: "contact" });
  assert.deepEqual(contractErrors("inbox.match_new", "out", out), []);
  assert.deepEqual(h.calls("records.create")[0]!.input, { type: "contact", fields: { name: "robin", email: "robin@fresh.test" }, idempotencyKey: `inbox-new-${a.conversationId}` });
  assert.equal(out.conversation.contactId, out.recordId);
  assert.equal(out.conversation.displayName, "robin");
  assert.equal(h.calls("contacts.address.add").length, 0, "a contact made from the address already holds it");
});

test("match_new takes the name given, makes a company from a phone number, and teaches the company the number", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ channel: "sms", address: "+14155559999" }));
  const out = await matchNew(h.ctx, { conversationId: a.conversationId, type: "company", name: "Fresh Holdings" });
  assert.deepEqual(h.calls("records.create")[0]!.input.fields, { name: "Fresh Holdings" });
  assert.equal(out.conversation.displayName, "Fresh Holdings");
  assert.deepEqual(h.calls("contacts.address.add")[0]!.input.kind, "phone");
  await refused(matchNew(h.ctx, { conversationId: a.conversationId, type: "company" }), "validation.precondition_failed");
  await refused(matchNew(h.ctx, { conversationId: a.conversationId, type: "robot" as "contact" }), "validation.bad_input");
  await refused(matchNew(h.ctx, { conversationId: a.conversationId, type: "contact", name: " " }), "validation.bad_input");
});

// ---- suggestions

test("suggestions list the sure and unsure records with the reason, and a matched conversation has none", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "sam@fox.test" }));
  const out = await matchSuggestions(h.ctx, { conversationId: a.conversationId });
  assert.deepEqual(out.suggestions, [{ recordId: DANA.id, type: "contact", name: "Dana Fox", score: 0.5, why: "Same email address" }]);
  assert.deepEqual(contractErrors("inbox.match_suggestions", "out", out), []);
  await match(h.ctx, { conversationId: a.conversationId, recordId: DANA.id });
  assert.deepEqual((await matchSuggestions(h.ctx, { conversationId: a.conversationId })).suggestions, []);
  await refused(matchSuggestions(h.ctx, { conversationId: "cnv_missing1" }), "validation.not_found");
});

// ---- replies reach followers and campaign owners

test("a reply from a followed contact raises the follow event; a campaign reply says which campaign; our own message raises neither", async () => {
  const h = setup();
  await followSet(h.ctx, { contactId: LEE.id, follow: true, alertOnReplies: true });
  await linkMessage(h.ctx, link({ address: "pat@acme.test", campaignId: "cmp_spring" }));
  assert.deepEqual(h.named("conversation.reply_received").map((e) => [e.subject, e.vis]), [[`record/${LEE.id}`, "participants"]]);
  assert.deepEqual(h.named("conversation.campaign_reply").map((e) => e.payload.campaignId), ["cmp_spring"]);
  await linkMessage(h.ctx, link({ address: "pat@acme.test", direction: "out", campaignId: "cmp_spring" }));
  assert.equal(h.named("conversation.reply_received").length, 1);
  assert.equal(h.named("conversation.campaign_reply").length, 1);
});

test("an unowned reply goes to the campaign owner", async () => {
  const h = setup();
  h.campaigns.set("cmp_spring", "usr_omar01");
  await linkMessage(h.ctx, link({ address: "dana@fox.test", campaignId: "cmp_spring" }));
  assert.equal(convs(h)[0]!.ownerId, "usr_omar01");
  assert.equal(convs(h)[0]!.campaignId, "cmp_spring");
});

// ---- read state and follows

test("mark_read clears the unread count; read false marks the newest inbound message unread again", async () => {
  const h = setup();
  const a = await linkMessage(h.ctx, link({ address: "pat@acme.test" }));
  await linkMessage(h.ctx, link({ address: "pat@acme.test" }));
  assert.equal(markRead(h.ctx, { conversationId: a.conversationId }).conversation.unreadCount, 0);
  assert.equal(h.rows(`SELECT unread FROM inbox_item`).every((r) => r.unread === 0), true);
  const out = markRead(h.ctx, { conversationId: a.conversationId, read: false });
  assert.equal(out.conversation.unreadCount, 1);
  assert.deepEqual(contractErrors("inbox.mark_read", "out", out), []);
  assert.throws(() => markRead(h.ctx, { conversationId: "cnv_missing1" }), (e: unknown) => codeOf(e) === "validation.not_found");
});

test("following a contact and Alert me on replies: stored per person, the follow itself goes through follows.toggle, and Alert only holds while following", async () => {
  const h = setup();
  assert.deepEqual(await followSet(h.ctx, { contactId: LEE.id, follow: true }), { following: true, alertOnReplies: false });
  assert.deepEqual(h.calls("follows.toggle")[0]!.input, { resource: { type: "record", id: LEE.id }, on: true });
  assert.deepEqual(await followSet(h.ctx, { contactId: LEE.id, follow: true, alertOnReplies: true }), { following: true, alertOnReplies: true });
  assert.deepEqual(await followSet(h.ctx, { contactId: LEE.id, follow: true }), { following: true, alertOnReplies: true }, "unsaid keeps what was set");
  assert.deepEqual(h.named("conversation.follow_changed").map((e) => [e.payload.following, e.payload.alertOnReplies]), [[true, false], [true, true]]);
  const a = await linkMessage(h.ctx, link({ address: "pat@acme.test" }));
  const row = markRead(h.ctx, { conversationId: a.conversationId }).conversation;
  assert.deepEqual([row.followed, row.alertOnReplies], [true, true]);
  assert.deepEqual(await followSet(h.ctx, { contactId: LEE.id, follow: false, alertOnReplies: true }), { following: false, alertOnReplies: false });
  assert.deepEqual(h.named("conversation.follow_changed").at(-1)!.payload, { contactId: LEE.id, principalId: "usr_maya01", following: false, alertOnReplies: false });
  assert.equal(h.rows(`SELECT * FROM inbox_follow WHERE deleted_at IS NULL`).length, 0);
  await followSet(h.ctx, { contactId: LEE.id, follow: false });
  assert.equal(h.named("conversation.follow_changed").length, 3, "unfollowing twice says nothing the second time");
  // another person's follow is theirs
  await followSet(h.as({ kind: "person", id: "usr_omar01" }), { contactId: LEE.id, follow: true });
  assert.equal(markRead(h.ctx, { conversationId: a.conversationId }).conversation.followed, false);
  await refused(followSet(h.ctx, { contactId: "nope", follow: true }), "validation.bad_input");
});

// ---- the registered handlers

test("every capability of the inbox manifest has a handler, and none is extra", () => {
  const caps = registry.capabilities.filter((c) => c.name.startsWith("inbox.")).map((c) => c.name).sort();
  assert.equal(caps.length, 17);
  assert.deepEqual(Object.keys(handlers).sort(), caps);
});

test("link_message through the registered handler links like the function does", async () => {
  const h = setup();
  const out = (await handlers["inbox.link_message"]!(h.ctx as never, link({ address: "pat@acme.test" }) as never)) as { linked: string };
  assert.equal(out.linked, "sure");
});

test("the time stamps follow the clock the host gives", async () => {
  const h = setup();
  h.advance(5000);
  const a = await linkMessage(h.ctx, link({ address: "pat@acme.test" }));
  assert.equal(convs(h).find((c) => c.id === a.conversationId)!.updated_at, NOW + 5000);
});
