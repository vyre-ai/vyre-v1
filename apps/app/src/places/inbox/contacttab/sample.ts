// The sample conversations behind the contact tab tests and screenshots, on top of the Inbox sample (../contactlist/sample.ts). Elena Rivera is the full thread: emails with folded quotes and
// attachments, text bubbles, a call with a recording and transcript, record chips and an agent's draft with its Gate line. The resolvers honour the inputs the screen
// passes and the writes change the rows, so a send shows up in the thread the way the real replica would show it.
import type { Row } from "../../../../../../client/src/index.ts";
import type { InboxData } from "../sidebar/data.tsx";
import { SAMPLE_NOW, createSampleInbox, northwind } from "../contactlist/sample.ts";
import type { SampleInbox, SampleSpace } from "../contactlist/sample.ts";
import type { ContactRow } from "../sidebar/model.ts";
import type { Conversation, DraftRow, MailThread, SendOptions, ThreadItem, ThreadMsg, ThreadOut, ThreadsOut } from "./model.ts";

const MIN = 60_000;
const ago = (minutes: number): number => SAMPLE_NOW - minutes * MIN;

const NW_NUM = "+1 415 555 0132";
const NW_BILL = "+1 415 555 0177";
/** A one second silent WAV, so the player has something real to play on the web. */
export const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

type Item = ThreadItem & { conversationId: string };
const item = (conversationId: string, i: ThreadItem): Item => ({ ...i, conversationId });

const ELENA_QUOTE = "On Mon, Oct 20 at 4:02 PM Marcus Pruitt wrote:\n> Elena, please send the lease draft when you have it.\n> We will need Thursday to review the terms with the owners.";

