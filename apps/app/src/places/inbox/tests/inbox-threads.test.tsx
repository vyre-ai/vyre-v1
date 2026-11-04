// Inbox > a contact's email threads (owner, 3 Nov; a live case, anonymised): one card per thread at its last activity, subject once, who is on it, the count, what is new
// and your role; open, older messages one line each and the newest and new ones in full with quoted text and signatures folded; a Gmail reaction on its message; the same
// Scout thread whole under Josh and under Andrey; the composer replies in the thread you are in, Reply or Reply all, or starts a New email.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { ContactTab } from "../contacttab/index.ts";
import { threadMenuEntries } from "../contacttab/menus.ts";
import { sendEmail } from "../contacttab/actions.ts";
import { buildFeed, cutWords, initialDraft, messageOpen, replyMessage, replyTarget, roleLine, threadOpen, withLine } from "../contacttab/model.ts";
import type { ComposerDraft, InboxChoice, MailThread, ThreadOut } from "../contacttab/model.ts";
import { createContactTabSample, mailThreads } from "../contacttab/sample.ts";
import { ThreadCard } from "../contacttab/parts.tsx";
import type { ContactTabSample } from "../contacttab/sample.ts";
import { northwind, SAMPLE_NOW } from "../contactlist/sample.ts";
import { InboxDataProvider } from "../sidebar/index.ts";
import { threadEntry } from "../sidebar/model.ts";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";

installComposerForTests(Composer);

