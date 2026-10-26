// @reads /scripts/shots/mounts/P-L9c_02.tsx
// Inbox > contact tab (spec 3.3, 2.18, 2.14): the whole history in reading order with the quoted text folded, text bubbles, calls with the player and transcript, campaign steps as quiet lines, record chips,
// the composer that switches Email and Text and picks the sending inbox, and an agent's draft with its Gate line. Sends go through mail.send and telephony.send_sms; the sample replica shows the result.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ContactTab, TabLoading, followMenuEntries, fromMenuEntries } from "../contacttab/index.ts";
import { quickEntries, templateEntries } from "../contacttab/menus.ts";
import {
  buildFeed, headerOf, canSend, choicesFor, dayLabel, deliveryNote, draftCards, emailTarget, fill, gateLine, initialDraft, pickInbox, replySubject, sendBlocker, sentNote, startChannel, textTarget,
} from "../contacttab/model.ts";
import type { ComposerDraft, InboxChoice, SendOptions, ThreadItem, ThreadOut } from "../contacttab/model.ts";
import { discardDraft, markRead, sendAgentDraft, sendEmail, sendText, setFollow } from "../contacttab/actions.ts";
import { Bubbles, CallLine, EmailItem } from "../contacttab/parts.tsx";
import { createContactTabSample, threads } from "../contacttab/sample.ts";
import type { ContactTabSample } from "../contacttab/sample.ts";
import { harbor, northwind, SAMPLE_NOW } from "../contactlist/sample.ts";
import type { SampleSpace } from "../contactlist/sample.ts";
import { InboxDataProvider } from "../sidebar/index.ts";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuItem } from "../../../../../../ui/src/Menu/props.ts";

