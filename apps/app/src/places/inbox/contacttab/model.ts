// ContactTab model: the pure part (spec 3.3, 2.18). What the thread's items turn into on screen (emails with the quoted text folded, text bubbles grouped, calls with the player,
// campaign steps as quiet lines, record chips), the composer's state (Email or Text, the sending inbox, recipients, subject, text), what a send asks of the capabilities, and the Gate line
// of an agent's draft. No React, no clock of its own.
import type { CapMap } from "../../../../../../generated/types.ts";
import { dayOf } from "../sidebar/model.ts";

export type ThreadOut = CapMap["inbox.thread"]["out"];
export type ThreadItem = ThreadOut["items"][number];
export type Conversation = ThreadOut["conversation"];
export type SendOptions = CapMap["inbox.send_options"]["out"];
export type SendInbox = SendOptions["inboxes"][number];
export type DraftRow = CapMap["mail.drafts.list"]["out"]["drafts"][number];
export type Party = { address: string; name?: string; contactId?: string };

export type Chan = "email" | "sms";

// ---------------------------------------------------------------- item payloads

/** What the thread gives for each kind of item beyond title and preview. `ref` is opaque in the contract; these are the shapes the server fills for the contact tab. */
export interface EmailRef {
  subject?: string;
  body?: string;
  /** The quoted text of earlier messages, folded until asked for. */
  quoted?: string;
  from?: string;
  /** The inbox it came in or went out on, as the sidebar names it. */
  via?: string;
  /** Name of the agent that wrote an outward message ("Drafted by an agent"). */
  agent?: string;
  campaign?: string;
  attachments?: { name: string; size?: string }[];
  chips?: { title: string; recordId?: string }[];
  /** Delivery state of an outward message: queued, sent, delivered, bounced, complained. */
  status?: "queued" | "sent" | "delivered" | "bounced" | "complained";
  messageId?: string;
}
export interface SmsRef { body?: string; via?: string; status?: string; /** The other side's number. */ address?: string }
export interface CallRef {
  state?: "completed" | "missed" | "voicemail" | "failed" | "busy";
  durationSec?: number;
  summary?: string;
  via?: string;
  recordingUrl?: string;
  recording?: boolean;
  transcript?: { who: string; text: string }[];
  notes?: string;
  /** The other side's number. */
  address?: string;
  /** A meeting that ended: its title, recording and summary land here like a call. */
  meetingTitle?: string;
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function emailRef(i: ThreadItem): EmailRef {
  const r = rec(i.ref);
  const out: EmailRef = {};
  const subject = str(r["subject"]) ?? i.title, body = str(r["body"]) ?? i.preview;
  if (subject !== undefined) out.subject = subject;
  if (body !== undefined) out.body = body;
  for (const k of ["quoted", "from", "via", "agent", "campaign", "messageId"] as const) { const v = str(r[k]); if (v !== undefined) out[k] = v; }
  const st = str(r["status"]);
  if (st === "queued" || st === "sent" || st === "delivered" || st === "bounced" || st === "complained") out.status = st;
  if (Array.isArray(r["attachments"])) out.attachments = (r["attachments"] as unknown[]).map(rec).map((a) => ({ name: str(a["name"]) ?? "File", ...(str(a["size"]) ? { size: str(a["size"]) as string } : {}) }));
  if (Array.isArray(r["chips"])) out.chips = (r["chips"] as unknown[]).map(rec).map((c) => ({ title: str(c["title"]) ?? "Record", ...(str(c["recordId"]) ? { recordId: str(c["recordId"]) as string } : {}) }));
  return out;
}

/** The header's company and record chip: the server marks one record_chip item `header` (its title is the chip, `company` the line beside the name). It is not a line in the feed. */
export interface HeaderChip { title: string; recordId?: string; company?: string }
export function headerRef(i: ThreadItem): HeaderChip | null {
  if (i.kind !== "record_chip") return null;
  const r = rec(i.ref);
  if (r["header"] !== true) return null;
  return { title: i.title ?? "Record", ...(i.recordId ? { recordId: i.recordId } : {}), ...(str(r["company"]) ? { company: str(r["company"]) as string } : {}) };
}
export const headerOf = (items: readonly ThreadItem[]): HeaderChip | null => { for (const i of items) { const h = headerRef(i); if (h) return h; } return null; };

export function smsRef(i: ThreadItem): SmsRef {
  const r = rec(i.ref);
  return { body: str(r["body"]) ?? i.preview ?? "", ...(str(r["via"]) ? { via: str(r["via"]) as string } : {}), ...(str(r["status"]) ? { status: str(r["status"]) as string } : {}), ...(str(r["address"]) ? { address: str(r["address"]) as string } : {}) };
}

export function callRef(i: ThreadItem): CallRef {
  const r = rec(i.ref);
  const out: CallRef = {};
  const st = str(r["state"]);
  if (st === "completed" || st === "missed" || st === "voicemail" || st === "failed" || st === "busy") out.state = st;
  if (typeof r["durationSec"] === "number") out.durationSec = r["durationSec"];
  const summary = str(r["summary"]) ?? i.preview;
  if (summary) out.summary = summary;
  for (const k of ["via", "recordingUrl", "notes", "meetingTitle", "address"] as const) { const v = str(r[k]); if (v !== undefined) out[k] = v; }
  if (r["recording"] === true || out.recordingUrl !== undefined) out.recording = true;
  if (Array.isArray(r["transcript"])) out.transcript = (r["transcript"] as unknown[]).map(rec).map((l) => ({ who: str(l["who"]) ?? "", text: str(l["text"]) ?? "" }));
  return out;
}

export function duration(sec: number | undefined): string {
  if (sec === undefined) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- the feed

/** The feed in reading order (oldest first, the newest at the foot next to the composer), with day separators and runs of texts folded into one group. */
export type FeedEntry =
  | { kind: "day"; key: string; label: string }
  | { kind: "email"; key: string; item: ThreadItem; ref: EmailRef }
  | { kind: "texts"; key: string; direction: "in" | "out"; via: string; items: { id: string; at: number; body: string }[]; at: number }
  | { kind: "call"; key: string; item: ThreadItem; ref: CallRef; meeting: boolean }
  | { kind: "step"; key: string; item: ThreadItem }
  | { kind: "chip"; key: string; item: ThreadItem }
  | { kind: "note"; key: string; item: ThreadItem };

/** Texts from the same side and number within this long join one group of bubbles. */
export const GROUP_MS = 30 * 60_000;

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Today, Yesterday, then the weekday and date. */
export function dayLabel(at: number, now: number, offsetMin: number): string {
  const age = dayOf(now, offsetMin) - dayOf(at, offsetMin);
  if (age <= 0) return "Today";
  if (age === 1) return "Yesterday";
  const d = new Date(at + offsetMin * 60_000);
  return `${WEEK[d.getUTCDay()] ?? ""} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()] ?? ""}`;
}

/** The clock time of an item: 10:15 AM. */
export function clockTime(at: number, offsetMin: number): string {
  const d = new Date(at + offsetMin * 60_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function buildFeed(items: readonly ThreadItem[], now: number, offsetMin: number): FeedEntry[] {
  const sorted = [...items].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const out: FeedEntry[] = [];
  let day = "";
  let open: Extract<FeedEntry, { kind: "texts" }> | null = null;
  for (const i of sorted) {
    if (headerRef(i)) continue;
    const label = dayLabel(i.at, now, offsetMin);
    if (label !== day) { out.push({ kind: "day", key: `day:${dayOf(i.at, offsetMin)}`, label }); day = label; open = null; }
    switch (i.kind) {
      case "email": open = null; out.push({ kind: "email", key: i.id, item: i, ref: emailRef(i) }); break;
      case "sms": {
        const r = smsRef(i), dir = i.direction ?? "in", via = r.via ?? "";
        if (open && open.direction === dir && open.via === via && i.at - open.at <= GROUP_MS) { open.items.push({ id: i.id, at: i.at, body: r.body ?? "" }); open.at = i.at; }
        else { open = { kind: "texts", key: i.id, direction: dir, via, items: [{ id: i.id, at: i.at, body: r.body ?? "" }], at: i.at }; out.push(open); }
        break;
      }
      case "call": case "meeting": open = null; out.push({ kind: "call", key: i.id, item: i, ref: callRef(i), meeting: i.kind === "meeting" }); break;
      case "campaign_step": open = null; out.push({ kind: "step", key: i.id, item: i }); break;
      case "record_chip": open = null; out.push({ kind: "chip", key: i.id, item: i }); break;
      case "note": open = null; out.push({ kind: "note", key: i.id, item: i }); break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- calls

export function callLabel(ref: CallRef, direction: "in" | "out" | undefined, meeting: boolean): string {
  if (meeting) return ref.meetingTitle ?? "Meeting";
  if (ref.state === "missed" || ref.state === "failed" || ref.state === "busy") return "Missed call";
  if (ref.state === "voicemail") return "Voicemail";
  return direction === "out" ? "Outgoing call" : "Incoming call";
}

export const isMissed = (ref: CallRef): boolean => ref.state === "missed" || ref.state === "failed" || ref.state === "busy";

// ---------------------------------------------------------------- the send options

export interface InboxChoice { id: string; kind: "mailbox" | "number"; address: string; label: string; isDefault: boolean }

/** The inboxes a message of this channel can go out from. `label` is the name the sidebar shows (a mailbox title, a number). */
export function choicesFor(chan: Chan, options: SendOptions | null, titles: ReadonlyMap<string, string>): InboxChoice[] {
  if (!options) return [];
  const kind = chan === "email" ? "mailbox" : "number";
  return options.inboxes.filter((x) => x.kind === kind && x.canSend).map((x) => ({ id: x.id, kind: x.kind, address: x.address, label: titles.get(x.id) ?? x.address, isDefault: x.isDefault }));
}

/** Replies go out from the inbox the thread came in on; otherwise the default; otherwise the first. */
export function pickInbox(choices: readonly InboxChoice[], cameIn: readonly string[]): InboxChoice | null {
  return choices.find((c) => cameIn.includes(c.id)) ?? choices.find((c) => c.isDefault) ?? choices[0] ?? null;
}

/** The channel the composer opens on: the one the last message used when it can be answered, else Email when there is one. */
export function startChannel(last: Conversation["lastChannel"], options: SendOptions | null): Chan {
  const can = (c: Chan): boolean => options?.channels.includes(c) ?? false;
  if (last === "sms" && can("sms")) return "sms";
  if (can("email")) return "email";
  if (can("sms")) return "sms";
  return "email";
}

// ---------------------------------------------------------------- composer

export interface ComposerDraft {
  chan: Chan;
  /** Per channel: the inbox id picked by hand, or null for the automatic choice. */
  from: Record<Chan, string | null>;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  /** The agent draft being edited, so a send names it (draftId) and clears it. */
  draftId: string | null;
}

const isEmail = (a: string): boolean => a.includes("@");

/** The address an email goes to: the conversation's own when it is one, else the newest sender seen on an email. */
export function emailTarget(conv: Conversation, items: readonly ThreadItem[]): string | null {
  if (isEmail(conv.address)) return conv.address;
  const e = [...items].filter((i) => i.kind === "email" && i.direction !== "out").sort((a, b) => b.at - a.at)[0];
  return (e ? emailRef(e).from : undefined) ?? null;
}

/** The number a text goes to: the conversation's own when it is one, else the other side of the newest text or call. */
export function textTarget(conv: Conversation, items: readonly ThreadItem[]): string | null {
  if (!isEmail(conv.address)) return conv.address;
  for (const i of [...items].sort((a, b) => b.at - a.at)) {
    const a = i.kind === "sms" ? smsRef(i).address : i.kind === "call" ? callRef(i).address : undefined;
    if (a) return a;
  }
  return null;
}

export function initialDraft(conv: Conversation, chan: Chan, items: readonly ThreadItem[]): ComposerDraft {
  const to = emailTarget(conv, items);
  const lastMail = [...items].filter((i) => i.kind === "email").sort((a, b) => b.at - a.at)[0];
  return { chan, from: { email: null, sms: null }, to: to ? [to] : [], cc: [], bcc: [], subject: replySubject(lastMail ? emailRef(lastMail).subject : undefined), text: "", draftId: null };
}

export function replySubject(last: string | undefined): string {
  if (!last) return "";
  return /^re:/i.test(last.trim()) ? last.trim() : `Re: ${last.trim()}`;
}

export function canSend(d: ComposerDraft, inbox: InboxChoice | null, online: boolean, textTo: string | null): boolean {
  if (!online || !inbox || d.text.trim() === "") return false;
  if (d.chan === "email") return d.to.length > 0 && d.subject.trim() !== "";
  return textTo !== null;
}

/** Why Send is off, in a few words, for the tooltip. */
export function sendBlocker(d: ComposerDraft, inbox: InboxChoice | null, online: boolean, textTo: string | null): string {
  if (!online) return "You are offline";
  if (!inbox) return d.chan === "email" ? "No mailbox can send" : "No number can send";
  if (d.chan === "email" && d.to.length === 0) return "Add a recipient";
  if (d.chan === "sms" && textTo === null) return "No phone number for this contact";
  if (d.chan === "email" && d.subject.trim() === "") return "Add a subject";
  if (d.text.trim() === "") return "Write a message";
  return "";
}

export function party(address: string, conv: Conversation): Party {
  return address.toLowerCase() === conv.address.toLowerCase() ? { address, name: conv.displayName, ...(conv.contactId ? { contactId: conv.contactId } : {}) } : { address };
}

/** The mail.send input for the draft. The idempotency key makes a retry the same send. */
export function mailInput(d: ComposerDraft, inbox: InboxChoice, conv: Conversation, key: string, replyTo?: string): CapMap["mail.send"]["in"] {
  return {
    mailboxId: inbox.id,
    to: d.to.map((a) => party(a, conv)),
    ...(d.cc.length ? { cc: d.cc.map((a) => party(a, conv)) } : {}),
    ...(d.bcc.length ? { bcc: d.bcc.map((a) => party(a, conv)) } : {}),
    subject: d.subject.trim(),
    text: d.text,
    ...(replyTo ? { replyToMessageId: replyTo } : {}),
    ...(conv.contactId ? { contactId: conv.contactId } : {}),
    ...(d.draftId ? { draftId: d.draftId } : {}),
    idempotencyKey: key,
  };
}

export function smsInput(d: ComposerDraft, inbox: InboxChoice, conv: Conversation, to: string, key: string): CapMap["telephony.send_sms"]["in"] {
  return { numberId: inbox.id, to, body: d.text, ...(conv.contactId ? { contactId: conv.contactId } : {}), idempotencyKey: key };
}

/** The id of the newest inbound email, which a reply answers. */
export function lastInboundEmail(items: readonly ThreadItem[]): ThreadItem | undefined {
  return [...items].filter((i) => i.kind === "email" && i.direction !== "out").sort((a, b) => b.at - a.at)[0];
}

// ---------------------------------------------------------------- agent drafts and the Gate

export interface DraftCard {
  id: string;
  agent: string;
  channel: Chan;
  subject: string;
  body: string;
  via: string;
  mailboxId: string;
  contactId?: string;
  to: string[];
}

/** An agent's draft for this contact, as the card shows it. A draft with no agent name is the person's own saved draft and is not a card. */
export function draftCards(drafts: readonly DraftRow[], titles: ReadonlyMap<string, string>, agentNames: ReadonlyMap<string, string>): DraftCard[] {
  const out: DraftCard[] = [];
  for (const d of drafts) {
    if (d.status !== "draft" || !d.draftedByAgent) continue;
    // a draft addressed to a phone number (no @) is a text: it has no subject and sends from a number
    const text = d.to.length > 0 && d.to.every((t) => !t.address.includes("@"));
    out.push({
      id: d.id, agent: agentNames.get(d.draftedByAgent) ?? d.draftedByAgent, channel: text ? "sms" : "email", subject: text ? "" : d.subject, body: d.snippet, via: titles.get(d.mailboxId) ?? d.mailboxId, mailboxId: d.mailboxId, ...(d.contactId ? { contactId: d.contactId } : {}), to: d.to.map((t) => t.address),
    });
  }
  return out;
}

/** The line under an agent's draft: who sends, from where, and that a person approves first (spec 2.14: every agent send passes the Gate). */
export function gateLine(agent: string, via: string): string {
  return `Gate: ${agent} sends from ${via} after you approve`;
}

/** After Send on a draft the capability may answer `held`: the send waits for approval in Needs you. */
export function sentNote(status: CapMap["mail.send"]["out"]["status"], via: string): string {
  switch (status) {
    case "held": return "Waiting for approval in Needs you";
    case "suppressed": return "Not sent: this address is on the suppression list";
    case "queued": return `Sending from ${via}`;
    case "sent": return `Sent from ${via}`;
  }
}

/** Delivery badge on an outward email. Only the states that need attention show. */
export function deliveryNote(status: EmailRef["status"]): string {
  if (status === "bounced") return "Bounced";
  if (status === "complained") return "Marked as spam";
  return "";
}

// ---------------------------------------------------------------- templates and snippets

export interface Canned { name: string; body: string }
/** The person's saved templates (a subject and body) and snippets (a few lines); the sample space has a few so the / menu is not empty. */
export const TEMPLATES: readonly Canned[] = [
  { name: "Book a call", body: "Hi {first},\n\nThanks for reaching out. I have time Tuesday or Thursday this week. Which works better for a 20 minute call?\n" },
  { name: "Send the documents", body: "Hi {first},\n\nThe documents are attached. Please look them over and tell me what you would like to change.\n" },
];
export const SNIPPETS: readonly Canned[] = [
  { name: "Thanks", body: "Thank you, I appreciate it." },
  { name: "Office hours", body: "We are open Monday to Friday, 9 to 5." },
];

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** A template with the contact's first name filled in. */
export function fill(body: string, conv: Conversation): string {
  return body.replaceAll("{first}", firstName(conv.displayName));
}

/** The / menu of the composer: templates (with the contact's first name filled in) and snippets. */
export function cannedLists(conv: Conversation): { templates: { t: string; body: string; kind: string }[]; snippets: { t: string; body: string; kind: string }[] } {
  return {
    templates: TEMPLATES.map((t) => ({ t: t.name, body: fill(t.body, conv), kind: "Template" })),
    snippets: SNIPPETS.map((t) => ({ t: t.name, body: t.body, kind: "Snippet" })),
  };
}
