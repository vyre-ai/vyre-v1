// The Inbox views against linked conversations (spec 2.18 Views, Following, Recipients; 3.3): By contact, By thread, Calls only, one contact's whole history, Unmatched,
// Needs a match, counts, who reaches you, sending options and the recipient search. What a person sees is what they own, follow, run the campaign of, or reach through an
// inbox they can see, and the kernel lets them see.
import test from "node:test";
import assert from "node:assert/strict";
import {
  counts, followSet, following, linkMessage, listByContact, listByThread, needsMatch, recipientsSearch, sendOptions, thread, unmatched,
} from "../handlers/index.ts";
import { codeOf, contractErrors, DANA, harness, HOUR, LEE, link, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const MBX = [
  { id: "mbx_work1", kind: "personal", address: "maya@vyre.test", title: "Maya", provider: "google", privacy: "private", state: "syncing" },
  { id: "mbx_hello1", kind: "shared", address: "hello@vyre.test", title: "Hello", provider: "google", privacy: "space", state: "syncing" },
  { id: "mbx_old001", kind: "shared", address: "old@vyre.test", title: "Old", provider: "imap", privacy: "space", state: "paused" },
] as const;

interface World {
  h: Harness;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  c5: string;
}

/** Five conversations: Pat Lee (email and text, owned), a stranger, an unsure sender, Dana Fox (a call on a number the caller cannot see), and a stranger in an inbox they cannot see. */
async function world(): Promise<World> {
  const h = harness({
    contacts: [{ ...LEE }, { ...DANA, phones: ["+14155550188"] }], mailboxes: [...MBX],
    numbers: [{ id: "num_main1", e164: "+14155550123", state: "active", capabilities: ["voice", "sms"] }, { id: "num_voice", e164: "+14155550124", state: "active", capabilities: ["voice"] }],
  });
  h.mailboxOwners.set("mbx_work1", "usr_maya01");
  h.mailboxOwners.set("mbx_other1", "usr_omar01");
  h.denied.add("mailbox:mbx_other1");
  h.denied.add("number:num_hidden");
  h.mail.set("eml_lee1", { id: "eml_lee1", threadId: "thr_intake", subject: "Intake form", from: "pat@acme.test", to: ["maya@vyre.test"] });
  h.mail.set("eml_lee2", { id: "eml_lee2", threadId: "thr_intake", subject: "Re: Intake form", from: "maya@vyre.test", to: ["pat@acme.test"] });
  h.mail.set("eml_who1", { id: "eml_who1", threadId: "thr_who", subject: "Do you take cases?", from: "who@nowhere.test", to: ["hello@vyre.test"] });
  h.mail.set("eml_sam1", { id: "eml_sam1", threadId: "thr_sam", subject: "Quick question", from: "sam@fox.test", to: ["maya@vyre.test"] });
  h.mail.set("eml_ghost", { id: "eml_ghost", threadId: "thr_ghost", subject: "Secret", from: "ghost@x.test", to: ["x@vyre.test"] });
  const t = NOW;
  const c1 = (await linkMessage(h.ctx, link({ address: "pat@acme.test", id: "eml_lee1", mailboxId: "mbx_work1", at: t + 1 * HOUR, preview: "Intake form" }))).conversationId;
  await linkMessage(h.ctx, link({ address: "pat@acme.test", id: "eml_lee2", mailboxId: "mbx_work1", direction: "out", at: t + 2 * HOUR, preview: "Re: Intake form" }));
  await linkMessage(h.ctx, link({ channel: "sms", address: "+14155550177", numberId: "num_main1", at: t + 7 * HOUR, preview: "On my way" }));
  const c2 = (await linkMessage(h.ctx, link({ address: "who@nowhere.test", id: "eml_who1", mailboxId: "mbx_hello1", at: t + 3 * HOUR, preview: "Do you take cases?" }))).conversationId;
  const c3 = (await linkMessage(h.ctx, link({ address: "sam@fox.test", id: "eml_sam1", mailboxId: "mbx_work1", at: t + 4 * HOUR, preview: "Quick question" }))).conversationId;
  const c4 = (await linkMessage(h.ctx, link({ channel: "call", address: "+14155550188", numberId: "num_hidden", at: t + 5 * HOUR, preview: "Missed call" }))).conversationId;
  const c5 = (await linkMessage(h.ctx, link({ address: "ghost@x.test", id: "eml_ghost", mailboxId: "mbx_other1", at: t + 6 * HOUR, preview: "Secret" }))).conversationId;
  return { h, c1, c2, c3, c4, c5 };
}
const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id);

