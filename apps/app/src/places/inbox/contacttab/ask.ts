// "Ask for these": a record page asks the Inbox to open a person's conversation with a message already drafted for the fields the record still lacks. The draft is plain text the person can
// change; nothing is sent until they press Send. This file is the pure part (the drafts, the quick form's link in them, who can use a quick form) and the one-use form that backs the link.
import { phoneCanReach } from "../../../shell/session/reach.ts";
import type { Chan, ComposerDraft, Conversation, ThreadOut } from "./model.ts";

/** What a one-use form needs: the record whose empty fields it asks, and where the answers go (the same record). */
export interface AskFormPlan {
  /** The record's type and id: the form is made on this type and its link is for this record. */
  type: string;
  recordId: string;
  name: string;
  fields: { field: string; title: string }[];
  /** False in a Space with no public address or where publishing is not allowed. The composer then shows a quiet note and no toggle. */
  available: boolean;
}

export interface AskRequest {
  /** Idempotency for the form and its link: one click makes at most one of each. */
  id: string;
  contactId: string;
  name: string;
  first: string;
  sender: string;
  email?: { to: string };
  phone?: { to: string };
  /** The titles of the fields asked for, in the page's words. */
  titles: string[];
  form: AskFormPlan;
}

export const QUICK_FORM_NOTE = "Quick forms need a Team Space";
export const ASK_SUBJECT = "A few details for your file";