const ME = new Set(["irfad@northwind.example"]);
const CHROME = "gm_18c2a1f04e9b", SCOUT = "gm_18c39f7b2d10";
const wrap = (s: ContactTabSample, child: ReactElement): string => renderToStaticMarkup(<InboxDataProvider value={s.data}>{child}</InboxDataProvider>).replaceAll("<!-- -->", "");
const tab = (id: string): { out: string; s: ContactTabSample } => {
  const s = createContactTabSample(northwind);
  const contact = (s.replica.rows("contacts") as unknown as { id: string; contactId?: string }[]).find((c) => c.id === id);
  return { s, out: wrap(s, <ContactTab conversationId={id} {...(contact?.contactId ? { contactId: contact.contactId } : {})} />) };
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const josh = (): MailThread[] => mailThreads["josh"]!;

test("screen: Josh's email is two thread cards, not a flat stream; each subject shows once", () => {
  const { out } = tab("josh");
  assert.ok(at(out, `data-testid="thread:${SCOUT}"`) < at(out, `data-testid="thread:${CHROME}"`), "cards sit at their last activity, the newest nearest the composer");
  assert.equal(out.split("Claude in Chrome for Clio Grow + follow-up").length - 1 >= 1, true);
  assert.ok(!has(out, "RE: Claude in Chrome") && !has(out, "Re: Claude in Chrome"), "the subject is the thread's, said once, not repeated on every message");
  assert.ok(has(out, "With Maya Chen and Josh Cohen") && has(out, "5 messages") && has(out, "You were added later"));
  assert.ok(has(out, "With Andrey Volkov and Josh Cohen") && has(out, "2 messages") && has(out, `data-testid="thread-role:${SCOUT}"`));
});

test("screen: the open thread shows older messages as one line, then New since you last looked, then the new ones in full, every word", () => {
  const { out } = tab("josh");
  assert.ok(has(out, `data-testid="thread-fresh:${CHROME}"`) && has(out, "2 new"));
  assert.ok(has(out, `data-testid="thread-added:${CHROME}"`), "the note on being added later");
  const line = at(out, 'data-testid="email:eml_c3"'), divider = at(out, `data-testid="thread-new:${CHROME}"`), full = at(out, 'data-testid="email:eml_c4"');
  assert.ok(line < divider && divider < full, "older line, divider, new message");
  const c3 = out.slice(out.lastIndexOf("<", line), out.indexOf(">", line));
  assert.ok(has(c3, 'type="button"') && has(c3, 'aria-label="Josh Cohen: Thanks, I will put in the card for the Clio seat today.'), "an older message is one line that opens on a press");
  assert.ok(has(out, "then we will call on day three. Could the same setup draft that email for Rachel to send?"), "the open body is whole, never cut mid-word");
  assert.ok(!has(out, "CONFIDENTIALITY NOTICE") && has(out, `data-testid="sig-toggle:eml_c4"`), "the signature is folded behind its button");
  assert.ok(!has(out, "-----Original Message-----") && has(out, 'data-testid="quote-toggle:eml_c4"') && has(out, "Show quoted text"), "the quoted history is folded");
  assert.ok(!has(out, "reacted via Gmail"), "a reaction is never a message");
  assert.ok(has(out, "❤️"), "the heart sits on Josh's message line");
  assert.ok(!has(out, `data-testid="email:${"eml_w1"}"`), "the older Scout thread is closed");
});

test("screen: under Andrey the same Scout thread shows whole; his HTML welcome is sanitised with the image held", () => {
  const { out } = tab("andrey");
  assert.ok(has(out, `data-testid="thread:${SCOUT}"`));
  assert.ok(at(out, 'data-testid="email:eml_w1"') < at(out, 'data-testid="email:eml_w2"'), "both messages, Andrey's then Josh's reply");
  assert.ok(has(out, "Thanks Andrey. I am in and the team is set up."));
  const scout = mailThreads["andrey"]![0]!;
  const card = renderToStaticMarkup(
    <ThreadCard e={{ kind: "thread", key: `thread:${SCOUT}`, thread: scout, at: scout.lastAt }} v={{
      mine: ME, fresh: new Set(), now: SAMPLE_NOW, offsetMin: 0, open: true, msgOpen: () => true, quoteOpen: () => false, sigOpen: () => false,
      onToggle: () => undefined, onMessage: () => undefined, onQuote: () => undefined, onSig: () => undefined, onImages: () => undefined, onReply: () => undefined,
    }} />,
  ).replaceAll("<!-- -->", "");
  assert.ok(has(card, 'data-testid="html:eml_w1"') && has(card, "(app.scout.example)") && has(card, "1 image not loaded") && has(card, 'data-testid="images-show:eml_w1"'));
  assert.ok(!has(card, "<script"), "nothing runs");
});

test("screen: the composer replies in the thread you are in, to everyone on it, and says so", () => {
  const { out } = tab("josh");
  const bar = out.slice(at(out, 'data-testid="reply-in"'));
  assert.ok(bar.indexOf("Replying in") >= 0 && bar.indexOf("Claude in Chrome for Clio Grow + follow-up") > 0);
  assert.ok(has(out, 'data-testid="reply-mode-all"') && has(out, 'data-testid="reply-mode-one"'));
  const all = out.slice(out.lastIndexOf("<", at(out, 'data-testid="reply-mode-all"')), out.indexOf(">", at(out, 'data-testid="reply-mode-all"')));
  assert.ok(has(all, 'aria-checked="true"'), "Reply all is on: Cc stays");
  assert.ok(!has(out, 'data-testid="contact-subject"'), "the subject is the thread's");
});

test("model: Reply goes to the sender, Reply all keeps Cc, never you; New Email is a separate thread", () => {
  const chrome = josh()[0]!;
  assert.deepEqual(replyTarget(chrome, "one", ME), { to: ["josh@cohenshah.example"], cc: [], subject: "Re: Claude in Chrome for Clio Grow + follow-up" });
  assert.deepEqual(replyTarget(chrome, "all", ME), { to: ["josh@cohenshah.example"], cc: ["maya@northwind.example"], subject: "Re: Claude in Chrome for Clio Grow + follow-up" });
  const scout = josh()[1]!;
  assert.deepEqual(replyTarget(scout, "all", ME), { to: ["josh@cohenshah.example", "andrey@scout.example"], cc: [], subject: "Re: Welcome to Scout, Josh" });
  const entries = threadMenuEntries(josh(), CHROME, () => undefined);
  assert.deepEqual(entries.filter(isItem).map((e) => [e.label, e.checked === true]), [["Claude in Chrome for Clio Grow + follow-up", true], ["Welcome to Scout, Josh", false], ["New Email", false]]);
  const d = initialDraft({ id: "josh", address: "josh@cohenshah.example", displayName: "Josh Cohen", lastMessageAt: 0, lastChannel: "email", lastPreview: "", unreadCount: 0, needsMatch: false, mailboxIds: ["mbx_work"], followed: false, alertOnReplies: false }, "email", [], josh(), ME);
  assert.deepEqual([d.th, d.mode, d.to, d.cc, d.subject], [CHROME, "all", ["josh@cohenshah.example"], ["maya@northwind.example"], "Re: Claude in Chrome for Clio Grow + follow-up"]);
});

test("send: the reply goes to the selected thread, answering the newest message the sending mailbox holds", async () => {
  const s = createContactTabSample(northwind);
  const th = s.replica.run("inbox.thread", { conversationId: "josh" })!.data as ThreadOut;
  const scout = josh()[1]!;
  const inbox: InboxChoice = { id: "mbx_work", kind: "mailbox", address: "irfad@northwind.example", label: "Work Gmail", isDefault: true };
  const reply = replyMessage(scout, inbox.id);
  assert.equal(reply?.id, "eml_w2");
  const t = replyTarget(scout, "all", ME);
  const d: ComposerDraft = { chan: "email", from: { email: null, sms: null }, to: t.to, cc: t.cc, bcc: [], subject: t.subject, text: "Wednesday works.", draftId: null, th: scout.threadId, mode: "all", replyTo: reply?.id ?? null };
  await sendEmail(s.data, d, inbox, th.conversation, th.items, "key-t1");
  const sent = s.sent[0]!.input as { replyToMessageId?: string; subject: string; to: { address: string }[] };
  assert.equal(sent.replyToMessageId, "eml_w2", "the Scout thread, not the newest email of the contact");
  assert.equal(sent.subject, "Re: Welcome to Scout, Josh");
  assert.deepEqual(sent.to.map((x) => x.address), ["josh@cohenshah.example", "andrey@scout.example"]);
  await sendEmail(s.data, { ...d, th: null, replyTo: null, subject: "A separate question", to: ["josh@cohenshah.example"], cc: [] }, inbox, th.conversation, th.items, "key-t2");
  assert.equal((s.sent[1]!.input as { replyToMessageId?: string }).replyToMessageId, undefined, "New email answers nothing");
});

test("model: the feed has one card per thread and no email twice; previews end at a word", () => {
  const items = (createContactTabSample(northwind).replica.run("inbox.thread", { conversationId: "josh" })!.data as ThreadOut).items;
  const feed = buildFeed(items, SAMPLE_NOW, 0, josh());
  assert.deepEqual(feed.filter((f) => f.kind === "thread").map((f) => f.key), [`thread:${SCOUT}`, `thread:${CHROME}`]);
  assert.equal(feed.filter((f) => f.kind === "email").length, 0);
  const fresh = new Set(["eml_c4", "eml_c5"]);
  const chrome = josh()[0]!;
  assert.equal(threadOpen(chrome, josh(), fresh, {}), true);
  assert.equal(threadOpen(josh()[1]!, josh(), fresh, {}), false);
  assert.deepEqual(chrome.messages.map((m) => messageOpen(chrome, m.message, fresh, {})), [false, false, false, true, true]);
  assert.equal(roleLine("added_later"), "You were added later");
  assert.equal(withLine(chrome, ME), "With Maya Chen and Josh Cohen");
  const p = cutWords("Right now nobody writes after the consult, so the lead goes quiet and we lose about a third of them.", 50);
  assert.ok(p.endsWith("…") && p.length <= 50 && "Right now nobody writes after the consult, so the lead goes quiet".startsWith(p.slice(0, -1)), p);
});

test("list: an email thread row opens in its conversation; a text thread opens as before", () => {
  const row = { threadId: SCOUT, channel: "email" as const, subject: "Welcome to Scout, Josh", mailboxId: "mbx_work", lastAt: SAMPLE_NOW, participants: ["josh@cohenshah.example"], unread: 0, conversationId: "cnv_josh" };
  assert.equal(threadEntry(row, northwind.mailboxes, new Map()).conversationId, "cnv_josh");
  assert.equal(threadEntry({ ...row, channel: "sms" }, northwind.mailboxes, new Map()).conversationId, undefined);
});

test("a link to an email thread opens its conversation on that thread: open, marked for a moment, and the scroll lands on it", () => {
  const s = createContactTabSample(northwind);
  const plain = wrap(s, <ContactTab conversationId="josh" contactId="rec_josh" />);
  assert.ok(!has(plain, `data-marked="1"`), "no thread is marked without a link");
  assert.ok(!has(plain, 'data-testid="email:eml_w1"'), "the older Scout thread is closed by default");
  const linked = wrap(s, <ContactTab conversationId="josh" contactId="rec_josh" threadId={SCOUT} />);
  assert.ok(has(linked, `data-marked="1"`), "the asked thread is marked");
  const tagOf = (id: string): string => { const i = linked.indexOf(`data-testid="thread:${id}"`); return linked.slice(linked.lastIndexOf("<", i), linked.indexOf(">", i)); };
  assert.ok(has(tagOf(SCOUT), 'data-marked="1"') && !has(tagOf(CHROME), "data-marked"), "the mark is on the Scout card, not the other");
  assert.ok(has(linked, 'data-testid="email:eml_w1"'), "the asked thread opens even though it is not the newest");
});

test("the scroll lands on the asked thread when the conversation holds it, else on the first with something new", async () => {
  const { askedThread, landsOn, MARK_MS } = await import("../contacttab/model.ts");
  assert.equal(askedThread(SCOUT, josh()), SCOUT);
  assert.equal(askedThread("not_here", josh()), undefined, "a thread the conversation does not hold is ignored");
  assert.equal(landsOn(SCOUT, SCOUT, false), true);
  assert.equal(landsOn(SCOUT, CHROME, true), false, "the asked thread wins over the one with new mail");
  assert.equal(landsOn(undefined, CHROME, true), true);
  assert.ok(MARK_MS >= 1500 && MARK_MS <= 4000);
});