// ---- By contact

test("By contact lists the conversations that reach you, newest message first, and says what is showing", async () => {
  const { h, c1, c2, c3 } = await world();
  const out = await listByContact(h.ctx, {});
  assert.deepEqual(contractErrors("inbox.list_by_contact", "out", out), []);
  assert.deepEqual(ids(out.rows), [c1, c3, c2], "the call on a hidden number and the stranger in a hidden inbox do not reach this person");
  assert.equal(out.showing, "Showing all conversations");
  assert.equal(out.total, 3);
  assert.equal(out.rows[0]!.displayName, "Pat Lee");
  assert.deepEqual([out.rows[0]!.lastChannel, out.rows[0]!.lastPreview, out.rows[0]!.unreadCount], ["sms", "On my way", 2]);
});

test("a contact you follow reaches you through any inbox, and the kernel can still hide a conversation", async () => {
  const { h, c1, c2, c3, c4 } = await world();
  await followSet(h.ctx, { contactId: DANA.id, follow: true, alertOnReplies: true });
  const out = await listByContact(h.ctx, {});
  assert.deepEqual(ids(out.rows), [c1, c4, c3, c2]);
  assert.equal(out.rows[1]!.followed, true);
  h.denied.add(`conversation:${c2}`);
  assert.deepEqual(ids((await listByContact(h.ctx, {})).rows), [c1, c4, c3]);
});

test("the filters narrow by channel, inbox, number, Needs a match and text, and the header words follow", async () => {
  const { h, c1, c2, c3 } = await world();
  assert.deepEqual(ids((await listByContact(h.ctx, { channel: "sms" })).rows), [c1]);
  assert.equal((await listByContact(h.ctx, { channel: "sms" })).showing, "Showing Texts");
  assert.deepEqual(ids((await listByContact(h.ctx, { mailboxId: "mbx_work1" })).rows), [c1, c3]);
  assert.deepEqual(ids((await listByContact(h.ctx, { numberId: "num_main1" })).rows), [c1]);
  const need = await listByContact(h.ctx, { needsMatch: true });
  assert.deepEqual(ids(need.rows), [c3]);
  assert.equal(need.showing, "Showing Needs a match");
  assert.deepEqual(ids((await listByContact(h.ctx, { needsMatch: false })).rows), [c1, c2]);
  const q = await listByContact(h.ctx, { query: " PAT ", channel: "email", mailboxId: "mbx_work1" });
  assert.deepEqual(ids(q.rows), [c1]);
  assert.equal(q.showing, 'Showing Emails, one inbox, matching "PAT"');
  assert.deepEqual((await listByContact(h.ctx, { query: "nobody here" })).rows, []);
});

test("Calls only: the calls filter lists the conversations that have a call, and By thread has no call threads", async () => {
  const { h, c4 } = await world();
  await followSet(h.ctx, { contactId: DANA.id, follow: true });
  const out = await listByContact(h.ctx, { channel: "call" });
  assert.deepEqual(ids(out.rows), [c4]);
  assert.equal(out.showing, "Showing Calls");
  const threads = await listByThread(h.ctx, { channel: "call" });
  assert.deepEqual(threads.threads, []);
  assert.equal(threads.showing, "Showing Calls");
});