const wrap = (s: ContactTabSample, child: ReactElement): string => renderToStaticMarkup(<InboxDataProvider value={s.data}>{child}</InboxDataProvider>).replaceAll("<!-- -->", "");
const tab = (id: string, space: SampleSpace = northwind, o: { online?: boolean } = {}): { out: string; s: ContactTabSample } => {
  const s = createContactTabSample(space, o);
  const contact = (s.replica.rows("contacts") as unknown as { id: string; contactId?: string }[]).find((c) => c.id === id);
  return { s, out: wrap(s, <ContactTab conversationId={id} {...(contact?.contactId ? { contactId: contact.contactId } : {})} />) };
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const thread = (s: ContactTabSample, id: string): ThreadOut => {
  const r = s.replica.run("inbox.thread", { conversationId: id });
  assert.ok(r, "the thread resolver is registered");
  return r.data;
};
const options = (s: ContactTabSample, id: string): SendOptions => s.replica.run("inbox.send_options", { conversationId: id })!.data;
const titles = (space: SampleSpace): Map<string, string> => new Map(space.mailboxes.map((m) => [m.id, m.title]));
const items = (list: readonly ThreadItem[]): ThreadItem[] => [...list];

test("screen: the history reads oldest to newest with day separators, newest at the foot", () => {
  const { out } = tab("elena");
  assert.ok(has(out, 'data-testid="contact-tab"') && has(out, "Elena Rivera"));
  const order = ["email:m_intake", "step:s_welcome", "email:m_reply", "call:c_elena", "texts:t1", "texts:t3", "email:m_lease"].map((k) => at(out, `data-testid="${k}"`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "items run oldest to newest");
  for (const day of ["Tue 21 Oct", "Wed 22 Oct", "Yesterday", "Today"]) assert.ok(has(out, day), `day separator ${day}`);
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("screen: quoted text is folded behind a toggle until asked for", () => {
  const { out } = tab("elena");
  assert.ok(has(out, 'data-testid="quote-toggle:m_lease"') && has(out, 'aria-label="Show quoted text"'));
  assert.ok(!has(out, 'data-testid="quote:m_lease"') && !has(out, "Marcus Pruitt wrote"), "the quote itself is not drawn");
  const e = buildFeed(threads["elena"]!, SAMPLE_NOW, 0).find((f) => f.kind === "email" && f.item.id === "m_lease");
  assert.ok(e && e.kind === "email");
  const open = renderToStaticMarkup(<EmailItem e={e} who="Elena Rivera" offsetMin={0} quoteOpen onQuote={() => undefined} />).replaceAll("<!-- -->", "");
  assert.ok(has(open, 'aria-label="Hide quoted text"') && has(open, 'data-testid="quote:m_lease"') && has(open, "Marcus Pruitt wrote"));
});

test("screen: emails show attachments and record chips; outward mail is in the accent colour with the inbox it left from", () => {
  const { out } = tab("elena");
  assert.ok(has(out, 'data-testid="attachment:Lease-draft-3.pdf"') && has(out, "412 KB") && has(out, 'data-testid="attachment:Floor-plan.png"'));
  assert.ok(has(out, 'data-testid="chip:Lease renewal"') && has(out, 'aria-label="Open record Lease renewal"'));
  assert.ok(has(out, "You") && has(out, "Work Gmail") && has(out, "hello@"), "who and which inbox");
});

test("screen: texts are bubbles, grouped by side and number, with one meta line", () => {
  const { out } = tab("elena");
  assert.ok(has(out, 'data-testid="bubble:t1"') && has(out, 'data-testid="bubble:t2"') && has(out, 'data-testid="bubble:t3"'));
  const first = at(out, 'data-testid="texts:t1"');
  assert.ok(first < at(out, 'data-testid="bubble:t1"') && at(out, 'data-testid="bubble:t2"') < at(out, 'data-testid="texts:t3"'), "t1 and t2 share a group, t3 (from you) starts another");
  assert.ok(has(out, "+1 415 555 0132"), "the number the texts went through");
  const g = buildFeed(items(threads["elena"]!), SAMPLE_NOW, 0).filter((f) => f.kind === "texts");
  assert.deepEqual(g.map((x) => (x.kind === "texts" ? [x.direction, x.items.length] : null)), [["in", 2], ["out", 1]]);
  const one = renderToStaticMarkup(<Bubbles t={g[0]! as never} offsetMin={0} />).replaceAll("<!-- -->", "");
  assert.ok(has(one, "Running ten minutes late tomorrow."));
});

test("screen: a call has a player, a summary and a transcript that opens on a click", () => {
  const { out } = tab("elena");
  assert.ok(has(out, 'data-testid="player:c_elena"') && has(out, 'data-testid="play:c_elena"') && has(out, "4:12"));
  assert.ok(has(out, "Elena sends the lease Thursday and wants a short call on Friday morning."));
  assert.ok(has(out, 'data-testid="transcript-toggle:c_elena"') && !has(out, 'data-testid="transcript:c_elena"'), "the transcript is folded");
  const c = buildFeed(threads["elena"]!, SAMPLE_NOW, 0).find((f) => f.kind === "call");
  assert.ok(c && c.kind === "call");
  const open = renderToStaticMarkup(<CallLine c={c} offsetMin={0} open onTranscript={() => undefined} />).replaceAll("<!-- -->", "");
  assert.ok(has(open, 'data-testid="transcript:c_elena"') && has(open, "Hi, it is Elena. I will send the lease on Thursday."));
});

test("screen: a missed call has no player; a campaign step is a quiet line", () => {
  const missed: ThreadItem = { kind: "call", id: "c_miss", at: SAMPLE_NOW - 600_000, direction: "in", ref: { state: "missed", via: "+1 415 555 0132" } };
  const f = buildFeed([missed], SAMPLE_NOW, 0).find((x) => x.kind === "call");
  assert.ok(f && f.kind === "call");
  const out = renderToStaticMarkup(<CallLine c={f} offsetMin={0} open={false} onTranscript={() => undefined} />).replaceAll("<!-- -->", "");
  assert.ok(has(out, "Missed call") && !has(out, 'data-testid="player:c_miss"'));
  assert.ok(has(tab("elena").out, "Welcome series, step 1 sent") && has(tab("priya").out, "Spring check-in, email 1 sent"));
});

test("screen: an agent's draft shows who drafted it, the inbox it sends from, the Gate line and Send, Edit, Discard", () => {
  const { out } = tab("elena");
  assert.ok(has(out, 'data-testid="draft:dr_elena"'));
  assert.ok(has(out, "Intake") && has(out, "drafted a reply"));
  assert.ok(has(out, "Gate: Intake sends from Work Gmail after you approve") && has(out, 'data-testid="gate:dr_elena"'));
  for (const b of ["draft-send:dr_elena", "draft-edit:dr_elena", "draft-discard:dr_elena"]) assert.ok(has(out, `data-testid="${b}"`), b);
  assert.ok(has(out, "Thanks for draft 3. I will read it tonight"));
  assert.ok(!has(tab("priya").out, 'data-testid="draft:'), "no draft, no card");
  assert.equal(gateLine("Intake", "Work Gmail"), "Gate: Intake sends from Work Gmail after you approve");
});

test("screen: an agent's text draft says it drafted a text, shows the number and its Gate line, and has no subject", () => {
  const { out } = tab("marcus");
  assert.ok(has(out, 'data-testid="draft:dr_marcus"') && has(out, "drafted a text") && !has(out, "drafted a reply"));
  assert.ok(has(out, "Gate: Billing sends from +1 415 555 0177 after you approve") && has(out, 'data-testid="gate:dr_marcus"'));
  for (const b of ["draft-send:dr_marcus", "draft-edit:dr_marcus", "draft-discard:dr_marcus"]) assert.ok(has(out, `data-testid="${b}"`), b);
  assert.ok(has(out, "resending invoice 1041 now"));
});

test("an agent's text draft goes out through telephony.send_sms from its number, and then it is gone", async () => {
  const s = createContactTabSample();
  const th = thread(s, "marcus");
  const [card] = draftCards((s.replica.run("mail.drafts.list", { contactId: "ct_marcus" })!.data).drafts, titles(northwind), new Map());
  assert.ok(card);
  assert.equal(card.channel, "sms");
  assert.equal(card.agent, "agt_billing");
  const note = await sendAgentDraft(s.data, card, th.conversation, "Resent.", "", "key-9");
  assert.deepEqual(s.sent[0], { cap: "telephony.send_sms", input: { numberId: "+1 415 555 0177", to: "+1 415 555 0188", body: "Resent.", contactId: "ct_marcus", idempotencyKey: "key-9" } });
  assert.ok(note.length > 0);
  assert.equal((s.replica.run("mail.drafts.list", { contactId: "ct_marcus" })!.data).drafts.length, 0, "sent: the draft is cleared");
});

test("screen: the composer opens on the channel of the last message and the inbox the thread came in on", () => {
  const e = tab("elena").out;
  for (const id of ["chan-email", "chan-sms", "composer-recipients", "contact-subject", "from-pick"]) assert.ok(has(e, `data-testid="${id}"`), id);
  const emailTab = e.slice(e.lastIndexOf("<", e.indexOf('data-testid="chan-email"')), e.indexOf(">", e.indexOf('data-testid="chan-email"')));
  assert.ok(has(emailTab, 'aria-selected="true"'), "the selected channel tab exposes aria-selected");
  const smsTab = e.slice(e.lastIndexOf("<", e.indexOf('data-testid="chan-sms"')), e.indexOf(">", e.indexOf('data-testid="chan-sms"')));
  assert.ok(has(smsTab, 'aria-selected="false"'), "the other tab says it is not selected");
  assert.ok(has(e, "Re: Lease documents for Thursday") && !has(e, "Sends from"), "no explaining line under the composer");
  assert.ok(has(e, "Elena Rivera"), "To shows the contact name");
  const fromE = at(e, 'data-testid="from-name"');
  assert.ok(e.slice(fromE, fromE + 80).includes("Work Gmail"), "From names the inbox it came in on");
  const m = tab("marcus").out;
  assert.ok(!has(m, "Sends from") && !has(m, 'data-testid="composer-recipients"'), "a text has no recipients block and no explaining line");
  assert.ok(has(m, 'aria-label="Text from"'));
});

test("screen: a sender with no record gets the ghost face and the match link, and can only be texted", () => {
  const { out } = tab("unk");
  assert.ok(has(out, 'data-testid="face-ghost"') && has(out, 'data-testid="head-match"') && has(out, "Match to a record"));
  assert.ok(has(out, 'data-testid="chan-email"') && has(out, 'aria-disabled="true"'), "Email is off: there is no address");
  assert.ok(has(out, "+1 628 555 0194"));
});

test("screen: the header names the company and the record chip, and the feed does not repeat the chip", () => {
  const e = tab("elena").out, m = tab("marcus").out;
  assert.ok(has(e, "Rivera Holdings") && has(e, "Rivera matter") && has(m, "Pruitt &amp; Co."));
  assert.ok(!has(e, 'data-testid="chip-line:hdr_elena"'));
  assert.equal(buildFeed(threads["elena"]!, SAMPLE_NOW, 0).some((f) => f.kind === "chip" && f.item.id === "hdr_elena"), false);
  assert.equal(headerOf(threads["elena"]!)?.company, "Rivera Holdings");
});

test("screen: a meeting that ended shows in the texts timeline with its player, summary and Transcript link", () => {
  const m = tab("marcus").out;
  assert.ok(has(m, 'data-testid="call:mc1"') && has(m, "Check-in: Pruitt") && has(m, 'data-testid="player:mc1"') && has(m, 'data-testid="transcript-toggle:mc1"'));
  assert.ok(has(m, "agrees to net 15"));
});

test("screen: the composer's bottom row has templates, quick actions and Ask, and the header has a star", () => {
  const e = tab("elena").out;
  for (const id of ["composer-templates", "composer-quick", "composer-ask", "head-star"]) assert.ok(has(e, `data-testid="${id}"`), id);
  assert.ok(has(e, 'aria-label="Star"'));
  const t = templateEntries([{ t: "Thanks", body: "Thank you." }], () => undefined);
  assert.equal(t.length, 2);
  assert.deepEqual(quickEntries(false, { dial() {}, openRecord() {}, attach() {} }).map((x) => ("label" in x ? x.label : "")), ["Call", "Attach from Files"]);
});

test("screen: the header has Email, Text, Call, Follow and Ask; Follow is lit for a followed contact", () => {
  const { out } = tab("elena");
  for (const id of ["head-email", "head-text", "head-call", "head-star", "head-follow", "head-ask", "head-record"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, 'aria-label="Following"'), "Elena is followed");
  assert.ok(has(tab("priya").out, 'aria-label="Follow"'));
});

test("screen: offline the saved copy still reads, and Send is blocked with a reason", () => {
  const { out } = tab("elena", northwind, { online: false });
  assert.ok(has(out, "Offline, showing your saved copy") && has(out, "Lease documents for Thursday"));
  const s = createContactTabSample(northwind, { online: false });
  const th = thread(s, "elena");
  const inbox = pickInbox(choicesFor("email", options(s, "elena"), titles(northwind)), th.conversation.mailboxIds);
  const d: ComposerDraft = { ...initialDraft(th.conversation, "email", th.items), text: "Hello" };
  assert.equal(canSend(d, inbox, false, null), false);
  assert.equal(sendBlocker(d, inbox, false, null), "You are offline");
});

test("screen: the Harbor Studio space has its own conversation and no numbers to text from", () => {
  const { out } = tab("kai", harbor);
  assert.ok(has(out, "Kai Moreno") && has(out, "Logo round two") && has(out, "Studio Gmail"));
  assert.ok(has(out, 'aria-label="Text"') && has(out, 'aria-disabled="true"'), "no number, so Text is off");
});

test("screen: Harbor Studio's Clara Voss opens with her one email, as the prototype's Harbor Inbox shows her", () => {
  const { out } = tab("clara", harbor);
  assert.ok(has(out, "Clara Voss") && has(out, "Studio session for the autumn range") && has(out, 'data-testid="email:cv1"'));
});

test("the loading frame has the header, a feed and the composer so nothing moves when the thread lands", () => {
  const out = renderToStaticMarkup(<TabLoading />);
  assert.ok(has(out, 'data-testid="contact-tab-loading"') && has(out, 'aria-label="Loading"'));
  const bare = renderToStaticMarkup(<ContactTab conversationId="elena" />);
  assert.ok(has(bare, 'data-testid="contact-tab-loading"'), "before the shell gives the Inbox its data");
});

// ------------------------------------------------------------------ sending

test("send via mail.send: the reply goes out from the inbox the thread came in on, answers the newest email, carries an idempotency key and shows in the thread", async () => {
  const s = createContactTabSample();
  const th = thread(s, "elena");
  const inbox = pickInbox(choicesFor("email", options(s, "elena"), titles(northwind)), th.conversation.mailboxIds);
  assert.equal(inbox?.id, "mbx_work");
  const d: ComposerDraft = { ...initialDraft(th.conversation, "email", th.items), text: "Read it, looks fine. Replying to Marcus today." };
  assert.equal(canSend(d, inbox, true, null), true);
  const note = await sendEmail(s.data, d, inbox!, th.conversation, th.items, "key-1");
  assert.equal(note, "Sending from Work Gmail");
  assert.equal(s.sent.length, 1);
  const call = s.sent[0]!;
  assert.equal(call.cap, "mail.send");
  assert.deepEqual(call.input, {
    mailboxId: "mbx_work", to: [{ address: "elena@example.test", name: "Elena Rivera", contactId: "ct_elena" }], subject: "Re: Lease documents for Thursday", text: "Read it, looks fine. Replying to Marcus today.",
    replyToMessageId: "m_lease", contactId: "ct_elena", idempotencyKey: "key-1",
  });
  const after = thread(s, "elena");
  const mine = after.items.find((i) => i.id === "out_1");
  assert.equal(mine?.title, "Re: Lease documents for Thursday");
  assert.equal(mine?.direction, "out");
  assert.equal(after.conversation.lastMessageAt, SAMPLE_NOW, "the contact list line moves to the top");
});

test("send via telephony.send_sms: a text goes from the number it came in on to the contact's phone", async () => {
  const s = createContactTabSample();
  const th = thread(s, "marcus");
  const inbox = pickInbox(choicesFor("sms", options(s, "marcus"), titles(northwind)), th.conversation.mailboxIds);
  assert.equal(inbox?.id, "+1 415 555 0177");
  const to = textTarget(th.conversation, th.items);
  assert.equal(to, "+1 415 555 0188");
  const d: ComposerDraft = { ...initialDraft(th.conversation, "sms", th.items), chan: "sms", text: "Sent again, check your inbox." };
  assert.equal(canSend(d, inbox, true, to), true);
  await sendText(s.data, d, inbox!, th.conversation, to!, "key-2");
  assert.deepEqual(s.sent[0], { cap: "telephony.send_sms", input: { numberId: "+1 415 555 0177", to: "+1 415 555 0188", body: "Sent again, check your inbox.", contactId: "ct_marcus", idempotencyKey: "key-2" } });
  assert.equal(thread(s, "marcus").items.find((i) => i.id === "sms_1")?.preview, "Sent again, check your inbox.");
});

test("an agent's draft is sent with its draftId from the inbox the agent chose, and then it is gone; when the Gate holds it, the note says it waits for approval", async () => {
  const s = createContactTabSample();
  const th = thread(s, "elena");
  const [card] = draftCards((s.replica.run("mail.drafts.list", { contactId: "ct_elena" })!.data).drafts, titles(northwind), new Map([["agt_intake", "Intake"]]));
  assert.ok(card);
  assert.equal(card.agent, "Intake");
  s.mailStatus.next = "held";
  const held = await sendAgentDraft(s.data, card, th.conversation, card.body, card.subject, "key-3");
  assert.equal(held, "Waiting for approval in Needs you");
  assert.equal((s.sent[0]!.input as { draftId?: string }).draftId, "dr_elena");
  assert.equal((s.replica.run("mail.drafts.list", { contactId: "ct_elena" })!.data).drafts.length, 1, "held: the draft stays until it is approved");
  const sentNow = await sendAgentDraft(s.data, card, th.conversation, "Edited text", card.subject, "key-4");
  assert.equal(sentNow, "Sending from Work Gmail");
  assert.equal((s.sent[1]!.input as { text?: string }).text, "Edited text");
  assert.equal((s.replica.run("mail.drafts.list", { contactId: "ct_elena" })!.data).drafts.length, 0, "sent: the draft is cleared");
});

test("discard removes a draft; follow and mark read go through their capabilities", async () => {
  const s = createContactTabSample();
  await discardDraft(s.data, "dr_elena");
  assert.equal((s.replica.run("mail.drafts.list", { contactId: "ct_elena" })!.data).drafts.length, 0);
  await setFollow(s.data, "ct_priya", true, true);
  await markRead(s.data, "elena");
  assert.deepEqual(s.calls.map((c) => c.cap), ["mail.drafts.discard", "inbox.follow_set", "inbox.mark_read"]);
  assert.deepEqual(s.calls[1]!.input, { contactId: "ct_priya", follow: true, alertOnReplies: true });
  assert.deepEqual(s.calls[2]!.input, { conversationId: "elena", read: true });
});

test("a suppressed address is reported, not sent", () => {
  assert.equal(sentNote("suppressed", "Work Gmail"), "Not sent: this address is on the suppression list");
  assert.equal(sentNote("sent", "Work Gmail"), "Sent from Work Gmail");
});

// ------------------------------------------------------------------ the model

test("model: reply subject, targets, channel and inbox choices", () => {
  assert.equal(replySubject("Lease"), "Re: Lease");
  assert.equal(replySubject("Re: Lease"), "Re: Lease");
  assert.equal(replySubject(undefined), "");
  const s = createContactTabSample();
  const th = thread(s, "elena");
  assert.equal(emailTarget(th.conversation, th.items), "elena@example.test");
  assert.equal(textTarget(th.conversation, th.items), "+1 415 555 0161");
  const opt = options(s, "elena");
  assert.equal(startChannel("email", opt), "email");
  assert.equal(startChannel("sms", opt), "sms");
  assert.equal(startChannel("call", opt), "email");
  assert.equal(startChannel("sms", options(s, "unk")), "sms");
  const mail = choicesFor("email", opt, titles(northwind));
  assert.deepEqual(mail.map((c) => c.label), ["Work Gmail", "Personal", "hello@", "support@", "Client portal"], "an agent's own mailbox is not offered");
  assert.equal(pickInbox(mail, ["mbx_support"])?.id, "mbx_support");
  assert.equal(pickInbox(mail, [])?.id, "mbx_work");
  assert.equal(pickInbox([], ["x"]), null);
  assert.equal(fill("Hi {first},", th.conversation), "Hi Elena,");
});

test("model: feed groups texts within 30 minutes and splits on a day change or a change of side", () => {
  const t = (id: string, min: number, dir: "in" | "out"): ThreadItem => ({ kind: "sms", id, at: SAMPLE_NOW - min * 60_000, direction: dir, ref: { body: id, via: "n1" } });
  const feed = buildFeed([t("a", 100, "in"), t("b", 90, "in"), t("c", 40, "in"), t("d", 39, "out"), t("e", 2000, "in")], SAMPLE_NOW, 0);
  assert.deepEqual(feed.map((f) => (f.kind === "texts" ? f.items.map((i) => i.id).join("") : f.kind)), ["day", "e", "day", "ab", "c", "d"]);
  assert.equal(dayLabel(SAMPLE_NOW, SAMPLE_NOW, 0), "Today");
  assert.equal(dayLabel(SAMPLE_NOW - 24 * 60 * 60_000, SAMPLE_NOW, 0), "Yesterday");
  assert.equal(deliveryNote("bounced"), "Bounced");
  assert.equal(deliveryNote("delivered"), "");
});

test("model: Send needs a recipient and subject for email, a number for text, an inbox, a message and a connection", () => {
  const s = createContactTabSample();
  const th = thread(s, "elena");
  const inbox: InboxChoice = { id: "mbx_work", kind: "mailbox", address: "irfad@northwind.example", label: "Work Gmail", isDefault: true };
  const base = initialDraft(th.conversation, "email", th.items);
  assert.equal(sendBlocker({ ...base, text: "" }, inbox, true, null), "Write a message");
  assert.equal(sendBlocker({ ...base, text: "x", subject: "" }, inbox, true, null), "Add a subject");
  assert.equal(sendBlocker({ ...base, text: "x", to: [] }, inbox, true, null), "Add a recipient");
  assert.equal(sendBlocker({ ...base, text: "x" }, null, true, null), "No mailbox can send");
  assert.equal(sendBlocker({ ...base, text: "x", chan: "sms" }, inbox, true, null), "No phone number for this contact");
  assert.equal(sendBlocker({ ...base, text: "x" }, inbox, true, null), "");
});

test("menus: Follow offers Alert me on replies only while following, and the From menu checks the chosen inbox and marks the thread's own", () => {
  const picked: string[] = [];
  const f1 = followMenuEntries(false, false, { follow: (v) => void picked.push(`f:${v}`), alert: (v) => void picked.push(`a:${v}`) }).filter(isItem);
  assert.deepEqual(f1.map((x) => x.label), ["Follow"]);
  const f2 = followMenuEntries(true, true, { follow: (v) => void picked.push(`f:${v}`), alert: (v) => void picked.push(`a:${v}`) }).filter(isItem);
  assert.deepEqual(f2.map((x) => [x.label, x.checked]), [["Unfollow", undefined], ["Alert me on replies", true]]);
  f1[0]!.onSelect?.();
  f2[1]!.onSelect?.();
  assert.deepEqual(picked, ["f:true", "a:false"]);
  const s = createContactTabSample();
  const choices = choicesFor("email", options(s, "elena"), titles(northwind));
  const chosen: string[] = [];
  const items2 = fromMenuEntries(choices, "mbx_hello", ["mbx_work"], (id) => void chosen.push(id));
  assert.deepEqual((items2[0] as { head: string }).head, "Send from");
  const flat: MenuItem[] = items2.filter(isItem);
  assert.deepEqual(flat.map((x) => [x.label, x.checked]), [["Work Gmail (this thread)", false], ["Personal", false], ["hello@", true], ["support@", false], ["Client portal", false]]);
  flat[1]!.onSelect?.();
  assert.deepEqual(chosen, ["mbx_pers"]);
});