export const threads: Record<string, ThreadItem[]> = {
  elena: [
    { kind: "record_chip", id: "hdr_elena", at: ago(100000), title: "Rivera matter", recordId: "rec_rivera", ref: { header: true, company: "Rivera Holdings" } },
    { kind: "email", id: "m_intake", at: ago(4320), direction: "in", title: "Client intake form", preview: "Hi Irfad, I filled out your intake form this morning.", ref: {
      subject: "Client intake form", body: "Hi Irfad,\n\nI filled out your intake form this morning. Let me know if you need anything else from me before Thursday.\n\nElena", via: "hello@",
      attachments: [{ name: "Intake-Elena-Rivera.pdf", size: "182 KB" }], chips: [{ title: "Elena Rivera", recordId: "rec_elena" }, { title: "Lease renewal", recordId: "rec_lease" }] } },
    { kind: "email", id: "m_reply", at: ago(4100), direction: "out", title: "Re: Client intake form", preview: "Thanks Elena, got it.", ref: {
      subject: "Re: Client intake form", body: "Thanks Elena, got it. I will go through it tonight and send the lease draft tomorrow.\n\nIrfad", via: "Work Gmail", status: "delivered",
      quoted: "On Fri, Oct 20 at 9:12 AM Elena Rivera wrote:\n> Hi Irfad,\n> I filled out your intake form this morning." } },
    { kind: "call", id: "c_elena", at: ago(2900), direction: "in", title: "Incoming call", preview: "Elena sends the lease Thursday", ref: {
      state: "completed", durationSec: 252, summary: "Elena sends the lease Thursday and wants a short call on Friday morning.", via: NW_NUM, address: "+1 415 555 0161", recording: true, recordingUrl: SILENT_WAV,
      transcript: [{ who: "Elena", text: "Hi, it is Elena. I will send the lease on Thursday." }, { who: "Irfad", text: "Perfect. Can we talk for ten minutes on Friday morning?" }, { who: "Elena", text: "Yes, nine thirty works." }] } },
    { kind: "sms", id: "t1", at: ago(1500), direction: "in", preview: "Running ten minutes late tomorrow.", ref: { body: "Running ten minutes late tomorrow.", via: NW_NUM, address: "+1 415 555 0161" } },
    { kind: "sms", id: "t2", at: ago(1490), direction: "in", preview: "I will bring the signed pages.", ref: { body: "I will bring the signed pages.", via: NW_NUM, address: "+1 415 555 0161" } },
    { kind: "sms", id: "t3", at: ago(1450), direction: "out", preview: "No problem. See you then.", ref: { body: "No problem. See you then.", via: NW_NUM, address: "+1 415 555 0161", status: "delivered" } },
    { kind: "email", id: "m_lease", at: ago(25), direction: "in", title: "Lease documents for Thursday", preview: "Attached is draft 3 of the lease.", ref: {
      subject: "Lease documents for Thursday", body: "Hi Irfad,\n\nAttached is draft 3 of the lease. Marcus at the property company asked for a reply by Friday, so a quick read tonight would help.\n\nThank you,\nElena",
      quoted: ELENA_QUOTE, via: "Work Gmail", attachments: [{ name: "Lease-draft-3.pdf", size: "412 KB" }, { name: "Floor-plan.png", size: "96 KB" }], chips: [{ title: "Lease renewal", recordId: "rec_lease" }] } },
  ],
  marcus: [
    { kind: "record_chip", id: "hdr_marcus", at: ago(100000), title: "Pruitt & Co.", recordId: "rec_pruitt", ref: { header: true, company: "Pruitt & Co." } },
    { kind: "meeting", id: "mc1", at: ago(1560), title: "Check-in: Pruitt & Co.", preview: "Marcus confirms invoice 1038 landed.", ref: {
      meetingTitle: "Check-in: Pruitt & Co.", durationSec: 1476, via: "Work Google meeting", recording: true, recordingUrl: SILENT_WAV,
      summary: "Marcus confirms invoice 1038 landed. He asks for 1041 again and agrees to net 15 on the next one.",
      transcript: [{ who: "Marcus", text: "Invoice 1038 landed on Monday, thank you." }, { who: "Irfad", text: "Good. I will send 1041 today." }, { who: "Marcus", text: "Net 15 on the next one works for us." }] } },
    { kind: "sms", id: "mt1", at: ago(200), direction: "out", preview: "Invoice 1041 is on its way.", ref: { body: "Invoice 1041 is on its way.", via: NW_BILL, address: "+1 415 555 0188", status: "delivered" } },
    { kind: "sms", id: "mt2", at: ago(18), direction: "in", preview: "Can you resend invoice 1041? I can't find it.", ref: { body: "Can you resend invoice 1041? I can't find it.", via: NW_BILL, address: "+1 415 555 0188" } },
  ],
  priya: [
    { kind: "email", id: "pm1", at: ago(70), direction: "in", title: "Re: Spring check-in", preview: "Yes, we would like to book a review for next week.", ref: {
      subject: "Re: Spring check-in", body: "Yes, we would like to book a review for next week. Tuesday morning works best.", via: "intake@", quoted: "On Mon, Oct 20 Intake wrote:\n> Do you want to book a review this spring?" } },
  ],
  clara: [
    { kind: "email", id: "cv1", at: ago(55), direction: "in", title: "Studio session for the autumn range", preview: "Hi, we need a two day shoot for the autumn range.", ref: { subject: "Studio session for the autumn range", body: "Hi, we need a two day shoot for the autumn range. Do you have a slot in the first week of November?\n\nClara", via: "Studio Gmail" } },
  ],
  kai: [
    { kind: "email", id: "km1", at: ago(40), direction: "in", title: "Logo round two", preview: "These are close.", ref: { subject: "Logo round two", body: "These are close. Can we see the mark on the ceramics tag?", via: "Studio Gmail" } },
  ],
};

// ---------------------------------------------------------------- email threads (owner, 3 Nov; a live case, anonymised)
// Josh Cohen is on two threads. "Claude in Chrome for Clio Grow + follow-up": Maya added you later, you answered, Josh replied (you reacted with a heart) and has written twice
// since you last looked. "Welcome to Scout, Josh": Andrey started it with you on Cc and Josh replied. The Scout thread is one object, so it shows whole under Andrey too.