/** "a, b and c" from titles, lower case. */
export function listOf(titles: readonly string[]): string {
  const names = titles.map((t) => t.trim().toLowerCase()).filter((t) => t !== "");
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The channel the draft opens on: email when there is an address, else text. */
export function startChannel(req: Pick<AskRequest, "email" | "phone">): Chan {
  return req.email ? "email" : "sms";
}

/** What the composer starts with: the channel, the person's address on an email, the subject and the body. */
export function askStart(req: Pick<AskRequest, "email" | "phone" | "first" | "sender" | "titles">): Partial<ComposerDraft> {
  const chan = startChannel(req), seed = seedFor(req, chan);
  return chan === "email" ? { chan, to: req.email ? [req.email.to] : [], subject: seed.subject, text: seed.text } : { chan, text: seed.text };
}

/** The conversation the tab writes in: the real one once it has loaded, else (the person has never written to them) a new one, which the first send makes. Null while still loading. */
export function conversationOf(thread: { status: "loading"; error?: unknown } | { status: "ready"; data: ThreadOut }, ask: AskRequest | undefined, now: number): Conversation | null {
  if (thread.status === "ready") return thread.data.conversation;
  return ask && thread.error !== undefined ? newConversation(ask, now) : null;
}

/** The draft for a channel, untouched: the email's subject and body, or the text's one line. With a link, the form's address is part of the ask. */
export function seedFor(req: Pick<AskRequest, "first" | "sender" | "titles">, chan: Chan, link?: string): { subject: string; text: string } {
  const list = listOf(req.titles);
  if (chan === "sms") {
    return { subject: "", text: `Hi ${req.first}, could you send me your ${list}?${link ? ` You can answer here: ${link}` : ""}` };
  }
  const body = `Hi ${req.first},\n\nCould you send me your ${list}?${link ? `\nThe quickest way is this form: ${link}` : ""}\n\nThanks,\n${req.sender}`;
  return { subject: ASK_SUBJECT, text: body };
}

/** The text with the form's link in it: an untouched draft becomes the draft with the link, an edited one gets the link on a new line at the foot. */
export function withLink(req: Pick<AskRequest, "first" | "sender" | "titles">, chan: Chan, text: string, url: string): string {
  if (text.includes(url)) return text;
  if (text === seedFor(req, chan).text) return seedFor(req, chan, url).text;
  return `${text.trimEnd()}\n\n${url}`;
}

/** The text without the form's link: the draft the link came with goes back to the plain draft; in an edited one only the link goes. */
export function withoutLink(req: Pick<AskRequest, "first" | "sender" | "titles">, chan: Chan, text: string, url: string): string {
  if (text === seedFor(req, chan, url).text) return seedFor(req, chan).text;
  return text.split(url).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** Switching Email and Text: a draft the person has not touched becomes the other channel's draft; anything they wrote stays. */
export function switchText(req: Pick<AskRequest, "first" | "sender" | "titles">, from: Chan, to: Chan, text: string, url?: string): string {
  if (from === to) return text;
  return text === seedFor(req, from, url).text ? seedFor(req, to, url).text : text;
}

/** A quick form needs an address a phone can open and a Space that may publish. */
export function quickFormAvailable(a: { spaceKind: "team" | "personal"; baseUrl?: string; reach(address: string): boolean; deferred(cap: string): boolean }): boolean {
  if (a.spaceKind !== "team" || !a.baseUrl || !a.reach(a.baseUrl)) return false;
  return !a.deferred("forms.publish") && !a.deferred("forms.link_create");
}

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** Makes the one-use form for the record, asks its empty fields, publishes it and returns the record's own link. Each step is keyed, so a retry makes nothing twice. */
export async function makeQuickForm(call: Call, plan: AskFormPlan, key: string): Promise<string> {
  const made = (await call("forms.create", { name: plan.name, recordType: plan.type, kind: "one_use", idempotencyKey: `${key}:form` })) as { form: { formId: string } };
  const formId = made.form.formId;
  await call("forms.fields_set", { formId, fields: plan.fields.map((f) => ({ field: f.field, mode: "ask" })) });
  await call("forms.publish", { formId });
  const link = (await call("forms.link_create", { formId, recordId: plan.recordId, singleUse: true, idempotencyKey: `${key}:link` })) as { url: string };
  return link.url;
}

// ---------------------------------------------------------------- the hand-off from the record page

const pending = new Map<string, AskRequest>();

/** The record page leaves the request here and the Inbox picks it up by id (the tab's address carries only the id, so a reload opens the plain conversation). */
export function putAsk(req: AskRequest): void {
  pending.set(req.id, req);
  if (pending.size > 20) pending.delete(pending.keys().next().value as string);
}
export function getAsk(id: string | undefined): AskRequest | undefined {
  return id ? pending.get(id) : undefined;
}

/** A conversation that does not exist yet, drawn so the composer has someone to write to. The first send makes it. */
export function newConversation(req: Pick<AskRequest, "contactId" | "name" | "email" | "phone">, now: number): Conversation {
  const address = req.email?.to ?? req.phone?.to ?? "";
  return {
    id: "", contactId: req.contactId, address, displayName: req.name, lastMessageAt: now, lastChannel: req.email ? "email" : "sms", lastPreview: "", unreadCount: 0,
    needsMatch: false, mailboxIds: [], followed: false, alertOnReplies: false,
  };
}

/** The request the Inbox opens with, from what the record page found: the person to ask, the fields, and whether a quick form can be made here. */
export function askRequestFor(
  input: { type: string; recordId: string; title: string; missing: { field: string; title: string }[]; contact: { contactId: string; name: string; email?: string; phone?: string } },
  env: { sender: string; spaceKind: "team" | "personal"; baseUrl?: string; deferred(cap: string): boolean; reach?(address: string): boolean },
): AskRequest {
  const name = input.contact.name.trim();
  return {
    id: globalThis.crypto.randomUUID(),
    contactId: input.contact.contactId,
    name,
    first: name.split(/\s+/)[0] || name,
    sender: env.sender,
    ...(input.contact.email ? { email: { to: input.contact.email } } : {}),
    ...(input.contact.phone ? { phone: { to: input.contact.phone } } : {}),
    titles: input.missing.map((m) => m.title),
    form: {
      type: input.type, recordId: input.recordId, name: `Details for ${input.title}`, fields: input.missing,
      available: quickFormAvailable({ spaceKind: env.spaceKind, ...(env.baseUrl ? { baseUrl: env.baseUrl } : {}), reach: env.reach ?? phoneCanReach, deferred: env.deferred }),
    },
  };
}
