// Inbox model: the pure part. What the sidebar groups, what the list shows, how filters narrow it and what the header says. No React, no clock of its own.
import type { CapMap } from "../../../../../../generated/types.ts";

export type View = "contact" | "thread" | "calls";
export type Channel = "email" | "sms" | "call";
/** What the sidebar has selected. Mailbox and number are one inbox each; Starred, Following and Campaigns are lists over all inboxes. */
export type Scope =
  | { kind: "all" }
  | { kind: "mailbox"; id: string }
  | { kind: "number"; id: string }
  | { kind: "starred" }
  | { kind: "follow" }
  | { kind: "camp" };
export type MainView = "list" | "calendar";

export interface InboxState {
  main: MainView;
  view: View;
  scope: Scope;
  channels: readonly Channel[];
  inboxes: readonly string[];
  needsMatch: boolean;
  query: string;
  selected: string | null;
  /** Sidebar sections folded shut, by key. */
  closed: readonly string[];
  /** Calendars hidden in the sidebar, by id. */
  hiddenCalendars: readonly string[];
}

export const INITIAL_STATE: InboxState = {
  main: "list", view: "contact", scope: { kind: "all" }, channels: [], inboxes: [], needsMatch: false, query: "", selected: null, closed: [], hiddenCalendars: [],
};

export type ContactRow = CapMap["inbox.list_by_contact"]["out"]["rows"][number];
export type ThreadRow = CapMap["inbox.list_by_thread"]["out"]["threads"][number];
export type CallRow = CapMap["telephony.call.list"]["out"]["calls"][number];
export type Mailbox = CapMap["mail.mailbox.list"]["out"]["mailboxes"][number];
export type CalendarRow = CapMap["calendar.list_calendars"]["out"]["calendars"][number];
export type Counts = CapMap["inbox.counts"]["out"];

export const SCREENS = { sidebar: "inbox.sidebar", list: "inbox.contact-list" } as const;

export const VIEW_LABEL: Record<View, string> = { contact: "By contact", thread: "By thread", calls: "Calls only" };
export const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", sms: "Text", call: "Call" };
export const CHANNELS: readonly Channel[] = ["email", "sms", "call"];

// ---------------------------------------------------------------- queries

/** The state a list query reads (generated/screens.ts pointers). Channels and inboxes beyond one are narrowed on the device; the capability takes one of each. */
export function listState(s: InboxState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.scope.kind === "mailbox") out["mailboxId"] = s.scope.id;
  if (s.scope.kind === "number") out["numberId"] = s.scope.id;
  if (s.channels.length === 1) out["channel"] = s.channels[0];
  if (s.needsMatch) out["needsMatch"] = true;
  const q = s.query.trim();
  if (q) out["query"] = q;
  return out;
}

/** Calls are listed per number; only a number scope narrows them on the server. */
export function callsState(s: InboxState): Record<string, unknown> {
  return s.scope.kind === "number" ? { numberId: s.scope.id } : {};
}

export function isFiltering(s: InboxState): boolean {
  return s.channels.length > 0 || s.inboxes.length > 0 || s.needsMatch;
}

// ---------------------------------------------------------------- entries

/** One line of the list, whichever view it comes from. */
export interface Entry {
  key: string;
  kind: "contact" | "thread" | "call";
  name: string;
  snippet: string;
  at: number;
  unread: number;
  channel: Channel | "meeting";
  /** The inbox it came in on, as the sidebar names it. */
  via: string;
  /** Inbox ids this line belongs to (mailboxes and numbers). */
  inboxIds: readonly string[];
  needsMatch: boolean;
  followed: boolean;
  /** The caller's own star on the conversation (the row's starred flag; absent on the row means not starred). */
  starred: boolean;
  campaign: boolean;
  missed: boolean;
  /** The conversation to open (contact view), the thread or the call. */
  openId: string;
  /** The matched record's contact, when there is one: follow and match act on it. */
  contactId?: string;
}

export function inboxName(id: string | undefined, mailboxes: readonly Mailbox[]): string {
  if (!id) return "";
  const m = mailboxes.find((x) => x.id === id);
  return m ? m.title : id;
}

export function contactEntry(r: ContactRow, mailboxes: readonly Mailbox[]): Entry {
  return {
    key: r.id, kind: "contact", name: r.displayName || r.address, snippet: r.lastPreview, at: r.lastMessageAt, unread: r.unreadCount, channel: r.lastChannel,
    via: inboxName(r.mailboxIds[0], mailboxes), inboxIds: r.mailboxIds, needsMatch: r.needsMatch, followed: r.followed, starred: r.starred === true, campaign: r.campaignId !== undefined,
    missed: false, openId: r.id, ...(r.contactId ? { contactId: r.contactId } : {}),
  };
}

