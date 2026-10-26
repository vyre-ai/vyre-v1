// The sample Spaces behind the Inbox tests and the screenshots: Northwind (the default) and Harbor Studio, filled from the prototype's Inbox so a side by side reads the same.
// A fake replica holds the rows; every capability the sidebar and the list read is registered with a resolver over those rows that honours the inputs (inbox, number, channel,
// needs a match, search), and the two writes the list makes (mark read, follow) change the rows. The real replica is SQLite behind the same surface.
import { createFakeReplica, createScreenHooks } from "../../../../../../client/src/index.ts";
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { screensById } from "../../../../../../generated/screens.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Connection, InboxData, InboxNav, NumberInfo, RowExtras } from "../sidebar/data.tsx";
import type { CalendarRow, CallRow, ContactRow, Mailbox, ThreadRow } from "../sidebar/model.ts";

/** Friday 24 October 2025, 10:40 in the person's day (UTC for the samples, so every machine prints the same times). */
export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 40, 0);
const MIN = 60_000;
const ago = (minutes: number): number => SAMPLE_NOW - minutes * MIN;

export type Variant = "northwind" | "harbor";
export interface SampleSpace { id: Variant; name: string; extras?: Record<string, RowExtras>; numberInfo?: Record<string, NumberInfo>; mailboxes: Mailbox[]; numbers: string[]; contacts: ContactRow[]; threads: ThreadRow[]; calls: CallRow[]; calendars: CalendarRow[] }

const box = (id: string, kind: Mailbox["kind"], title: string, address: string, privacy: Mailbox["privacy"], extra: Partial<Mailbox> = {}): Mailbox =>
  ({ id, kind, address, title, provider: "google", privacy, state: "syncing", ...extra });

/** `ghost`: a sender who matches no record yet, so the row has no contact. */
const contact = (id: string, name: string, minutes: number, channel: ContactRow["lastChannel"], preview: string, o: Partial<ContactRow> & { mailboxIds: string[]; ghost?: boolean }): ContactRow => {
  const { ghost, ...rest } = o;
  return {
    id, ...(ghost ? {} : { contactId: `ct_${id}` }), address: `${id}@example.test`, displayName: name, lastMessageAt: ago(minutes), lastChannel: channel, lastPreview: preview, unreadCount: 0,
    needsMatch: false, followed: false, alertOnReplies: false, ...rest,
  };
};