test("lists page by cursor with a total, and refuse a bad cursor or limit", async () => {
  const { h, c1, c3, c2 } = await world();
  const one = await listByContact(h.ctx, { limit: 2 });
  assert.deepEqual([ids(one.rows), one.next, one.total], [[c1, c3], "2", 3]);
  const two = await listByContact(h.ctx, { limit: 2, cursor: one.next as string });
  assert.deepEqual([ids(two.rows), two.next], [[c2], undefined]);
  await refused(listByContact(h.ctx, { cursor: "x" }), "validation.bad_input");
  await refused(listByContact(h.ctx, { limit: 0 }), "validation.bad_input");
  await refused(listByContact(h.ctx, { channel: "fax" as "sms" }), "validation.bad_input");
});

// ---- By thread

test("By thread lists one row per email or text thread with its subject, people and unread count", async () => {
  const { h, c1, c2 } = await world();
  const out = await listByThread(h.ctx, {});
  assert.deepEqual(contractErrors("inbox.list_by_thread", "out", out), []);
  assert.deepEqual(out.threads.map((t) => t.threadId), ["sms:num_main1:+14155550177", "thr_sam", "thr_who", "thr_intake"]);
  assert.equal(out.showing, "Showing all threads");
  const intake = out.threads.find((t) => t.threadId === "thr_intake")!;
  assert.deepEqual(
    [intake.channel, intake.subject, intake.mailboxId, intake.lastAt, intake.participants, intake.unread, intake.contactId],
    ["email", "Intake form", "mbx_work1", NOW + 2 * HOUR, ["pat@acme.test", "maya@vyre.test"], 1, LEE.id],
  );
  assert.equal(out.threads.find((t) => t.threadId === "thr_who")!.contactId, undefined);
  assert.deepEqual((await listByThread(h.ctx, { channel: "email", mailboxId: "mbx_hello1" })).threads.map((t) => t.threadId), ["thr_who"]);
  assert.deepEqual((await listByThread(h.ctx, { query: "cases" })).threads.map((t) => t.threadId), ["thr_who"]);
  assert.deepEqual((await listByThread(h.ctx, { needsMatch: true })).threads.map((t) => t.threadId), ["thr_sam"]);
  assert.deepEqual((await listByThread(h.ctx, { numberId: "num_main1" })).threads.map((t) => t.channel), ["sms"]);
  const first = await listByThread(h.ctx, { limit: 1 });
  assert.deepEqual([first.threads.length, first.next, first.total], [1, "1", 4]);
  assert.ok(c1 && c2);
});

// ---- one contact's history

test("a contact's whole history runs oldest to newest with each kind of item, campaign steps as quiet lines, and meetings from the calendar", async () => {
  const { h, c1 } = await world();
  await linkMessage(h.ctx, link({ address: "pat@acme.test", direction: "out", campaignId: "cmp_spring", at: NOW + 8 * HOUR, preview: "Spring offer" }));
  await linkMessage(h.ctx, link({ channel: "call", address: "+14155550177", numberId: "num_main1", at: NOW + 9 * HOUR, preview: "Call, 4 min" }));
  h.meetings.push(
    { id: "mtg_done01", title: "Consult", startsAt: NOW + 10 * HOUR, provider: "zoom", status: "ended", attendeeIds: [], recordingState: "attached", hasTranscript: true, hasSummary: true },
    { id: "mtg_canc01", title: "Cancelled", startsAt: NOW + 11 * HOUR, provider: "zoom", status: "canceled", attendeeIds: [], recordingState: "none", hasTranscript: false, hasSummary: false },
    { id: "mtg_next01", title: "Tomorrow", startsAt: NOW + 900 * HOUR, provider: "zoom", status: "scheduled", attendeeIds: [], recordingState: "none", hasTranscript: false, hasSummary: false },
  );
  h.advance(20 * HOUR);
  const out = await thread(h.ctx, { contactId: LEE.id });
  assert.deepEqual(contractErrors("inbox.thread", "out", out), []);
  assert.equal(out.conversation.id, c1);
  assert.deepEqual(out.items.map((i) => [i.kind, i.direction, i.title ?? i.preview]), [
    ["email", "in", "Intake form"], ["email", "out", "Re: Intake form"], ["sms", "in", "On my way"], ["campaign_step", "out", "Spring offer"], ["call", "in", "Call, 4 min"], ["meeting", undefined, "Consult"],
  ]);
  const step = out.items.find((i) => i.kind === "campaign_step")!;
  assert.equal(step.campaignId, "cmp_spring");
  assert.deepEqual(out.items.find((i) => i.kind === "email")!.ref, { kind: "mail_message", id: "eml_lee1", threadId: "thr_intake" });
  assert.deepEqual(out.items.find((i) => i.kind === "meeting")!.ref, { kind: "meeting", id: "mtg_done01", recording: "attached", hasTranscript: true, hasSummary: true });
  assert.deepEqual(await thread(h.ctx, { conversationId: c1 }).then((o) => o.items.length), 6, "by conversation id is the same history");
  assert.equal(out.conversation.contactId, LEE.id);
});