export function threadEntry(t: ThreadRow, mailboxes: readonly Mailbox[], names: ReadonlyMap<string, string>): Entry {
  const who = (t.contactId ? names.get(t.contactId) : undefined) ?? t.participants[0] ?? "Unknown";
  return {
    key: t.threadId, kind: "thread", name: who, snippet: t.subject ?? "", at: t.lastAt, unread: t.unread, channel: t.channel, via: inboxName(t.mailboxId, mailboxes),
    inboxIds: t.mailboxId ? [t.mailboxId] : [], needsMatch: false, followed: false, starred: false, campaign: false, missed: false, openId: t.threadId, ...(t.contactId ? { contactId: t.contactId } : {}),
  };
}

export function duration(sec: number | undefined): string {
  if (sec === undefined) return "";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function callEntry(c: CallRow, names: ReadonlyMap<string, string>): Entry {
  const other = c.direction === "in" ? c.from : c.to;
  const missed = c.state === "missed" || c.state === "failed";
  const kind = c.state === "voicemail" ? "Voicemail" : c.direction === "in" ? "Incoming call" : "Outgoing call";
  const bits = [missed ? "Missed call" : kind];
  if (!missed && c.durationSec !== undefined) bits.push(duration(c.durationSec));
  if (c.summary) bits.push(c.summary);
  return {
    key: c.id, kind: "call", name: (c.contactId ? names.get(c.contactId) : undefined) ?? other, snippet: bits.join(" · "), at: c.startedAt, unread: missed ? 1 : 0,
    channel: "call", via: c.numberId, inboxIds: [c.numberId], needsMatch: c.contactId === undefined, followed: false, starred: false, campaign: false, missed, openId: c.id, ...(c.contactId ? { contactId: c.contactId } : {}),
  };
}

/** A contact line whose sender matches no record yet. */
export function pinned(e: Entry): boolean {
  return e.kind === "contact" && e.needsMatch && e.contactId === undefined;
}

/** The lines of one view, newest first, narrowed by the filters that the capabilities do not take (more than one channel or inbox, Following, Campaigns). */
export function narrow(entries: readonly Entry[], s: InboxState): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    if (s.channels.length > 0 && !(s.channels as readonly string[]).includes(e.channel === "meeting" ? "call" : e.channel)) continue;
    if (s.inboxes.length > 0 && !e.inboxIds.some((id) => s.inboxes.includes(id))) continue;
    if (s.scope.kind === "starred" && !e.starred) continue;
    if (s.scope.kind === "follow" && !e.followed) continue;
    if (s.scope.kind === "camp" && !e.campaign) continue;
    out.push(e);
  }
  // senders that match no record yet sit on top, with their "Match to a record" link; the rest run newest first
  out.sort((a, b) => Number(pinned(b)) - Number(pinned(a)) || b.at - a.at);
  return out;
}

// ---------------------------------------------------------------- the header

export function scopeTitle(scope: Scope, mailboxes: readonly Mailbox[]): string {
  switch (scope.kind) {
    case "all": return "All inboxes";
    case "starred": return "Starred";
    case "follow": return "Following";
    case "camp": return "Campaigns";
    case "mailbox": return inboxName(scope.id, mailboxes);
    case "number": return scope.id;
  }
}

/** The names the "Showing" line lists: each narrowing filter, in the order the filter menu shows them. */
export function showingNames(s: InboxState, mailboxes: readonly Mailbox[]): string[] {
  const names: string[] = [];
  for (const c of CHANNELS) if (s.channels.includes(c)) names.push(CHANNEL_LABEL[c]);
  for (const id of s.inboxes) names.push(inboxName(id, mailboxes));
  if (s.needsMatch) names.push("Needs a match");
  const q = s.query.trim();
  if (q) names.push(`"${q}"`);
  return names;
}

/** "3 unread of 12" in the header of All inboxes; nothing when everything is read. */
export function unreadMeta(entries: readonly Entry[]): string {
  const unread = entries.reduce((n, e) => n + (e.unread > 0 ? 1 : 0), 0);
  return unread > 0 ? `${unread} unread of ${entries.length}` : "";
}

// ---------------------------------------------------------------- times

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY = 86_400_000;

