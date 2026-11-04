// What the contact tab asks of the capabilities: one function per action, so the screen and the tests call the same code. Each returns the quiet line to show afterwards.
import type { InboxData } from "../sidebar/data.tsx";
import { lastInboundEmail, mailInput, sentNote, smsInput } from "./model.ts";
import type { Conversation, DraftCard, ComposerDraft, InboxChoice, ThreadItem } from "./model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export const newKey = (): string => globalThis.crypto.randomUUID();

export async function sendEmail(data: InboxData, d: ComposerDraft, inbox: InboxChoice, conv: Conversation, items: readonly ThreadItem[], key: string = newKey()): Promise<string> {
  // a reply in a thread answers the message the composer picked for this mailbox; with no thread chosen, the newest inbound email
  const reply = d.replyTo !== undefined ? (d.replyTo ?? undefined) : lastInboundEmail(items)?.id;
  const out = (await data.call("mail.send", mailInput(d, inbox, conv, key, reply))) as CapMap["mail.send"]["out"];
  return sentNote(out.status, inbox.label);
}

export async function sendText(data: InboxData, d: ComposerDraft, inbox: InboxChoice, conv: Conversation, to: string, key: string = newKey()): Promise<string> {
  const out = (await data.call("telephony.send_sms", smsInput(d, inbox, conv, to, key))) as CapMap["telephony.send_sms"]["out"];
  return sentNote(out.status, inbox.label);
}

/** A draft as it is stored: every character of its body and its own thread, recipients, Cc and subject. The card shows only a preview, so Edit and Send read this and never the preview. */
export interface FullDraft { text: string; subject: string; to: ReadonlyArray<{ address: string; name?: string | undefined; contactId?: string | undefined }>; cc: ReadonlyArray<{ address: string; name?: string | undefined; contactId?: string | undefined }>; contactId?: string | undefined; threadId: string; mailboxId: string }

export async function loadDraft(data: InboxData, draftId: string): Promise<FullDraft> {
  const out = (await data.call("mail.message.get", { messageId: draftId })) as CapMap["mail.message.get"]["out"];
  const m = out.message;
  return { text: out.text ?? "", subject: m.subject, to: m.to, cc: m.cc, ...(m.contactId ? { contactId: m.contactId } : {}), threadId: m.threadId, mailboxId: m.mailboxId };
}

/** A body that ends in a cut-off marker the person did not type: the card's preview ("...") or a draft that was cut. */
export const CUT_OFF = /(?:\.\.\.|\u2026)\s*$/;
export function cutOff(text: string, typed?: string): boolean {
  return CUT_OFF.test(text) && !(typed !== undefined && typed.trim() === text.trim());
}
export const CUT_OFF_NOTE = "That is only a preview of the draft, cut short. Open the draft to see all of it; nothing was sent.";

/** Save an edit of an agent's draft in place: its words and subject change, its recipients and its thread stay. */
export async function saveDraft(data: InboxData, card: DraftCard, edit: { text: string; subject: string }, key: string = newKey()): Promise<void> {
  if (cutOff(edit.text, "")) throw new Error(CUT_OFF_NOTE);
  await data.call("mail.draft", { mailboxId: card.mailboxId, draftId: card.id, text: edit.text, ...(card.channel === "sms" ? {} : { subject: edit.subject }), idempotencyKey: key });
}

/**
 * Send on an agent's draft is the person's approval: the draft goes out as stored (or as edited in its card), to its own recipients and Cc, in its own thread, from the inbox the agent chose, and the
 * draft is cleared. It never sends the card's preview, and never takes recipients or contact from the thread that happens to be open.
 */
export async function sendAgentDraft(data: InboxData, card: DraftCard, _conv: Conversation, edited: string, subject: string, key: string = newKey()): Promise<string> {
  const full = await loadDraft(data, card.id);
  const text = edited !== "" ? edited : full.text;
  if (text.trim() === "") throw new Error("There is nothing in this draft to send.");
  // only what the person typed may end that way: the stored text and the card's preview never go out cut
  if (cutOff(text) && !(edited !== "" && edited !== card.body)) throw new Error(CUT_OFF_NOTE);
  if (card.channel === "sms") {
    const to = card.to[0] ?? "";
    const sms = (await data.call("telephony.send_sms", { numberId: card.mailboxId, to, body: text, ...(full.contactId ? { contactId: full.contactId } : {}), idempotencyKey: key })) as CapMap["telephony.send_sms"]["out"];
    await discardDraft(data, card.id);
    return sentNote(sms.status, card.via);
  }
  const input: CapMap["mail.send"]["in"] = {
    mailboxId: card.mailboxId,
    to: full.to.map((p) => ({ address: p.address, ...(p.name ? { name: p.name } : {}), ...(p.contactId ? { contactId: p.contactId } : {}) })),
    ...(full.cc.length ? { cc: full.cc.map((p) => ({ address: p.address, ...(p.name ? { name: p.name } : {}), ...(p.contactId ? { contactId: p.contactId } : {}) })) } : {}),
    subject: (subject !== "" ? subject : full.subject).trim(),
    text,
    ...(full.contactId ? { contactId: full.contactId } : {}),
    draftId: card.id,
    idempotencyKey: key,
  };
  const out = (await data.call("mail.send", input)) as CapMap["mail.send"]["out"];
  return sentNote(out.status, card.via);
}

export async function discardDraft(data: InboxData, draftId: string): Promise<void> {
  await data.call("mail.drafts.discard", { draftId });
}

export async function setFollow(data: InboxData, contactId: string, follow: boolean, alertOnReplies?: boolean): Promise<void> {
  await data.call("inbox.follow_set", { contactId, follow, ...(alertOnReplies !== undefined ? { alertOnReplies } : {}) });
}

export async function markRead(data: InboxData, conversationId: string): Promise<void> {
  await data.call("inbox.mark_read", { conversationId, read: true });
}

/** The person's email designs, newest first: the Templates button lists them. */
export async function listTemplates(data: InboxData): Promise<{ emailId: string; name: string }[]> {
  const out = (await data.call("email_builder.list", {})) as CapMap["email_builder.list"]["out"];
  return [...out.emails].sort((a, b) => b.updatedAt - a.updatedAt).map((e) => ({ emailId: e.emailId, name: e.name }));
}

/** The person's composer snippets, mine and the Space's: the / menu lists them. */
export async function listSnippets(data: InboxData): Promise<{ name: string; body: string }[]> {
  const out = (await data.call("email_builder.snippets.list", {})) as CapMap["email_builder.snippets.list"]["out"];
  return out.snippets.map((x) => ({ name: x.name, body: x.body }));
}

const stripTags = (html: string): string => html.replace(/<(br|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();

/** What inserting a template puts in the draft: its subject and its text as plain words, with the contact's first name in place of {first}. A design written as blocks or HTML is read through its plain-text render. */
export async function templateContent(data: InboxData, emailId: string, firstName: string): Promise<{ subject: string; text: string }> {
  const got = (await data.call("email_builder.get", { emailId })) as CapMap["email_builder.get"]["out"];
  const doc = got.email;
  let text = doc.mode === "plain" ? doc.plain ?? "" : "";
  if (text.trim() === "") {
    const r = (await data.call("email_builder.render", { emailId, variant: "plain" })) as CapMap["email_builder.render"]["out"];
    text = stripTags(r.html);
  }
  return { subject: doc.subject ?? "", text: text.replaceAll("{first}", firstName) };
}