const NW_NUM = "+1 415 555 0132";
const NW_BILL = "+1 415 555 0177";

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind",
  mailboxes: [
    box("mbx_work", "personal", "Work Gmail", "irfad@northwind.example", "space"),
    box("mbx_pers", "personal", "Personal", "irfad.imtiaz@mail.example", "private"),
    box("mbx_hello", "shared", "hello@", "hello@northwind.example", "space"),
    box("mbx_support", "shared", "support@", "support@northwind.example", "space"),
    box("mbx_portal", "shared", "Client portal", "/hooks/portal", "space"),
    box("mbx_intake", "agent", "intake@", "intake@northwind.example", "space", { agentId: "agt_intake" }),
  ],
  numbers: [NW_NUM, NW_BILL],
  numberInfo: { [NW_BILL]: { label: "Billing's number", group: "agent" } },
  // organisations, do-not-disturb, a bounced email and the agents' drafts, as the prototype's Inbox shows them
  extras: {
    elena: { org: "Rivera Holdings" },
    marcus: { org: "Pruitt & Co.", draftReady: true },
    dana: { org: "Whitfield Group" },
    priya: { org: "Nair Studio", draftReady: true },
    tomas: { org: "Berg Logistics" },
    wei: { org: "Zhang Imports" },
    ben: { org: "Unsure match", orgUnsure: true, bounced: "ben@okafor.example" },
    grace: { org: "Mbeki Design" },
    jonas: { org: "Keller Bakery", dnd: "asked not to be emailed" },
    hannah: { org: "Cole Dental" },
    sofia: { org: "Alvarez Legal" },
  },
  contacts: [
    contact("elena", "Elena Rivera", 25, "email", "Lease documents for Thursday · Attached is draft 3 of the lease. Marcus at the property company asked for a reply by Friday", { mailboxIds: ["mbx_work"], unreadCount: 1, followed: true }),
    contact("marcus", "Marcus Pruitt", 18, "sms", "Can you resend invoice 1041? I can't find it.", { mailboxIds: [NW_BILL], unreadCount: 1, starred: true }),
    contact("dana", "Dana Whitfield", 95, "call", "Voicemail · 0:42 · Hi Irfad, it is Dana at Whitfield. Calling about the renewal quote.", { mailboxIds: [NW_NUM], unreadCount: 1 }),
    contact("priya", "Priya Nair", 70, "email", "Re: Spring check-in · Yes, we would like to book a review for next week. Tuesday morning works best.", { mailboxIds: ["mbx_intake"], unreadCount: 1, campaignId: "cmp_spring", starred: true }),
    contact("tomas", "Tomas Berg", 120, "email", "Re: Login link not working · Thanks, but I still see an error after I click it.", { mailboxIds: ["mbx_support"], unreadCount: 1 }),
    contact("wei", "Wei Zhang", 330, "email", "Partnership inquiry · We import specialty goods and are looking for a firm to support our contracts", { mailboxIds: ["mbx_hello"], unreadCount: 1 }),
    contact("ben", "Ben Okafor", 900, "email", "Question about onboarding · I filled out your form yesterday. What happens next?", { mailboxIds: ["mbx_hello"], unreadCount: 1, needsMatch: true }),
    contact("hannah", "Hannah Cole", 1470, "sms", "You: No problem. See you then.", { mailboxIds: [NW_NUM], followed: true }),
    contact("jonas", "Jonas Keller", 1300, "email", "Re: Spring check-in · Not right now, but check back with me in June.", { mailboxIds: ["mbx_intake"], campaignId: "cmp_spring" }),
    contact("sofia", "Sofia Alvarez", 2100, "email", "You: Re: Updated NDA · Received, thank you Sofia. It is filed.", { mailboxIds: ["mbx_work"] }),
    contact("nina", "Nina Petrova", 4980, "sms", "Got it, thanks!", { mailboxIds: [NW_NUM], followed: true }),
    contact("grace", "Grace Mbeki", 560, "email", "You: Re: Dinner on Friday? · Yes. Send the address and I will be there.", { mailboxIds: ["mbx_pers"] }),
    contact("unk", "+1 628 555 0194", 35, "sms", "Hi, is this the Northwind office? I got a missed call from this number.", { mailboxIds: [NW_NUM], unreadCount: 1, needsMatch: true, ghost: true }),
  ],
  threads: [
    { threadId: "thr_lease", channel: "email", subject: "Lease documents for Thursday", mailboxId: "mbx_work", lastAt: ago(25), participants: ["Elena Rivera"], unread: 1, contactId: "ct_elena" },
    { threadId: "thr_intake", channel: "email", subject: "Client intake form", mailboxId: "mbx_hello", lastAt: ago(4320), participants: ["Elena Rivera"], unread: 0, contactId: "ct_elena" },
    { threadId: "thr_1041", channel: "sms", mailboxId: NW_BILL, lastAt: ago(18), participants: ["Marcus Pruitt"], unread: 1, contactId: "ct_marcus" },
    { threadId: "thr_spring", channel: "email", subject: "Spring check-in", mailboxId: "mbx_intake", lastAt: ago(70), participants: ["Priya Nair"], unread: 1, contactId: "ct_priya" },
    { threadId: "thr_login", channel: "email", subject: "Login link not working", mailboxId: "mbx_support", lastAt: ago(120), participants: ["Tomas Berg"], unread: 1, contactId: "ct_tomas" },
    { threadId: "thr_partner", channel: "email", subject: "Partnership inquiry", mailboxId: "mbx_hello", lastAt: ago(330), participants: ["Wei Zhang"], unread: 1, contactId: "ct_wei" },
    { threadId: "thr_nda", channel: "email", subject: "Updated NDA", mailboxId: "mbx_work", lastAt: ago(2100), participants: ["Sofia Alvarez"], unread: 0, contactId: "ct_sofia" },
  ],
  calls: [
    { id: "cal_dana", numberId: NW_NUM, direction: "in", from: "+1 917 555 0126", to: NW_NUM, contactId: "ct_dana", state: "voicemail", startedAt: ago(95), durationSec: 42, hasTranscript: true, summary: "Asks about the renewal quote", consentLogged: false },
    { id: "cal_hannah", numberId: NW_NUM, direction: "in", from: "+1 408 555 0102", to: NW_NUM, contactId: "ct_hannah", state: "missed", startedAt: ago(1480), hasTranscript: false, consentLogged: false },
    { id: "cal_elena", numberId: NW_NUM, direction: "in", from: "+1 415 555 0161", to: NW_NUM, contactId: "ct_elena", state: "completed", startedAt: ago(2900), durationSec: 252, hasTranscript: true, summary: "Elena sends the lease Thursday", consentLogged: true },
    { id: "cal_out", numberId: NW_NUM, direction: "out", from: NW_NUM, to: "+1 646 555 0119", contactId: "ct_priya", state: "completed", startedAt: ago(7300), durationSec: 95, hasTranscript: false, consentLogged: false },
  ],
  calendars: [
    { id: "cal_work", title: "Work Google", color: "#5B5BD6", provider: "google", ownerId: "usr_irfad", personal: false, state: "syncing" },
    { id: "cal_ms", title: "Microsoft", color: "#1F9DB4", provider: "microsoft", ownerId: "usr_irfad", personal: false, state: "syncing" },
    { id: "cal_pers", title: "Personal", color: "#C07A22", provider: "google", ownerId: "usr_irfad", personal: true, state: "syncing" },
  ],
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio",
  mailboxes: [box("mbx_h_mine", "personal", "Studio Gmail", "irfad@harborstudio.example", "space"), box("mbx_h_hello", "shared", "hello@", "hello@harborstudio.example", "space")],
  numbers: [],
  contacts: [
    contact("kai", "Kai Moreno", 40, "email", "Logo round two · These are close. Can we see the mark on the ceramics tag?", { mailboxIds: ["mbx_h_mine"], unreadCount: 1 }),
    contact("abel", "Abel Daughters", 300, "email", "Homepage copy · Four lines are marked. The rest reads well.", { mailboxIds: ["mbx_h_hello"], followed: true }),
    contact("june", "June Okafor", 1500, "email", "You: Studio day signage · Proofs attached for Thursday.", { mailboxIds: ["mbx_h_mine"] }),
  ],
  threads: [{ threadId: "thr_h_logo", channel: "email", subject: "Logo round two", mailboxId: "mbx_h_mine", lastAt: ago(40), participants: ["Kai Moreno"], unread: 1, contactId: "ct_kai" }],
  calls: [],
  calendars: [{ id: "cal_h", title: "Studio", color: "#2E9A78", provider: "google", ownerId: "usr_irfad", personal: false, state: "syncing" }],
};

