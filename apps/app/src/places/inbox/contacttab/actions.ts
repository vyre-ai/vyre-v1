// What the contact tab asks of the capabilities: one function per action, so the screen and the tests call the same code. Each returns the quiet line to show afterwards.
import type { InboxData } from "../sidebar/data.tsx";
import { lastInboundEmail, mailInput, sentNote, smsInput } from "./model.ts";
import type { Conversation, DraftCard, ComposerDraft, InboxChoice, ThreadItem } from "./model.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

export const newKey = (): string => globalThis.crypto.randomUUID();

export async function sendEmail(data: InboxData, d: ComposerDraft, inbox: InboxChoice, conv: Conversation, items: readonly ThreadItem[], key: string = newKey()): Promise<string> {
  const reply = lastInboundEmail(items);
  const out = (await data.call("mail.send", mailInput(d, inbox, conv, key, reply?.id))) as CapMap["mail.send"]["out"];
  return sentNote(out.status, inbox.label);
}

export async function sendText(data: InboxData, d: ComposerDraft, inbox: InboxChoice, conv: Conversation, to: string, key: string = newKey()): Promise<string> {
  const out = (await data.call("telephony.send_sms", smsInput(d, inbox, conv, to, key))) as CapMap["telephony.send_sms"]["out"];
  return sentNote(out.status, inbox.label);
}

/** Send on an agent's draft is the person's approval: the draft goes out as written (or as edited) from the inbox the agent chose, and the draft is cleared. */
export async function sendAgentDraft(data: InboxData, card: DraftCard, conv: Conversation, text: string, subject: string, key: string = newKey()): Promise<string> {
  if (card.channel === "sms") {
    const to = card.to[0] ?? "";
    const sms = (await data.call("telephony.send_sms", { numberId: card.mailboxId, to, body: text, ...(conv.contactId ? { contactId: conv.contactId } : {}), idempotencyKey: key })) as CapMap["telephony.send_sms"]["out"];
    await discardDraft(data, card.id);
    return sentNote(sms.status, card.via);
  }
  const inbox: InboxChoice = { id: card.mailboxId, kind: "mailbox", address: card.via, label: card.via, isDefault: false };
  const d: ComposerDraft = { chan: "email", from: { email: inbox.id, sms: null }, to: card.to, cc: [], bcc: [], subject, text, draftId: card.id };
  const out = (await data.call("mail.send", mailInput(d, inbox, conv, key))) as CapMap["mail.send"]["out"];
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