test("the history pages from the newest back, by cursor or by a time", async () => {
  const { h } = await world();
  const page = await thread(h.ctx, { contactId: LEE.id, limit: 2 });
  assert.deepEqual(page.items.map((i) => i.kind), ["email", "sms"], "the newest two, oldest first");
  assert.ok(page.next);
  const older = await thread(h.ctx, { contactId: LEE.id, limit: 2, cursor: page.next as string });
  assert.deepEqual(older.items.map((i) => i.id), ["eml_lee1"]);
  assert.equal(older.next, undefined);
  assert.deepEqual((await thread(h.ctx, { contactId: LEE.id, before: NOW + 2 * HOUR })).items.map((i) => i.id), ["eml_lee1"]);
});

test("the history needs a conversation or a contact, that exists, and that the kernel lets you see", async () => {
  const { h, c1 } = await world();
  await refused(thread(h.ctx, {}), "validation.bad_input");
  await refused(thread(h.ctx, { contactId: "rec_nobody1" }), "validation.not_found");
  await refused(thread(h.ctx, { contactId: LEE.id, cursor: "nope" }), "validation.bad_input");
  await refused(thread(h.ctx, { contactId: LEE.id, limit: 501 }), "validation.bad_input");
  h.denied.add(`conversation:${c1}`);
  await refused(thread(h.ctx, { contactId: LEE.id }), "permission.not_found");
});

test("a meeting list that fails leaves the rest of the history in place", async () => {
  const { h } = await world();
  h.meetings.push({ id: "mtg_done01", title: "Consult", startsAt: NOW + 10 * HOUR, provider: "zoom", status: "ended", attendeeIds: [], recordingState: "none", hasTranscript: false, hasSummary: false });
  h.advance(20 * HOUR);
  assert.equal((await thread(h.ctx, { contactId: LEE.id })).items.at(-1)!.kind, "meeting");
  h.failMeetings(true);
  const out = await thread(h.ctx, { contactId: LEE.id });
  assert.deepEqual(out.items.map((i) => i.kind), ["email", "email", "sms"]);
});

// ---- Unmatched and Needs a match

test("Unmatched lists senders with no record that did not raise Needs a match; Needs a match lists the unsure ones with suggestions", async () => {
  const { h, c2, c3 } = await world();
  const un = await unmatched(h.ctx, {});
  assert.deepEqual(contractErrors("inbox.unmatched", "out", un), []);
  assert.deepEqual(ids(un.rows), [c2]);
  assert.deepEqual(ids((await unmatched(h.ctx, { query: "nowhere" })).rows), [c2]);
  assert.deepEqual((await unmatched(h.ctx, { query: "fox" })).rows, []);
  const need = await needsMatch(h.ctx, {});
  assert.deepEqual(contractErrors("inbox.needs_match", "out", need), []);
  assert.deepEqual(need.rows.map((r) => r.conversation.id), [c3]);
  assert.deepEqual(need.rows[0]!.suggestions, [{ recordId: DANA.id, type: "contact", name: "Dana Fox", score: 0.5, why: "Same email address" }]);
});

