// ContactTab model: the pure part (spec 3.3, 2.18). What the thread's items turn into on screen (emails with the quoted text folded, text bubbles grouped, calls with the player,
// record chips), the composer's state (Email or Text, the sending inbox, recipients, subject, text), what a send asks of the capabilities, and the Gate line
// of an agent's draft. No React, no clock of its own.
import type { CapMap } from "../../../../../../generated/types.ts";
import { dayOf } from "../sidebar/model.ts";

export type ThreadOut = CapMap["inbox.thread"]["out"];
/** A contact's email threads, each whole (inbox.threads): the feed draws one card per thread. */
export type ThreadsOut = CapMap["inbox.threads"]["out"];
export type MailThread = ThreadsOut["threads"][number];
export type ThreadMsg = MailThread["messages"][number]["message"];
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
  for (const k of ["quoted", "from", "via", "agent", "messageId"] as const) { const v = str(r[k]); if (v !== undefined) out[k] = v; }
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
/** The To chips: the contact's own address shows as their name, other addresses as they are. */
export function namedTo(to: readonly string[], address: string, name: string | null): (string | { email: string; name: string })[] {
  const out: (string | { email: string; name: string })[] = [];
  for (const a of to) out.push(name !== null && a === address ? { email: a, name } : a);
  return out;
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
  | { kind: "thread"; key: string; thread: MailThread; at: number }
  | { kind: "texts"; key: string; direction: "in" | "out"; via: string; items: { id: string; at: number; body: string }[]; at: number }
  | { kind: "call"; key: string; item: ThreadItem; ref: CallRef; meeting: boolean }
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

/**
 * The feed. With the contact's threads (inbox.threads) every email thread is one card, placed at its last activity, and the emails it holds are not drawn again on their own;
 * texts, calls and meetings stay where they happened. Without them (an older server, or no mail yet) each email is drawn on its own as before.
 */
export function buildFeed(items: readonly ThreadItem[], now: number, offsetMin: number, threads: readonly MailThread[] = []): FeedEntry[] {
  const inThread = new Set<string>();
  const threadIds = new Set<string>();
  for (const t of threads) { threadIds.add(t.threadId); for (const m of t.messages) inThread.add(m.message.id); }
  const kept = items.filter((i) => !(i.kind === "email" && (inThread.has(i.id) || threadIds.has(str(rec(i.ref)["threadId"]) ?? ""))));
  type Step = { at: number; id: string; item?: ThreadItem; thread?: MailThread };
  const steps: Step[] = [...kept.map((i) => ({ at: i.at, id: i.id, item: i })), ...threads.map((t) => ({ at: t.lastAt, id: `thread:${t.threadId}`, thread: t }))]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const out: FeedEntry[] = [];
  let day = "";
  let open: Extract<FeedEntry, { kind: "texts" }> | null = null;
  for (const st of steps) {
    if (st.item && headerRef(st.item)) continue;
    const label = dayLabel(st.at, now, offsetMin);
    if (label !== day) { out.push({ kind: "day", key: `day:${dayOf(st.at, offsetMin)}`, label }); day = label; open = null; }
    if (st.thread) { open = null; out.push({ kind: "thread", key: st.id, thread: st.thread, at: st.at }); continue; }
    const i = st.item as ThreadItem;
    switch (i.kind) {
      case "email": open = null; out.push({ kind: "email", key: i.id, item: i, ref: emailRef(i) }); break;
      case "sms": {
        const r = smsRef(i), dir = i.direction ?? "in", via = r.via ?? "";
        if (open && open.direction === dir && open.via === via && i.at - open.at <= GROUP_MS) { open.items.push({ id: i.id, at: i.at, body: r.body ?? "" }); open.at = i.at; }
        else { open = { kind: "texts", key: i.id, direction: dir, via, items: [{ id: i.id, at: i.at, body: r.body ?? "" }], at: i.at }; out.push(open); }
        break;
      }
      case "call": case "meeting": open = null; out.push({ kind: "call", key: i.id, item: i, ref: callRef(i), meeting: i.kind === "meeting" }); break;
      case "record_chip": open = null; out.push({ kind: "chip", key: i.id, item: i }); break;
      case "note": open = null; out.push({ kind: "note", key: i.id, item: i }); break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- email threads

/** The role line of a thread card, when it matters (owner, 3 Nov). */
export function roleLine(role: MailThread["role"]): string {
  switch (role) {
    case "started": return "You started this";
    case "added_later": return "You were added later";
    case "cc": return "Cc";
    default: return "";
  }
}

const lower = (a: string): string => a.trim().toLowerCase();
/** A person on a thread by name when the thread knows it, else by address. */
export const partyName = (p: { address: string; name?: string }): string => p.name?.trim() || p.address;

/** "With Josh Cohen and Andrey Volkov": everyone on the thread but you. */
export function withLine(t: MailThread, mine: ReadonlySet<string>): string {
  const names = t.participants.filter((p) => !mine.has(lower(p.address))).map(partyName);
  if (names.length === 0) return "Only you";
  if (names.length === 1) return `With ${names[0]}`;
  if (names.length === 2) return `With ${names[0]} and ${names[1]}`;
  if (names.length === 3) return `With ${names[0]}, ${names[1]} and ${names[2]}`;
  return `With ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** A one-line preview that stops at a word and says so; never a broken word. */
export function cutWords(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const room = Math.max(1, max - 1);
  const at = flat.lastIndexOf(" ", room);
  return `${(at > room * 0.5 ? flat.slice(0, at) : flat.slice(0, room)).replace(/[\s,.;:-]+$/, "")}\u2026`;
}

/** What a collapsed message says: the first words written this time, past a greeting. */
export function msgPreview(m: ThreadMsg, max = 140): string {
  return cutWords(m.body.replace(/^\s*(hi|hello|hey|dear)\b[^\n]{0,40}\n+/i, ""), max);
}

export const isMine = (address: string, mine: ReadonlySet<string>): boolean => mine.has(lower(address));

/** Who sent a message, as the card names them: You, else their name. */
export function senderName(m: ThreadMsg, mine: ReadonlySet<string>): string {
  return isMine(m.from.address, mine) ? "You" : partyName(m.from);
}

/** "to you, cc Maya": the recipients in a few words, first names and you. */
export function recipientLine(m: ThreadMsg, mine: ReadonlySet<string>): string {
  const short = (p: { address: string; name?: string }): string => (isMine(p.address, mine) ? "you" : firstName(partyName(p)));
  const list = (ps: readonly { address: string; name?: string }[]): string => (ps.length <= 2 ? ps.map(short).join(" and ") : `${ps.slice(0, 2).map(short).join(", ")} and ${ps.length - 2} more`);
  return [m.to.length ? `to ${list(m.to)}` : "", m.cc.length ? `cc ${list(m.cc)}` : ""].filter(Boolean).join(", ");
}

/** A file size as people say it: 412 KB, 1.2 MB. Nothing for an unknown size. */
export function sizeLabel(bytes: number): string {
  if (!(bytes > 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Today a clock time; otherwise the weekday or the date, and the time. */
export function whenLabel(at: number, now: number, offsetMin: number): string {
  const age = dayOf(now, offsetMin) - dayOf(at, offsetMin);
  if (age <= 0) return clockTime(at, offsetMin);
  if (age === 1) return `Yesterday ${clockTime(at, offsetMin)}`;
  const d = new Date(at + offsetMin * 60_000);
  return age < 7 ? `${WEEK[d.getUTCDay()] ?? ""} ${clockTime(at, offsetMin)}` : `${d.getUTCDate()} ${MONTH[d.getUTCMonth()] ?? ""}`;
}

/** Which threads open by default: any with something new, and the newest. A person's own toggle wins. */
/** How long the thread a link asked for stays marked. */
export const MARK_MS = 2200;
/** The thread a link asked for, when this conversation holds it; otherwise nothing, and the conversation opens as it always does. */
export const askedThread = (asked: string | undefined, all: readonly MailThread[]): string | undefined => (asked !== undefined && all.some((t) => t.threadId === asked) ? asked : undefined);
/** Which thread the feed scrolls to: the asked one when there is one, else the first with something new. */
export const landsOn = (asked: string | undefined, threadId: string, firstFresh: boolean): boolean => (asked !== undefined ? asked === threadId : firstFresh);

export function threadOpen(t: MailThread, all: readonly MailThread[], fresh: ReadonlySet<string>, toggled: Readonly<Record<string, boolean>>): boolean {
  const own = toggled[t.threadId];
  if (own !== undefined) return own;
  const newest = [...all].sort((a, b) => b.lastAt - a.lastAt)[0];
  return t === newest || t.messages.some((m) => fresh.has(m.message.id));
}

/** Inside an open thread the newest message and every new one are in full; older ones are one line. */
export function messageOpen(t: MailThread, m: ThreadMsg, fresh: ReadonlySet<string>, toggled: Readonly<Record<string, boolean>>): boolean {
  const own = toggled[m.id];
  if (own !== undefined) return own;
  return t.messages[t.messages.length - 1]?.message.id === m.id || fresh.has(m.id);
}

/** The message a reply from this mailbox answers: the newest one the mailbox holds. None when the mailbox holds none of the thread (the reply then goes as a new email with the thread's subject). */
export function replyMessage(t: MailThread, mailboxId: string | null): ThreadMsg | undefined {
  if (!mailboxId) return undefined;
  return [...t.messages].reverse().map((x) => x.message).find((m) => m.mailboxIds.includes(mailboxId) || m.mailboxId === mailboxId);
}

/** The mailbox a reply in this thread goes out from by default: the newest message's mailbox that can send. */
export function threadMailbox(t: MailThread, can: readonly string[]): string | null {
  for (const x of [...t.messages].reverse()) for (const id of [x.message.mailboxId, ...x.message.mailboxIds]) if (can.includes(id)) return id;
  return null;
}

/** Reply or Reply all in a thread: who it goes to, keeping Cc on Reply all, never you. */
export function replyTarget(t: MailThread, mode: "one" | "all", mine: ReadonlySet<string>): { to: string[]; cc: string[]; subject: string } {
  const last = [...t.messages].reverse().map((x) => x.message).find((m) => !isMine(m.from.address, mine)) ?? t.messages[t.messages.length - 1]?.message;
  const subject = replySubject(t.subject);
  if (!last) return { to: [], cc: [], subject };
  const fromMe = isMine(last.from.address, mine);
  const not = (a: string): boolean => !isMine(a, mine);
  const uniq = (xs: string[]): string[] => [...new Map(xs.map((x) => [lower(x), x])).values()];
  if (mode === "one") return { to: fromMe ? last.to.slice(0, 1).map((p) => p.address) : [last.from.address], cc: [], subject };
  const to = uniq([...(fromMe ? [] : [last.from.address]), ...last.to.map((p) => p.address)].filter(not));
  const cc = uniq(last.cc.map((p) => p.address).filter(not)).filter((a) => !to.some((x) => lower(x) === lower(a)));
  return { to, cc, subject };
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

export interface InboxChoice { id: string; kind: "mailbox" | "number"; address: string; label: string; isDefault: boolean;
  /** Set when the choice came from comms.senders.list: sends name it, with the same id as the mailbox or number. */
  senderId?: string }

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
  /** Files kept in Vyre Files that go with the send: an email's attachments, a text's pictures. */
  fileIds?: readonly string[];
  /** The email thread a reply goes into; null starts a separate thread (New email). Absent when the contact has no threads. */
  th?: string | null;
  /** Reply or Reply all in that thread. */
  mode?: "one" | "all";
  /** The message the reply answers, picked for the sending mailbox; null sends with no reply target. Absent: the newest inbound email. */
  replyTo?: string | null;
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

export function initialDraft(conv: Conversation, chan: Chan, items: readonly ThreadItem[], threads: readonly MailThread[] = [], mine: ReadonlySet<string> = new Set()): ComposerDraft {
  // with threads, the composer replies in the newest one, to everyone on it
  const newest = [...threads].sort((a, b) => b.lastAt - a.lastAt)[0];
  if (newest) {
    const t = replyTarget(newest, "all", mine);
    return { chan, from: { email: null, sms: null }, to: t.to, cc: t.cc, bcc: [], subject: t.subject, text: "", draftId: null, th: newest.threadId, mode: "all" };
  }
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
    ...(inbox.senderId ? { senderId: inbox.senderId } : {}),
    to: d.to.map((a) => party(a, conv)),
    ...(d.cc.length ? { cc: d.cc.map((a) => party(a, conv)) } : {}),
    ...(d.bcc.length ? { bcc: d.bcc.map((a) => party(a, conv)) } : {}),
    subject: d.subject.trim(),
    text: d.text,
    ...(replyTo ? { replyToMessageId: replyTo } : {}),
    ...(conv.contactId ? { contactId: conv.contactId } : {}),
    ...(d.draftId ? { draftId: d.draftId } : {}),
    ...(d.fileIds && d.fileIds.length > 0 ? { attachments: [...d.fileIds] } : {}),
    idempotencyKey: key,
  };
}

export function smsInput(d: ComposerDraft, inbox: InboxChoice, conv: Conversation, to: string, key: string): CapMap["telephony.send_sms"]["in"] {
  return { numberId: inbox.id, ...(inbox.senderId ? { senderId: inbox.senderId } : {}), to, body: d.text, ...(d.fileIds && d.fileIds.length > 0 ? { mediaFileIds: [...d.fileIds] } : {}), ...(conv.contactId ? { contactId: conv.contactId } : {}), idempotencyKey: key };
}

/** The id of the newest inbound email, which a reply answers. */
export function lastInboundEmail(items: readonly ThreadItem[]): ThreadItem | undefined {
  return [...items].filter((i) => i.kind === "email" && i.direction !== "out").sort((a, b) => b.at - a.at)[0];
}

// ---------------------------------------------------------------- agent drafts and the Gate

export interface DraftCard {
  id: string;
  agent: string;
  /** The agent that wrote it, for a lesson from Don't send. */
  agentId?: string;
  /** Who it goes to and who is copied, with the names the directory has: the card shows them before Send. */
  toParties: Party[];
  ccParties: Party[];
  channel: Chan;
  subject: string;
  body: string;
  via: string;
  mailboxId: string;
  contactId?: string;
  to: string[];
  /** The address or number it sends from, for the plain line under the draft. */
  from: string;
  /** When the agent last wrote it, and the draft it replaced: "Updated 5:45 AM" with the earlier text one click away. */
  updatedAt: number;
  earlier?: { at: number; text: string; subject: string };
}

/** An agent's draft for this contact, as the card shows it. A draft with no agent name is the person's own saved draft and is not a card. */
export function draftCards(drafts: readonly DraftRow[], titles: ReadonlyMap<string, string>, agentNames: ReadonlyMap<string, string>, addresses: ReadonlyMap<string, string> = new Map()): DraftCard[] {
  const out: DraftCard[] = [];
  for (const d of drafts) {
    if (d.status !== "draft" || !d.draftedByAgent) continue;
    // a draft addressed to a phone number (no @) is a text: it has no subject and sends from a number
    const text = d.to.length > 0 && d.to.every((t) => !t.address.includes("@"));
    out.push({
      id: d.id, agent: agentNames.get(d.draftedByAgent) ?? "An agent", agentId: d.draftedByAgent, toParties: d.to.map((p) => ({ address: p.address, ...(p.name ? { name: p.name } : {}) })), ccParties: (d.cc ?? []).map((p) => ({ address: p.address, ...(p.name ? { name: p.name } : {}) })), channel: text ? "sms" : "email", subject: text ? "" : d.subject, body: d.snippet, via: titles.get(d.mailboxId) ?? d.mailboxId, mailboxId: d.mailboxId, from: addresses.get(d.mailboxId) ?? titles.get(d.mailboxId) ?? (/^\+?[\d\s()-]{7,}$/.test(d.mailboxId) ? d.mailboxId : ""), updatedAt: d.sentAt, ...(d.earlier ? { earlier: d.earlier } : {}), ...(d.contactId ? { contactId: d.contactId } : {}), to: d.to.map((t) => t.address),
    });
  }
  return out;
}

/** The plain line under an agent's draft: where it sends from and that nothing goes until the person presses Send. No system words and no ids. */
export function sendsLine(from: string): string {
  return from ? `Sends from ${from} when you press Send` : "Sends when you press Send";
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
// What the person saved comes from the Space: templates are email designs (email_builder.list) and snippets are composer snippets (email_builder.snippets.list), read by contacttab/actions.ts.

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** A template with the contact's first name filled in. */
export function fill(body: string, conv: Conversation): string {
  return body.replaceAll("{first}", firstName(conv.displayName));
}

/** The / menu of the composer: the person's snippets. Templates are chosen from the Templates button, where each is an email design that can also be edited in the email builder. */
export function cannedLists(_conv: Conversation, snippets: readonly Canned[] = []): { templates: { t: string; body: string; kind: string }[]; snippets: { t: string; body: string; kind: string }[] } {
  return { templates: [], snippets: snippets.map((t) => ({ t: t.name, body: t.body, kind: "Snippet" })) };
}