const ME = "irfad@northwind.example", JOSH = "josh@cohenshah.example", ANDREY = "andrey@scout.example", MAYA = "maya@northwind.example";
const P = { me: { address: ME, name: "Irfad Imtiaz" }, josh: { address: JOSH, name: "Josh Cohen" }, andrey: { address: ANDREY, name: "Andrey Volkov" }, maya: { address: MAYA, name: "Maya Chen" } };
const JOSH_SIG = "Josh Cohen\nManaging Partner | Cohen & Shah Law\n(404) 555-0187 | cohenshah.example\n\nCONFIDENTIALITY NOTICE: This email and any attachments may contain privileged and confidential information intended only for the named recipient. If you received it in error, please tell the sender and delete it.";
const msg = (id: string, minutes: number, from: { address: string; name: string }, to: { address: string; name?: string }[], cc: { address: string; name?: string }[], subject: string, body: string, o: Partial<ThreadMsg> = {}): ThreadMsg => ({
  id, at: ago(minutes), direction: from.address === ME ? "out" : "in", mailboxId: "mbx_work", mailboxIds: ["mbx_work"], from, to, cc, subject, body, reactions: [], attachments: [], isPrivate: false, ...o,
});
const CHROME = "Claude in Chrome for Clio Grow + follow-up", SCOUT = "Welcome to Scout, Josh";
const SCOUT_HTML = '<p>Hi Josh,</p><p>Welcome to Scout. Your workspace for <b>Cohen &amp; Shah Law</b> is ready, and your team can sign in now.</p><p><a href="https://app.scout.example/w/cohen-shah" target="_blank" rel="noopener noreferrer nofollow">Open your workspace</a> <span class="vy-link-host">(app.scout.example)</span></p><p>Irfad is copied here. He will connect Scout to Clio Grow when you meet.</p><p>Andrey</p>';
const scoutThread = (unread: boolean): MailThread => ({
  threadId: "gm_18c39f7b2d10", subject: SCOUT, role: "cc", participants: [P.andrey, P.josh, P.me], lastAt: ago(1410), messageCount: 2, unread: 0,
  messages: [
    { unread: false, message: msg("eml_w1", 1530, P.andrey, [P.josh], [P.me], SCOUT, "Hi Josh,\n\nWelcome to Scout. Your workspace for Cohen & Shah Law is ready, and your team can sign in now.\n\nOpen your workspace (app.scout.example)\n\nIrfad is copied here. He will connect Scout to Clio Grow when you meet.\n\nAndrey", { html: SCOUT_HTML, imagesHeld: 1, signature: "Andrey Volkov\nCEO, Scout\nscout.example" }) },
    { unread, message: msg("eml_w2", 1410, P.josh, [P.andrey], [P.me], `RE: ${SCOUT}`, "Thanks Andrey. I am in and the team is set up.\n\nIrfad, can you connect it to Clio Grow when we meet Wednesday?", {
      signature: JOSH_SIG, quoted: "-----Original Message-----\nFrom: Andrey Volkov <andrey@scout.example>\nSent: Friday, October 23, 2026 9:10 AM\nTo: Josh Cohen <josh@cohenshah.example>\nCc: Irfad Imtiaz <irfad@northwind.example>\nSubject: Welcome to Scout, Josh\n\nHi Josh,\nWelcome to Scout. Your workspace for Cohen & Shah Law is ready." }) },
  ],
});
export const mailThreads: Record<string, MailThread[]> = {
  josh: [
    {
      threadId: "gm_18c2a1f04e9b", subject: CHROME, role: "added_later", participants: [P.maya, P.josh, P.me], lastAt: ago(61), messageCount: 5, unread: 2,
      messages: [
        { unread: false, message: msg("eml_c1", 2950, P.maya, [P.josh], [P.me], `Re: ${CHROME}`, "Hi Josh,\n\nAdding Irfad, who set up Claude in Chrome for our own Clio Grow intake. Irfad, Josh wants the same setup for his intake team, and a follow-up after each consult.", {
          signature: "Maya Chen\nClient Success | Northwind\n+1 415 555 0140", quoted: "On Tue, Oct 20, 2026 at 4:12 PM Josh Cohen <josh@cohenshah.example> wrote:\n> Hi Maya,\n>\n> Could someone walk us through the Claude in Chrome setup for Clio Grow? Our intake team re-types every web lead by hand.\n>\n> Josh" }) },
        { unread: false, message: msg("eml_c2", 2830, P.me, [P.josh], [P.maya], `Re: ${CHROME}`, "Hi Josh,\n\nHappy to. The short version: Claude in Chrome reads each new lead in Clio Grow, fills the matter fields and leaves a note for your team to check before anything is saved. I can set it up with your intake lead on a 30-minute call. Tuesday or Wednesday afternoon both work.\n\nIrfad", {
          quoted: "On Thu, Oct 22, 2026 at 11:30 AM Maya Chen <maya@northwind.example> wrote:\n> Adding Irfad, who set up Claude in Chrome for our own Clio Grow intake." }) },
        { unread: false, message: msg("eml_c3", 2700, P.josh, [P.me], [P.maya], `RE: ${CHROME}`, "Thanks, I will put in the card for the Clio seat today. Wednesday at 2 works for us. Rachel Ortiz runs intake and will join.", {
          signature: JOSH_SIG, reactions: [{ emoji: "\u2764\ufe0f", from: P.me, at: ago(2660) }], quoted: "From: Irfad Imtiaz <irfad@northwind.example>\nSent: Thursday, October 22, 2026 1:30 PM\nTo: Josh Cohen <josh@cohenshah.example>\nCc: Maya Chen <maya@northwind.example>\nSubject: Re: Claude in Chrome for Clio Grow + follow-up" }) },
        { unread: true, message: msg("eml_c4", 96, P.josh, [P.me], [P.maya], `RE: ${CHROME}`, "Hi Irfad,\n\nQuick one before Wednesday. Our lead form also feeds a Google Sheet that Rachel's team works from, so the intake team sees each lead twice. Could Claude in Chrome check the sheet first and skip anything already in Clio Grow? If that is easy, we would also like it to tag the practice area, so the right attorney gets the lead the same morning.\n\nThe second thing is the follow-up. Right now nobody writes after the consult, so the lead goes quiet and we lose about a third of them. A short email the next morning, then we will call on day three. Could the same setup draft that email for Rachel to send?", {
          signature: JOSH_SIG, quoted: "-----Original Message-----\nFrom: Josh Cohen <josh@cohenshah.example>\nSent: Thursday, October 22, 2026 3:40 PM\nTo: Irfad Imtiaz <irfad@northwind.example>\nSubject: RE: Claude in Chrome for Clio Grow + follow-up\n\nThanks, I will put in the card for the Clio seat today." }) },
        { unread: true, message: msg("eml_c5", 61, P.josh, [P.me], [P.maya], `RE: ${CHROME}`, "One more: Rachel is out Wednesday afternoon. Can we do 11:00 instead?\n\nJosh", {
          signature: "Sent from my iPhone", quoted: "> On Oct 24, 2026, at 9:04 AM, Josh Cohen <josh@cohenshah.example> wrote:\n>\n> Hi Irfad,\n> Quick one before Wednesday." }) },
      ],
    },
    scoutThread(false),
  ],
  andrey: [scoutThread(false)],
};
/** The email items behind those threads, so the flat history (inbox.thread) holds them too, under each contact on them. */
const threadItems = (id: string): ThreadItem[] => (mailThreads[id] ?? []).flatMap((t) => t.messages.map((x) => ({
  kind: "email" as const, id: x.message.id, at: x.message.at, direction: x.message.direction, title: x.message.subject, preview: x.message.body.slice(0, 80), ref: { threadId: t.threadId, subject: x.message.subject, body: x.message.body },
})));