// ---- counts, following, sending, recipients

test("counts give the unread per inbox and number, the total, and how many need a match", async () => {
  const { h } = await world();
  const out = await counts(h.ctx);
  assert.deepEqual(contractErrors("inbox.counts", "out", out), []);
  assert.deepEqual(out.byInbox, [
    { kind: "mailbox", id: "mbx_work1", unread: 2 }, { kind: "mailbox", id: "mbx_hello1", unread: 1 }, { kind: "number", id: "num_main1", unread: 1 },
  ]);
  assert.deepEqual([out.total, out.needsMatch], [4, 1]);
});

test("following says why each contact reaches you: you own it, follow it, or an inbox you can see received it", async () => {
  const { h } = await world();
  await followSet(h.ctx, { contactId: DANA.id, follow: true, alertOnReplies: true });
  const out = await following(h.ctx, {});
  assert.deepEqual(contractErrors("inbox.following", "out", out), []);
  assert.deepEqual(out.rows, [{ contactId: DANA.id, reasons: ["follow"], alertOnReplies: true }, { contactId: LEE.id, reasons: ["owner", "shared_inbox"], alertOnReplies: false }]);
  // a followed contact with no messages yet still reaches you
  await followSet(h.ctx, { contactId: "rec_quiet01", follow: true });
  assert.ok((await following(h.ctx, {})).rows.some((r) => r.contactId === "rec_quiet01" && r.reasons.includes("follow")));
  const page = await following(h.ctx, { limit: 1 });
  assert.deepEqual([page.rows.length, page.next, page.total], [1, "1", 3]);
});

test("the campaign owner is reached by the campaign's replies", async () => {
  const { h } = await world();
  h.campaigns.set("cmp_spring", "usr_maya01");
  await linkMessage(h.ctx, link({ address: "dana@fox.test", campaignId: "cmp_spring", mailboxId: "mbx_other1" }));
  const rows = (await following(h.ctx, {})).rows;
  assert.deepEqual(rows.find((r) => r.contactId === DANA.id)?.reasons, ["owner", "campaign"]);
});

test("send options offer the channels the contact has and the inboxes that can send, defaulting to the inbox the thread came in on", async () => {
  const { h, c1, c2 } = await world();
  const out = await sendOptions(h.ctx, { conversationId: c1 });
  assert.deepEqual(contractErrors("inbox.send_options", "out", out), []);
  assert.deepEqual(out.channels, ["email", "sms"]);
  assert.deepEqual(out.inboxes, [
    { kind: "mailbox", id: "mbx_work1", address: "maya@vyre.test", canSend: true, isDefault: false },
    { kind: "mailbox", id: "mbx_hello1", address: "hello@vyre.test", canSend: true, isDefault: false },
    { kind: "mailbox", id: "mbx_old001", address: "old@vyre.test", canSend: false, isDefault: false },
    { kind: "number", id: "num_main1", address: "+14155550123", canSend: true, isDefault: true },
  ]);
  const byContact = await sendOptions(h.ctx, { contactId: LEE.id });
  assert.equal(byContact.inboxes.find((i) => i.isDefault)!.id, "num_main1");
  const stranger = await sendOptions(h.ctx, { conversationId: c2 });
  assert.deepEqual([stranger.channels, stranger.inboxes.find((i) => i.isDefault)!.id], [["email"], "mbx_hello1"]);
  h.contacts.set("rec_fresh1", { id: "rec_fresh1", type: "contact", name: "Fresh", emails: ["fresh@z.test"], phones: [] });
  const fresh = await sendOptions(h.ctx, { contactId: "rec_fresh1" });
  assert.deepEqual([fresh.channels, fresh.inboxes.filter((i) => i.isDefault).length], [["email"], 1], "a contact with no history: the first inbox that can send");
  assert.equal(fresh.inboxes.find((i) => i.isDefault)!.kind, "mailbox");
  await refused(sendOptions(h.ctx, {}), "validation.bad_input");
  await refused(sendOptions(h.ctx, { conversationId: "cnv_missing1" }), "validation.not_found");
});