export interface SampleInbox {
  data: InboxData;
  replica: FakeReplica;
  /** every capability the list called, in order */
  calls: { cap: string; input: unknown }[];
  /** what the nav handlers were asked to open */
  opened: string[];
  setOnline(online: boolean): void;
}

const row = <T extends { id: string }>(r: T): T & Row => r as T & Row;

const FIRST = ["Maya", "Omar", "Lena", "Sam", "Ines", "Theo", "June", "Kai", "Abel", "Nora", "Ravi", "Tess"] as const;
const LAST = ["Chen", "Haddad", "Ortiz", "Patel", "Costa", "Lindqvist", "Okafor", "Moreno", "Daughters", "Quinn", "Rao", "Vale"] as const;
const CHANNELS_CYCLE = ["email", "sms", "call"] as const;

/** `count` more conversations, newest first, spread over the Space's inboxes: the long list the scroll probe runs over. */
export function bulkContacts(space: SampleSpace, count: number): ContactRow[] {
  const inboxes = [...space.mailboxes.map((m) => m.id), ...space.numbers];
  const out: ContactRow[] = [];
  for (let i = 0; i < count; i++) {
    const ch = CHANNELS_CYCLE[i % 3]!;
    out.push(contact(`bulk${i}`, `${FIRST[i % FIRST.length]!} ${LAST[(i * 7) % LAST.length]!}`, 200 + i, ch, ch === "email" ? `Subject ${i} \u00b7 A short line of the message` : ch === "sms" ? `Text number ${i}` : `Incoming call \u00b7 0:${String(i % 60).padStart(2, "0")}`,
      { mailboxIds: [inboxes[i % inboxes.length]!], unreadCount: i % 17 === 0 ? 1 : 0 }));
  }
  return out;
}