const bytesOf = (size: string | undefined): number => {
  const m = /^([\d.]+)\s*(B|KB|MB)$/i.exec(size ?? "");
  return m ? Math.round(Number(m[1]) * ({ b: 1, kb: 1024, mb: 1024 * 1024 }[(m[2] ?? "b").toLowerCase() as "b" | "kb" | "mb"])) : 0;
};

/** A sample contact's threads: the two above, else its emails grouped by thread (the subject without Re:), each message as inbox.threads would give it. */
function threadsOf(conv: { id: string; address: string; displayName: string; mailboxIds: string[] }, items: readonly ThreadItem[]): MailThread[] {
  const given = mailThreads[conv.id];
  if (given) return given;
  const groups = new Map<string, ThreadItem[]>();
  for (const i of items) {
    if (i.kind !== "email") continue;
    const r = i.ref as { subject?: string; threadId?: string } | undefined;
    const key = r?.threadId ?? (r?.subject ?? i.title ?? "").replace(/^\s*((re|fwd?):\s*)+/i, "").trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const box = conv.mailboxIds[0] ?? "mbx_work";
  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const them = { address: conv.address, name: conv.displayName };
    const messages = sorted.map((i) => {
      const r = (i.ref ?? {}) as { subject?: string; body?: string; quoted?: string; attachments?: { name: string; size?: string }[] };
      const out = i.direction === "out";
      const m = msg(i.id, (SAMPLE_NOW - i.at) / MIN, out ? P.me : them, [out ? them : P.me], [], r.subject ?? i.title ?? "", r.body ?? i.preview ?? "", { mailboxId: box, mailboxIds: [box], ...(r.quoted ? { quoted: r.quoted } : {}), attachments: (r.attachments ?? []).map((a, n) => ({ attachmentId: `att_${i.id}_${n}`, name: a.name, mime: "application/octet-stream", size: bytesOf(a.size) })) });
      return { unread: false, message: m };
    });
    const first = messages[0]?.message;
    return {
      threadId: `thr_${key.replace(/[^a-z0-9]+/g, "_")}`, subject: (first?.subject ?? "").replace(/^\s*((re|fwd?):\s*)+/i, "") || "(no subject)", role: first?.direction === "out" ? "started" as const : "to" as const,
      participants: [them, P.me], lastAt: sorted[sorted.length - 1]?.at ?? 0, messageCount: messages.length, unread: 0, messages,
    };
  });
}

