// The sample conversations behind the contact tab tests and screenshots, on top of the Inbox sample (../contactlist/sample.ts). Elena Rivera is the full thread: emails with folded quotes and
// attachments, text bubbles, a call with a recording and transcript, a campaign step, record chips and an agent's draft with its Gate line. The resolvers honour the inputs the screen
// passes and the writes change the rows, so a send shows up in the thread the way the real replica would show it.
import type { Row } from "../../../../../../client/src/index.ts";
import type { InboxData } from "../sidebar/data.tsx";
import { SAMPLE_NOW, createSampleInbox, northwind } from "../contactlist/sample.ts";
import type { SampleInbox, SampleSpace } from "../contactlist/sample.ts";
import type { ContactRow } from "../sidebar/model.ts";
import type { Conversation, DraftRow, SendOptions, ThreadItem, ThreadOut } from "./model.ts";

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
    { kind: "campaign_step", id: "s_welcome", at: ago(4200), title: "Welcome series, step 1 sent", campaignId: "cmp_welcome" },
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
    { kind: "campaign_step", id: "ps1", at: ago(4400), title: "Spring check-in, email 1 sent", campaignId: "cmp_spring" },
    { kind: "email", id: "pm1", at: ago(70), direction: "in", title: "Re: Spring check-in", preview: "Yes, we would like to book a review for next week.", ref: {
      subject: "Re: Spring check-in", body: "Yes, we would like to book a review for next week. Tuesday morning works best.", via: "intake@", campaign: "Spring check-in", quoted: "On Mon, Oct 20 Intake wrote:\n> Do you want to book a review this spring?" } },
  ],
  clara: [
    { kind: "email", id: "cv1", at: ago(55), direction: "in", title: "Studio session for the autumn range", preview: "Hi, we need a two day shoot for the autumn range.", ref: { subject: "Studio session for the autumn range", body: "Hi, we need a two day shoot for the autumn range. Do you have a slot in the first week of November?\n\nClara", via: "Studio Gmail" } },
  ],
  kai: [
    { kind: "email", id: "km1", at: ago(40), direction: "in", title: "Logo round two", preview: "These are close.", ref: { subject: "Logo round two", body: "These are close. Can we see the mark on the ceramics tag?", via: "Studio Gmail" } },
  ],
};

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

  const stored = space.id === "northwind" ? Object.entries(threads).filter(([k]) => k !== "kai" && k !== "clara") : [["kai", threads["kai"]!] as const, ["clara", threads["clara"]!] as const];
  const itemRows: Item[] = [];
  for (const [conv, list] of stored) for (const i of list) itemRows.push(item(conv, i));
  replica.put("thread_items", itemRows as unknown as Row[]);
  replica.put("drafts", (space.id === "northwind" ? draftSeeds : []).map((d) => draftRow(d)) as unknown as Row[]);

  const contacts = (): ContactRow[] => replica.rows("contacts") as unknown as ContactRow[];
  // Harbor Studio's other client, Clara Voss, whose one email the prototype's Harbor Inbox opens
  const kaiRow = space.id === "harbor" ? contacts().find((c) => c.id === "kai") : undefined;
  if (kaiRow) replica.put("contacts", [...contacts(), { ...kaiRow, id: "clara", contactId: "ct_clara", address: "clara@vossceramics.example", displayName: "Clara Voss", lastPreview: "Studio session for the autumn range" }] as unknown as Row[]);
  const find = (conversationId?: string, contactId?: string): ContactRow | undefined => contacts().find((c) => c.id === conversationId || (contactId !== undefined && c.contactId === contactId));

  replica.resolve("inbox.thread", (_t, i) => {
    const c = find(i.conversationId, i.contactId);
    if (!c) throw new Error("no such conversation");
    const items = (replica.rows("thread_items") as unknown as Item[]).filter((x) => x.conversationId === c.id).map(({ conversationId: _c, ...rest }) => rest as ThreadItem);
    const conversation: Conversation = {
      id: c.id, ...(c.contactId ? { contactId: c.contactId } : {}), address: PHONES[c.id] && !c.contactId ? (PHONES[c.id] as string) : c.address, displayName: c.displayName, lastMessageAt: c.lastMessageAt,
      lastChannel: c.lastChannel, lastPreview: c.lastPreview, unreadCount: c.unreadCount, needsMatch: c.needsMatch, mailboxIds: c.mailboxIds, followed: c.followed, alertOnReplies: c.alertOnReplies,
      ...(c.campaignId ? { campaignId: c.campaignId } : {}),
    };
    return { conversation, items, total: items.length } satisfies ThreadOut;
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