export function createSampleInbox(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): SampleInbox {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  let online = o.online ?? true;
  const listeners = new Set<() => void>();

  replica.put("contacts", [...space.contacts, ...bulkContacts(space, o.bulk ?? 0)].map((c) => row(c)));
  replica.put("threads", space.threads.map((t) => row({ id: t.threadId, ...t })));
  replica.put("calls", space.calls.map((c) => row(c)));
  replica.put("mailboxes", space.mailboxes.map((m) => row(m)));
  replica.put("calendars", space.calendars.map((c) => row(c)));

  const contacts = (): ContactRow[] => replica.rows("contacts") as unknown as ContactRow[];
  const matches = (c: ContactRow, i: CapMap["inbox.list_by_contact"]["in"]): boolean => {
    if (i.mailboxId && !c.mailboxIds.includes(i.mailboxId)) return false;
    if (i.numberId && !c.mailboxIds.includes(i.numberId)) return false;
    if (i.channel && c.lastChannel !== i.channel) return false;
    if (i.needsMatch && !c.needsMatch) return false;
    const q = i.query?.trim().toLowerCase();
    return !q || `${c.displayName} ${c.lastPreview} ${c.address}`.toLowerCase().includes(q);
  };

  replica.resolve("inbox.list_by_contact", (_t, i) => {
    const rows = contacts().filter((c) => matches(c, i)).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return { rows, showing: `${rows.length} conversations`, total: rows.length };
  });
  replica.resolve("inbox.list_by_thread", (_t, i) => {
    const q = i.query?.trim().toLowerCase();
    const threads = (replica.rows("threads") as unknown as ThreadRow[])
      .filter((t) => (!i.mailboxId || t.mailboxId === i.mailboxId) && (!i.numberId || t.mailboxId === i.numberId) && (!i.channel || t.channel === i.channel) && (!q || `${t.subject ?? ""} ${t.participants.join(" ")}`.toLowerCase().includes(q)))
      .sort((a, b) => b.lastAt - a.lastAt);
    return { threads, showing: `${threads.length} threads`, total: threads.length };
  });
  replica.resolve("telephony.call.list", (_t, i) => {
    const list = (replica.rows("calls") as unknown as CallRow[]).filter((c) => !i.numberId || c.numberId === i.numberId).sort((a, b) => b.startedAt - a.startedAt);
    return { calls: list, total: list.length };
  });
  replica.resolve("inbox.counts", () => {
    const unread = (id: string): number => contacts().reduce((n, c) => n + (c.mailboxIds.includes(id) && c.unreadCount > 0 ? 1 : 0), 0);
    const byInbox: CapMap["inbox.counts"]["out"]["byInbox"] = [
      ...space.mailboxes.map((m) => ({ kind: "mailbox" as const, id: m.id, unread: unread(m.id) })),
      ...space.numbers.map((n) => ({ kind: "number" as const, id: n, unread: unread(n) })),
    ];
    return { byInbox, total: contacts().reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0), needsMatch: contacts().filter((c) => c.needsMatch).length };
  });
  replica.resolve("mail.mailbox.list", () => ({ mailboxes: replica.rows("mailboxes") as unknown as Mailbox[], total: space.mailboxes.length }));
  replica.resolve("calendar.list_calendars", () => ({ calendars: replica.rows("calendars") as unknown as CalendarRow[] }));

  const writes: Record<string, (i: never) => unknown> = {
    "inbox.mark_read": (i: { conversationId: string; read: boolean }) => {
      const c = contacts().find((x) => x.id === i.conversationId);
      if (!c) throw new Error(`no such conversation ${i.conversationId}`);
      replica.put("contacts", [row({ ...c, unreadCount: i.read ? 0 : Math.max(1, c.unreadCount) })]);
      return { ok: true };
    },
    "stars.toggle": (i: { resource: { type: string; id: string }; on: boolean }) => {
      const c = contacts().find((x) => x.contactId === i.resource.id);
      if (c) replica.put("contacts", [row({ ...c, starred: i.on })]);
      return { starred: i.on, following: false };
    },
    "inbox.follow_set": (i: { contactId: string; follow: boolean }) => {
      const c = contacts().find((x) => x.contactId === i.contactId);
      if (c) replica.put("contacts", [row({ ...c, followed: i.follow })]);
      return { ok: true };
    },
  };

  const nav: InboxNav = {
    openConversation: (id) => void opened.push(`conversation:${id}`),
    openThread: (id) => void opened.push(`thread:${id}`),
    openCall: (id) => void opened.push(`call:${id}`),
    openCalendar: () => void opened.push("calendar"),
    openDialer: () => void opened.push("dialer"),
    openMatch: (id) => void opened.push(`match:${id}`),
    compose: () => void opened.push("compose"),
    connect: (kind) => void opened.push(`connect:${kind}`),
    openInboxSettings: (id) => void opened.push(`settings:${id}`),
  };
  const connection: Connection = { get: () => (online ? "online" : "offline"), subscribe: (l) => { listeners.add(l); return () => void listeners.delete(l); } };

  const data: InboxData = {
    screens: createScreenHooks(replica, screensById),
    async call(cap, input) {
      calls.push({ cap, input });
      const w = writes[cap];
      if (!w) throw new Error(`unknown capability ${cap}`);
      return w(input as never);
    },
    connection, nav,
    extras: (key) => space.extras?.[key],
    numbers: () => new Map(Object.entries(space.numberInfo ?? {})),
    clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
  };
  return { data, replica, calls, opened, setOnline(v) { online = v; for (const l of [...listeners]) l(); } };
}