/** Phone numbers the sample can text. */
const PHONES: Record<string, string> = { elena: "+1 415 555 0161", marcus: "+1 415 555 0188", dana: "+1 917 555 0126", hannah: "+1 408 555 0102", nina: "+1 646 555 0150", unk: "+1 628 555 0194" };

export interface DraftSeed { id: string; contactId: string; agentId: string; mailboxId: string; subject: string; body: string; to: string }
export const draftSeeds: DraftSeed[] = [
  { id: "dr_marcus", contactId: "ct_marcus", agentId: "agt_billing", mailboxId: NW_BILL, subject: "", body: "Hi Marcus, resending invoice 1041 now. It is also in your portal under Billing. Anything else you need?", to: "+1 415 555 0188" },
  { id: "dr_elena", contactId: "ct_elena", agentId: "agt_intake", mailboxId: "mbx_work", subject: "Re: Lease documents for Thursday", body: "Hi Elena,\n\nThanks for draft 3. I will read it tonight and reply to Marcus by Friday morning.\n\nIrfad", to: "elena@example.test" },
];

export interface ContactTabSample extends SampleInbox {
  /** Every send, in order (the mail.send and telephony.send_sms inputs). */
  sent: { cap: string; input: unknown }[];
  /** What the next mail.send answers with ("held" to see an agent send wait for approval). */
  mailStatus: { next: "queued" | "sent" | "held" | "suppressed" };
}

const draftRow = (d: DraftSeed): DraftRow => ({
  id: d.id, mailboxId: d.mailboxId, inboxIds: [d.mailboxId], threadId: d.to.includes("@") ? "thr_lease" : "thr_1041", direction: "out", status: "draft", from: { address: "irfad@northwind.example" }, to: [{ address: d.to, contactId: d.contactId }], cc: [],
  subject: d.subject, snippet: d.body, sentAt: ago(10), contactId: d.contactId, isPrivate: false, draftedByAgent: d.agentId,
});