/** The day number of an instant in the person's day. */
export function dayOf(at: number, offsetMin: number): number {
  return Math.floor((at + offsetMin * 60_000) / DAY);
}

/** Today: the clock time. Yesterday: the word. This week: the weekday. Older: month and day. */
export function listTime(at: number, now: number, offsetMin: number): string {
  const age = dayOf(now, offsetMin) - dayOf(at, offsetMin);
  const local = new Date(at + offsetMin * 60_000);
  if (age <= 0) {
    const h = local.getUTCHours(), m = local.getUTCMinutes();
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  if (age === 1) return "Yesterday";
  if (age < 7) return WEEK[local.getUTCDay()] ?? "";
  return `${MONTH[local.getUTCMonth()] ?? ""} ${local.getUTCDate()}`;
}

// ---------------------------------------------------------------- the sidebar

export interface NavGroup { key: "mine" | "shared" | "agent"; label: string; items: NavInbox[] }
export interface NavInbox { id: string; label: string; scope: Scope; unread: number; lock: boolean; agent: boolean; channel: "email" | "sms" }

/** Mine, Shared and Agents: mailboxes by kind, numbers under Mine (a number is assigned to one person). Unread counts come from inbox.counts. */
export function navGroups(mailboxes: readonly Mailbox[], counts: Counts | null, numberInfo?: ReadonlyMap<string, { label: string; group: "mine" | "agent" }>): NavGroup[] {
  const unread = new Map<string, number>();
  const numbers: string[] = [];
  if (counts) for (const c of counts.byInbox) { unread.set(c.id, c.unread); if (c.kind === "number") numbers.push(c.id); }
  const groups: NavGroup[] = [{ key: "mine", label: "Mine", items: [] }, { key: "shared", label: "Shared", items: [] }, { key: "agent", label: "Agents", items: [] }];
  const put = (key: NavGroup["key"], item: NavInbox): void => { groups.find((g) => g.key === key)?.items.push(item); };
  for (const m of mailboxes) {
    const key = m.kind === "personal" ? "mine" : m.kind === "agent" ? "agent" : "shared";
    put(key, { id: m.id, label: m.title, scope: { kind: "mailbox", id: m.id }, unread: unread.get(m.id) ?? 0, lock: m.privacy === "private", agent: m.kind === "agent", channel: "email" });
  }
  for (const id of numbers) {
    const info = numberInfo?.get(id);
    put(info?.group ?? "mine", { id, label: info?.label ?? id, scope: { kind: "number", id }, unread: unread.get(id) ?? 0, lock: false, agent: info?.group === "agent", channel: "sms" });
  }
  return groups.filter((g) => g.items.length > 0);
}

export function calendarIds(calendars: readonly CalendarRow[]): string[] {
  return calendars.map((c) => c.id);
}

export function sameScope(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  return "id" in a && "id" in b ? a.id === b.id : true;
}

export function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// ---------------------------------------------------------------- actions on the state

export type Action =
  | { type: "view"; view: View }
  | { type: "scope"; scope: Scope }
  | { type: "channel"; channel: Channel }
  | { type: "inbox"; id: string }
  | { type: "needsMatch" }
  | { type: "query"; query: string }
  | { type: "showAll" }
  | { type: "select"; key: string | null }
  | { type: "section"; key: string }
  | { type: "calendar" }
  | { type: "calendarVisible"; id: string }
  | { type: "calendarOnly"; id: string; all: readonly string[] };

export function reduce(s: InboxState, a: Action): InboxState {
  switch (a.type) {
    case "view": return { ...s, main: "list", view: a.view, selected: null };
    case "scope": return { ...s, main: "list", scope: a.scope, selected: null };
    case "channel": return { ...s, channels: toggled(s.channels, a.channel), selected: null };
    case "inbox": return { ...s, inboxes: toggled(s.inboxes, a.id), selected: null };
    case "needsMatch": return { ...s, needsMatch: !s.needsMatch, selected: null };
    case "query": return { ...s, query: a.query, selected: null };
    case "showAll": return { ...s, channels: [], inboxes: [], needsMatch: false, query: "", selected: null };
    case "select": return { ...s, selected: a.key };
    case "section": return { ...s, closed: toggled(s.closed, a.key) };
    case "calendar": return { ...s, main: "calendar", selected: null };
    case "calendarVisible": return { ...s, hiddenCalendars: toggled(s.hiddenCalendars, a.id) };
    case "calendarOnly": return { ...s, hiddenCalendars: a.all.filter((id) => id !== a.id) };
  }
}
