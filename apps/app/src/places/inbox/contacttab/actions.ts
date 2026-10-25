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