/** The Inbox sample plus the contact tab's three queries and its writes. `data.call` answers the contact tab's capabilities and passes the rest on. */
export function createContactTabSample(space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): ContactTabSample {
  const base = createSampleInbox(space, o);
  const { replica } = base;
  const sent: { cap: string; input: unknown }[] = [];
  const mailStatus: ContactTabSample["mailStatus"] = { next: "queued" };

  const stored = space.id === "northwind"
    ? [...Object.entries(threads).filter(([k]) => k !== "kai" && k !== "clara"), ["josh", threadItems("josh")] as const, ["andrey", threadItems("andrey")] as const]
    : [["kai", threads["kai"]!] as const, ["clara", threads["clara"]!] as const];
  const itemRows: Item[] = [];
  for (const [conv, list] of stored) for (const i of list) itemRows.push(item(conv, i));
  replica.put("thread_items", itemRows as unknown as Row[]);
  replica.put("drafts", (space.id === "northwind" ? draftSeeds : []).map((d) => draftRow(d)) as unknown as Row[]);

  const contacts = (): ContactRow[] => replica.rows("contacts") as unknown as ContactRow[];
  // Harbor Studio's other client, Clara Voss, whose one email the prototype's Harbor Inbox opens
  const kaiRow = space.id === "harbor" ? contacts().find((c) => c.id === "kai") : undefined;
  if (kaiRow) replica.put("contacts", [...contacts(), { ...kaiRow, id: "clara", contactId: "ct_clara", address: "clara@vossceramics.example", displayName: "Clara Voss", lastPreview: "Studio session for the autumn range" }] as unknown as Row[]);
  // Josh Cohen and Andrey Volkov, the people on the two threads (northwind only)
  const elenaRow = space.id === "northwind" ? contacts().find((c) => c.id === "elena") : undefined;
  if (elenaRow) {
    replica.put("contacts", [
      ...contacts(),
      { ...elenaRow, id: "josh", contactId: "ct_josh", address: JOSH, displayName: "Josh Cohen", lastMessageAt: ago(61), lastChannel: "email", lastPreview: "Claude in Chrome for Clio Grow + follow-up · One more: Rachel is out Wednesday afternoon.", unreadCount: 2, followed: true, mailboxIds: ["mbx_work"] },
      { ...elenaRow, id: "andrey", contactId: "ct_andrey", address: ANDREY, displayName: "Andrey Volkov", lastMessageAt: ago(1410), lastChannel: "email", lastPreview: "Welcome to Scout, Josh · Josh: Thanks Andrey. I am in and the team is set up.", unreadCount: 0, followed: false, mailboxIds: ["mbx_work"] },
    ] as unknown as Row[]);
  }
  const find = (conversationId?: string, contactId?: string): ContactRow | undefined => contacts().find((c) => c.id === conversationId || (contactId !== undefined && c.contactId === contactId));

  replica.resolve("inbox.thread", (_t, i) => {
    const c = find(i.conversationId, i.contactId);
    if (!c) throw new Error("no such conversation");
    const items = (replica.rows("thread_items") as unknown as Item[]).filter((x) => x.conversationId === c.id).map(({ conversationId: _c, ...rest }) => rest as ThreadItem);
    const conversation: Conversation = {
      id: c.id, ...(c.contactId ? { contactId: c.contactId } : {}), address: PHONES[c.id] && !c.contactId ? (PHONES[c.id] as string) : c.address, displayName: c.displayName, lastMessageAt: c.lastMessageAt,
      lastChannel: c.lastChannel, lastPreview: c.lastPreview, unreadCount: c.unreadCount, needsMatch: c.needsMatch, mailboxIds: c.mailboxIds, followed: c.followed, alertOnReplies: c.alertOnReplies,
    };
    return { conversation, items, total: items.length } satisfies ThreadOut;
  });
  replica.resolve("inbox.threads", (_t, i) => {
    const c = find(i.conversationId, i.contactId);
    if (!c) throw new Error("no such conversation");
    const items = (replica.rows("thread_items") as unknown as Item[]).filter((x) => x.conversationId === c.id);
    const conversation: Conversation = {
      id: c.id, ...(c.contactId ? { contactId: c.contactId } : {}), address: c.address, displayName: c.displayName, lastMessageAt: c.lastMessageAt,
      lastChannel: c.lastChannel, lastPreview: c.lastPreview, unreadCount: c.unreadCount, needsMatch: c.needsMatch, mailboxIds: c.mailboxIds, followed: c.followed, alertOnReplies: c.alertOnReplies,
    };
    // with "Show images" the held picture loads: the sample has none to fetch, so the count goes and the HTML stays
    const list = threadsOf(c, items).map((t) => (i.images === true ? { ...t, messages: t.messages.map((x) => { const { imagesHeld: _h, ...rest } = x.message; return { ...x, message: rest }; }) } : t));
    return { conversation, threads: [...list].sort((a, b) => b.lastAt - a.lastAt), total: list.length } satisfies ThreadsOut;
  });
  replica.resolve("inbox.send_options", (_t, i) => {
    const c = find(i.conversationId, i.contactId);
    const canText = c !== undefined && PHONES[c.id] !== undefined && space.numbers.length > 0;
    const canMail = c !== undefined && !(c.id === "unk");
    const inboxes: SendOptions["inboxes"] = [
      ...space.mailboxes.filter((m) => m.kind !== "agent").map((m, n) => ({ kind: "mailbox" as const, id: m.id, address: m.address, canSend: true, isDefault: n === 0 })),
      ...space.numbers.map((n, k) => ({ kind: "number" as const, id: n, address: n, canSend: true, isDefault: k === 0 })),
    ];
    return { channels: [...(canMail ? ["email" as const] : []), ...(canText ? ["sms" as const] : [])], inboxes };
  });
  replica.resolve("mail.drafts.list", (_t, i) => {
    const drafts = (replica.rows("drafts") as unknown as DraftRow[]).filter((d) => !i.contactId || d.contactId === i.contactId);
    return { drafts, total: drafts.length };
  });

  const addItem = (c: ContactRow, i: ThreadItem): void => {
    replica.put("thread_items", [item(c.id, i)] as unknown as Row[]);
    replica.put("contacts", [{ ...c, lastMessageAt: i.at, lastChannel: i.kind === "sms" ? "sms" : "email", lastPreview: i.preview ?? "" }] as unknown as Row[]);
  };

  const writes: Record<string, (i: never) => unknown> = {
    // every sender (comms.senders.list): the Space's mailboxes by their provider, then its numbers through Twilio; one default per channel
    "comms.senders.list": () => ({ senders: [
      ...space.mailboxes.filter((m) => m.kind !== "agent").map((m, n) => ({ id: m.id, channel: "email" as const, name: m.title, address: m.address, via: m.provider === "microsoft" ? "Outlook" : m.provider === "google" ? "Gmail" : String(m.provider), provider: m.provider === "google" ? "gmail" : String(m.provider), scope: m.privacy === "private" ? "personal" : "space", default: n === 0, usable: true })),
      ...space.numbers.map((n, k) => ({ id: n, channel: "text" as const, name: k === 0 ? "Main line" : n, address: n, via: "Twilio", provider: "twilio", scope: "space", default: k === 0, usable: true })),
    ] }),
    "mail.send": (i: { mailboxId: string; to: { address: string; contactId?: string }[]; subject: string; text?: string; draftId?: string; contactId?: string; idempotencyKey: string }) => {
      sent.push({ cap: "mail.send", input: i });
      const status = mailStatus.next;
      mailStatus.next = "queued";
      if (status === "held") return { status, taskId: "tsk_gate_1", suppressed: [] };
      const c = find(undefined, i.contactId);
      const via = space.mailboxes.find((m) => m.id === i.mailboxId)?.title ?? i.mailboxId;
      if (c && status !== "suppressed") addItem(c, { kind: "email", id: `out_${sent.length}`, at: SAMPLE_NOW, direction: "out", title: i.subject, preview: i.text ?? "", ref: { subject: i.subject, body: i.text ?? "", via, status: "queued" } });
      if (i.draftId && status !== "suppressed") replica.remove("drafts", [i.draftId]);
      return { messageId: `msg_${sent.length}`, status, suppressed: status === "suppressed" ? i.to.map((t) => t.address) : [] };
    },
    "telephony.send_sms": (i: { numberId: string; to: string; body: string; contactId?: string }) => {
      sent.push({ cap: "telephony.send_sms", input: i });
      const c = find(undefined, i.contactId);
      if (c) addItem(c, { kind: "sms", id: `sms_${sent.length}`, at: SAMPLE_NOW, direction: "out", preview: i.body, ref: { body: i.body, via: i.numberId, address: i.to, status: "queued" } });
      return { smsId: `sms_${sent.length}`, status: "queued" };
    },
    // a draft as stored: the whole body (a seed may hold more than its list preview), its own recipients, Cc and thread
    "mail.message.get": (i: { messageId: string }) => {
      const d = (replica.rows("drafts") as unknown as Array<DraftRow & { full?: string }>).find((r) => r.id === i.messageId);
      if (!d) throw new Error("There is no such message.");
      return { message: d, text: d.full ?? d.snippet, attachments: [], provider: { traceId: "0".repeat(32) } };
    },
    "mail.draft": (i: { draftId?: string; text?: string; subject?: string }) => {
      const d = (replica.rows("drafts") as unknown as Array<DraftRow & { full?: string }>).find((r) => r.id === i.draftId);
      if (d) replica.put("drafts", [{ ...d, ...(i.text !== undefined ? { snippet: i.text.slice(0, 120), full: i.text } : {}), ...(i.subject !== undefined ? { subject: i.subject } : {}), sentAt: SAMPLE_NOW }] as unknown as Row[]);
      base.calls.push({ cap: "mail.draft", input: i });
      return { draftId: i.draftId ?? "" };
    },
    "mail.drafts.discard": (i: { draftId: string }) => {
      replica.remove("drafts", [i.draftId]);
      return { ok: true };
    },
  };

  const data: InboxData = {
    ...base.data,
    async call(cap, input) {
      const w = writes[cap];
      if (!w) return base.data.call(cap, input);
      base.calls.push({ cap, input });
      return w(input as never);
    },
  };
  return { ...base, data, sent, mailStatus };
}