test("a mailbox the caller may not use for sending is offered but cannot send", async () => {
  const { h, c1 } = await world();
  h.denied.add("mailbox:mbx_hello1");
  const out = await sendOptions(h.ctx, { conversationId: c1 });
  assert.equal(out.inboxes.find((i) => i.id === "mbx_hello1")!.canSend, false);
});

test("recipient search ranks contacts, companies, inboxes and groups, and takes the kinds and a limit", async () => {
  const { h } = await world();
  h.contacts.set("rec_acme01", { id: "rec_acme01", type: "company", name: "Acme Holdings", emails: ["info@acme.test"], phones: [] });
  h.groups.push({ id: "grp_acme01", name: "Acme team" }, { id: "grp_other1", name: "Other" });
  const out = await recipientsSearch(h.ctx, { q: "acme" });
  assert.deepEqual(contractErrors("inbox.recipients_search", "out", out), []);
  assert.deepEqual(out.results.map((r) => [r.kind, r.label]), [["contact", "Acme Holdings"], ["group", "Acme team"]]);
  const lee = await recipientsSearch(h.ctx, { q: "vyre", kinds: ["inbox"] });
  assert.deepEqual(lee.results.map((r) => r.id), ["mbx_hello1", "mbx_work1", "mbx_old001"], "equal scores sort by label");
  assert.equal(lee.results.every((r) => r.kind === "inbox" && r.address), true);
  assert.equal((await recipientsSearch(h.ctx, { q: "e", limit: 1 })).results.length, 1);
  assert.deepEqual((await recipientsSearch(h.ctx, { q: "pat", kinds: ["member"] })).results, [], "members have no directory capability in the frozen contract");
  await refused(recipientsSearch(h.ctx, { q: "  " }), "validation.bad_input");
  await refused(recipientsSearch(h.ctx, { q: "x", limit: 51 }), "validation.bad_input");
});

test("list rows carry the organisation, Do not contact, bounced, unmatched and draft-ready flags from real data", async () => {
  const h = harness({
    contacts: [
      { id: "rec_acme01", type: "company", name: "Acme Legal", emails: [], phones: [] },
      { ...LEE, company: "rec_acme01", draft: true },
      { ...DANA, dnd: true, deliverability: "bounced" },
    ],
    mailboxes: [...MBX],
  });
  h.mailboxOwners.set("mbx_work1", "usr_maya01");
  h.mail.set("eml_a", { id: "eml_a", threadId: "thr_a", subject: "Hi", from: "pat@acme.test", to: ["maya@vyre.test"] });
  h.mail.set("eml_b", { id: "eml_b", threadId: "thr_b", subject: "Hi", from: "dana@fox.test", to: ["maya@vyre.test"] });
  h.mail.set("eml_c", { id: "eml_c", threadId: "thr_c", subject: "Hi", from: "who@nowhere.test", to: ["hello@vyre.test"] });
  h.denied.add("mailbox:none");
  const lee = (await linkMessage(h.ctx, link({ address: "pat@acme.test", id: "eml_a", mailboxId: "mbx_work1", at: NOW + 3 * HOUR }))).conversationId;
  const dana = (await linkMessage(h.ctx, link({ address: "dana@fox.test", id: "eml_b", mailboxId: "mbx_work1", at: NOW + 2 * HOUR }))).conversationId;
  const out = (await listByContact(h.ctx, {})).rows;
  const byId = (id: string) => out.find((r) => r.id === id)!;
  const a = byId(lee);
  assert.deepEqual([a.organisation, a.dnd, a.bounced, a.unmatched, a.draftReady], ["Acme Legal", false, false, false, true]);
  const b = byId(dana);
  assert.deepEqual([b.organisation, b.dnd, b.bounced, b.unmatched, b.draftReady], [undefined, true, true, false, false]);
});

// Run on the final commit of this packet, after merging main, so the CI log lists the file as ok.
