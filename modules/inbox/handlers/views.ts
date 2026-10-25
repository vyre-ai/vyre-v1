// The Inbox views (spec 2.18 Views, Following, Recipients; 3.3): By contact, By thread, one contact's whole history, Unmatched, Needs a match, the sidebar counts, who
// reaches your Inbox and why, the sending options of a thread, and the shared recipient search. "Calls only" is telephony.call.list, not a second list here.
//
// What a person sees. A conversation reaches your Inbox when you own it, follow the contact, run the campaign it belongs to, or can see an inbox it arrived in (spec: "you
// receive a contact's messages in your Inbox when you own the record, are on its project, follow it, or are on a campaign it is in; also messages to teammates' inboxes
// about the contact when shared"), and the kernel lets you see the conversation (an unmatched one falls back to the access of its mailbox). Every list applies both.
// DECISION: "are on its project" is not derived here: project membership is held by records, and no frozen capability answers "which contacts belong to my projects". Such a
// contact reaches you through the other four reasons or through the record's own Conversation tab, which asks inbox.thread for one contact.
// DECISION: recipient search returns contacts, companies, inboxes and groups. Space members have no list capability in the frozen contract, so kind member returns nothing.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, codeOf, ensure, first, getConversation, jsonList, list, missing, num, obj, rowsOf, str, strOrNull, strings, text, toConversation } from "../projections.ts";
import type { Channel, ConversationRow, InboxCtx, Json, Row } from "../projections.ts";
import { candidatesFor } from "./match.ts";

type Reason = "owner" | "project" | "follow" | "campaign" | "shared_inbox";
const DEFAULT_LIMIT = 50;

// ---- paging

function windowOf(ctx: InboxCtx, input: { cursor?: string; limit?: number }): { limit: number; offset: number } {
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "The limit is 1 to 500.");
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "That cursor is not one this list gave.");
  return { limit, offset };
}

function pageOf<T>(all: T[], w: { limit: number; offset: number }): { rows: T[]; next?: string; total: number } {
  const rows = all.slice(w.offset, w.offset + w.limit);
  const end = w.offset + rows.length;
  return end < all.length ? { rows, next: String(end), total: all.length } : { rows, total: all.length };
}

// ---- who reaches the caller

interface Reach {
  follows: Set<string>;
  campaignOwner: Map<string, string | null>;
  access: Map<string, boolean>;
}

function reachOf(ctx: InboxCtx): Reach {
  const follows = new Set(rowsOf(ctx.db.all(`SELECT * FROM inbox_follow WHERE "principalId" = ? AND deleted_at IS NULL`, ctx.principal.id)).map((r) => str(r, "contactId")));
  return { follows, campaignOwner: new Map(), access: new Map() };
}

function canSee(ctx: InboxCtx, reach: Reach, type: string, id: string): boolean {
  const key = `${type}:${id}`;
  let ok = reach.access.get(key);
  if (ok === undefined) {
    ok = ctx.authorize({ perm: null, level: "view" }, { type, id }).effect === "allow";
    reach.access.set(key, ok);
  }
  return ok;
}

async function reasonsOf(ctx: InboxCtx, reach: Reach, row: Row): Promise<Reason[]> {
  const out: Reason[] = [];
  if (strOrNull(row, "ownerId") === ctx.principal.id) out.push("owner");
  const contactId = strOrNull(row, "contactId");
  if (contactId && reach.follows.has(contactId)) out.push("follow");
  const campaign = strOrNull(row, "campaignId");
  if (campaign) {
    if (!reach.campaignOwner.has(campaign)) {
      try {
        reach.campaignOwner.set(campaign, strOrNull(obj(await ctx.call("contacts.route_owner", { campaignId: campaign })) as Row, "ownerId"));
      } catch (e) {
        ctx.log.warn("inbox: could not read the campaign owner", { code: codeOf(e) });
        reach.campaignOwner.set(campaign, null);
      }
    }
    if (reach.campaignOwner.get(campaign) === ctx.principal.id) out.push("campaign");
  }
  if (jsonList(row.mailboxIds).some((id) => canSee(ctx, reach, "mailbox", id)) || jsonList(row.numberIds).some((id) => canSee(ctx, reach, "number", id))) out.push("shared_inbox");
  return out;
}

/** The conversations the caller may see in the Inbox, each with why, newest first. */
async function mine(ctx: InboxCtx, where: string, args: unknown[]): Promise<{ row: Row; reasons: Reason[] }[]> {
  const reach = reachOf(ctx);
  const all = rowsOf(ctx.db.all(`SELECT * FROM inbox_conversation WHERE ${where} ORDER BY "lastMessageAt" DESC, id ASC`, ...args));
  const out: { row: Row; reasons: Reason[] }[] = [];
  for (const row of all) {
    if (!canSee(ctx, reach, "conversation", str(row, "id"))) continue;
    const reasons = await reasonsOf(ctx, reach, row);
    if (reasons.length) out.push({ row, reasons });
  }
  return out;
}

// ---- filters

interface Filter {
  mailboxId?: string;
  numberId?: string;
  channel?: Channel;
  needsMatch?: boolean;
  query?: string;
}

function checkFilter(ctx: InboxCtx, f: Filter): void {
  if (f.channel !== undefined && !["email", "sms", "call"].includes(f.channel)) bad(ctx, "The channel is email, sms or call.");
  if (f.query !== undefined && typeof f.query !== "string") bad(ctx, "Search text must be text.");
  if (f.needsMatch !== undefined && typeof f.needsMatch !== "boolean") bad(ctx, "Needs a match is true or false.");
}

const has = (hay: string, needle: string): boolean => hay.toLowerCase().includes(needle.toLowerCase());

function showing(f: Filter, noun: string): string {
  const parts: string[] = [];
  if (f.needsMatch === true) parts.push("Needs a match");
  if (f.channel) parts.push({ email: "Emails", sms: "Texts", call: "Calls" }[f.channel]);
  if (f.mailboxId) parts.push("one inbox");
  if (f.numberId) parts.push("one number");
  if (f.query?.trim()) parts.push(`matching "${f.query.trim()}"`);
  return parts.length ? `Showing ${parts.join(", ")}` : `Showing all ${noun}`;
}

function conversationIdsWith(ctx: InboxCtx, filter: Filter): Set<string> | null {
  if (!filter.channel && !filter.mailboxId && !filter.numberId) return null;
  const items = filter.channel ? rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE kind = ?`, filter.channel)) : rowsOf(ctx.db.all(`SELECT * FROM inbox_item`));
  return new Set(
    items.filter((i) => (!filter.mailboxId || str(i, "mailboxId") === filter.mailboxId) && (!filter.numberId || str(i, "numberId") === filter.numberId)).map((i) => str(i, "conversationId")),
  );
}

// ---- inbox.list_by_contact

export async function listByContact(
  ctx: InboxCtx, input: Filter & { cursor?: string; limit?: number },
): Promise<{ rows: ConversationRow[]; showing: string; next?: string; total?: number }> {
  ensure(ctx);
  checkFilter(ctx, input);
  const w = windowOf(ctx, input);
  const ids = conversationIdsWith(ctx, input);
  const q = input.query?.trim() ?? "";
  const found = (await mine(ctx, input.needsMatch === undefined ? `deleted_at IS NULL` : `deleted_at IS NULL AND "needsMatch" = ?`, input.needsMatch === undefined ? [] : [input.needsMatch ? 1 : 0]))
    .filter(({ row }) => (!ids || ids.has(str(row, "id"))) && (!q || has(str(row, "displayName"), q) || has(str(row, "address"), q) || has(str(row, "lastPreview"), q)));
  const p = pageOf(found, w);
  return { rows: p.rows.map(({ row }) => toConversation(ctx, row)), showing: showing(input, "conversations"), total: p.total, ...(p.next ? { next: p.next } : {}) };
}

// ---- inbox.list_by_thread

interface ThreadRow {
  threadId: string;
  channel: Channel;
  subject?: string;
  mailboxId?: string;
  lastAt: number;
  participants: string[];
  unread: number;
  contactId?: string;
}

export async function listByThread(
  ctx: InboxCtx, input: Filter & { cursor?: string; limit?: number },
): Promise<{ threads: ThreadRow[]; showing: string; next?: string; total?: number }> {
  ensure(ctx);
  checkFilter(ctx, input);
  const w = windowOf(ctx, input);
  const q = input.query?.trim() ?? "";
  const convs = new Map((await mine(ctx, `deleted_at IS NULL`, [])).map(({ row }) => [str(row, "id"), row]));
  const channels: Channel[] = input.channel ? (input.channel === "call" ? [] : [input.channel]) : ["email", "sms"];
  const groups = new Map<string, Row[]>();
  for (const channel of channels) {
    for (const item of rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE kind = ?`, channel))) {
      const conv = convs.get(str(item, "conversationId"));
      if (!conv) continue;
      if (input.needsMatch !== undefined && (num(conv, "needsMatch") === 1) !== input.needsMatch) continue;
      if (input.mailboxId && str(item, "mailboxId") !== input.mailboxId) continue;
      if (input.numberId && str(item, "numberId") !== input.numberId) continue;
      const key = str(item, "threadId");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
  }
  const threads: ThreadRow[] = [];
  for (const [threadId, items] of groups) {
    const sorted = [...items].sort((a, b) => num(b, "at") - num(a, "at") || str(a, "id").localeCompare(str(b, "id")));
    const latest = sorted[0] as Row;
    const oldestFirst = [...sorted].reverse();
    const people = [...new Set(oldestFirst.flatMap((i) => jsonList(i.participants)))];
    const subject = oldestFirst.map((i) => str(i, "subject")).find((s) => s !== "") ?? "";   // the subject the thread started with
    if (q && !(has(subject, q) || people.some((p) => has(p, q)) || sorted.some((i) => has(str(i, "preview"), q)))) continue;
    const row: ThreadRow = {
      threadId, channel: str(latest, "kind") === "sms" ? "sms" : "email", lastAt: num(latest, "at"), participants: people, unread: sorted.filter((i) => num(i, "unread") === 1).length,
    };
    if (subject) row.subject = subject;
    const mailboxId = strOrNull(latest, "mailboxId");
    if (mailboxId) row.mailboxId = mailboxId;
    const contactId = strOrNull(convs.get(str(latest, "conversationId")) ?? null, "contactId");
    if (contactId) row.contactId = contactId;
    threads.push(row);
  }
  threads.sort((a, b) => b.lastAt - a.lastAt || a.threadId.localeCompare(b.threadId));
  const p = pageOf(threads, w);
  return { threads: p.rows, showing: showing(input, "threads"), total: p.total, ...(p.next ? { next: p.next } : {}) };
}

// ---- inbox.thread

interface TimelineItem {
  kind: "email" | "sms" | "call" | "meeting" | "campaign_step";
  id: string;
  at: number;
  direction?: "in" | "out";
  title?: string;
  preview?: string;
  campaignId?: string;
  ref?: Json;
}

function timelineOf(item: Row): TimelineItem {
  const kind = str(item, "kind") === "sms" ? "sms" : str(item, "kind") === "call" ? "call" : "email";
  const direction = str(item, "direction") === "out" ? "out" : "in";
  const campaignId = strOrNull(item, "campaignId");
  const out: TimelineItem = { kind: direction === "out" && campaignId && kind !== "call" ? "campaign_step" : kind, id: str(item, "refId"), at: num(item, "at"), direction };
  const subject = str(item, "subject");
  if (subject) out.title = subject;
  const preview = str(item, "preview");
  if (preview) out.preview = preview;
  if (campaignId) out.campaignId = campaignId;
  out.ref = { kind: kind === "email" ? "mail_message" : kind, id: str(item, "refId"), ...(strOrNull(item, "threadId") ? { threadId: str(item, "threadId") } : {}) };
  return out;
}

const order = (a: { at: number; id: string }, b: { at: number; id: string }): number => b.at - a.at || a.id.localeCompare(b.id);

export async function thread(
  ctx: InboxCtx, input: { conversationId?: string; contactId?: string; before?: number; cursor?: string; limit?: number },
): Promise<{ conversation: ConversationRow; items: TimelineItem[]; next?: string; total?: number }> {
  ensure(ctx);
  if (!input.conversationId && !input.contactId) bad(ctx, "Name a conversation or a contact.");
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "The limit is 1 to 500.");
  if (input.before !== undefined && (!Number.isSafeInteger(input.before) || input.before < 0)) bad(ctx, "Before must be milliseconds since the epoch.");
  let resume: { at: number; id: string } | null = null;
  if (input.cursor !== undefined) {
    const [at, ...rest] = input.cursor.split("|");
    if (!/^\d+$/.test(at ?? "") || rest.length === 0) bad(ctx, "That cursor is not one this list gave.");
    resume = { at: Number(at), id: rest.join("|") };
  }
  const conv = input.conversationId
    ? getConversation(ctx, input.conversationId)
    : first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE "contactId" = ? AND deleted_at IS NULL`, input.contactId));
  if (!conv) missing(ctx, "There is no conversation with that person yet.");
  const id = str(conv, "id");
  if (ctx.authorize({ perm: null, level: "view" }, { type: "conversation", id }).effect !== "allow") throw fail("permission.not_found", ctx.trace.traceId);

  const all: TimelineItem[] = rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE "conversationId" = ?`, id)).map(timelineOf);
  const contactId = strOrNull(conv, "contactId");
  if (contactId) {
    try {
      for (const m of list(obj(await ctx.call("meetings.list", { contactId, limit: 200 })).meetings).map(obj)) {
        const at = typeof m.startsAt === "number" ? m.startsAt : 0;
        if (text(m.status) === "canceled" || at > ctx.now() || text(m.id) === "") continue;   // a meeting shows in the history once it has started
        all.push({
          kind: "meeting", id: text(m.id), at, title: text(m.title),
          ref: { kind: "meeting", id: text(m.id), recording: text(m.recordingState), hasTranscript: m.hasTranscript === true, hasSummary: m.hasSummary === true },
        });
      }
    } catch (e) {
      ctx.log.warn("inbox: meetings are not in this history", { code: codeOf(e) });
    }
  }
  const window = all
    .filter((i) => (input.before === undefined || i.at < input.before) && (!resume || i.at < resume.at || (i.at === resume.at && i.id.localeCompare(resume.id) > 0)))
    .sort(order);
  const page = window.slice(0, limit);
  const out: { conversation: ConversationRow; items: TimelineItem[]; next?: string; total?: number } = {
    conversation: toConversation(ctx, conv), items: [...page].reverse(), total: all.length,
  };
  const last = page[page.length - 1];
  if (window.length > limit && last) out.next = `${last.at}|${last.id}`;
  return out;
}

// ---- inbox.unmatched, inbox.needs_match

export async function unmatched(ctx: InboxCtx, input: { query?: string; cursor?: string; limit?: number }): Promise<{ rows: ConversationRow[]; next?: string; total?: number }> {
  ensure(ctx);
  const w = windowOf(ctx, input);
  const q = input.query?.trim() ?? "";
  const found = (await mine(ctx, `deleted_at IS NULL AND "contactId" IS NULL AND "needsMatch" = ?`, [0])).filter(({ row }) => !q || has(str(row, "displayName"), q) || has(str(row, "address"), q));
  const p = pageOf(found, w);
  return { rows: p.rows.map(({ row }) => toConversation(ctx, row)), total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function needsMatch(
  ctx: InboxCtx, input: { cursor?: string; limit?: number },
): Promise<{ rows: { conversation: ConversationRow; suggestions: { recordId: string; type: "contact" | "company"; name: string; score: number; why: string }[] }[]; next?: string; total?: number }> {
  ensure(ctx);
  const w = windowOf(ctx, input);
  const found = await mine(ctx, `deleted_at IS NULL AND "contactId" IS NULL AND "needsMatch" = ?`, [1]);
  const p = pageOf(found, w);
  const why = { address: "Same email address", phone: "Same phone number", handle: "Same handle", name: "Similar name" } as const;
  const rows: Awaited<ReturnType<typeof needsMatch>>["rows"] = [];
  for (const { row } of p.rows) {
    const c = await candidatesFor(ctx, str(row, "address"), str(row, "displayName"));
    const seen = new Set<string>();
    const suggestions = [...c.sure, ...c.unsure].filter((x) => !seen.has(x.recordId) && seen.add(x.recordId)).map((x) => ({ recordId: x.recordId, type: x.type, name: x.name, score: x.score, why: why[x.via] }));
    rows.push({ conversation: toConversation(ctx, row), suggestions });
  }
  return { rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

// ---- inbox.counts

export async function counts(ctx: InboxCtx): Promise<{ byInbox: { kind: "mailbox" | "number"; id: string; unread: number }[]; total: number; needsMatch: number }> {
  ensure(ctx);
  const found = await mine(ctx, `deleted_at IS NULL`, []);
  const ids = new Set(found.map(({ row }) => str(row, "id")));
  const byInbox = new Map<string, { kind: "mailbox" | "number"; id: string; unread: number }>();
  const bump = (kind: "mailbox" | "number", id: string | null): void => {
    if (!id) return;
    const key = `${kind}:${id}`;
    const have = byInbox.get(key) ?? { kind, id, unread: 0 };
    have.unread += 1;
    byInbox.set(key, have);
  };
  for (const item of rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE unread = ?`, 1))) {
    if (!ids.has(str(item, "conversationId"))) continue;
    bump("mailbox", strOrNull(item, "mailboxId"));
    bump("number", strOrNull(item, "numberId"));
  }
  return {
    byInbox: [...byInbox.values()].sort((a, b) => b.unread - a.unread || a.id.localeCompare(b.id)),
    total: found.reduce((n, { row }) => n + Math.max(0, Math.trunc(num(row, "unreadCount"))), 0),
    needsMatch: found.filter(({ row }) => num(row, "needsMatch") === 1).length,
  };
}

// ---- inbox.following

export async function following(
  ctx: InboxCtx, input: { cursor?: string; limit?: number },
): Promise<{ rows: { contactId: string; reasons: Reason[]; alertOnReplies: boolean }[]; next?: string; total?: number }> {
  ensure(ctx);
  const w = windowOf(ctx, input);
  const byContact = new Map<string, Set<Reason>>();
  for (const { row, reasons } of await mine(ctx, `deleted_at IS NULL`, [])) {
    const contactId = strOrNull(row, "contactId");
    if (!contactId) continue;
    const have = byContact.get(contactId) ?? new Set<Reason>();
    for (const r of reasons) have.add(r);
    byContact.set(contactId, have);
  }
  // a followed contact with no messages yet still reaches you
  for (const f of rowsOf(ctx.db.all(`SELECT * FROM inbox_follow WHERE "principalId" = ? AND deleted_at IS NULL`, ctx.principal.id))) {
    const contactId = str(f, "contactId");
    const have = byContact.get(contactId) ?? new Set<Reason>();
    have.add("follow");
    byContact.set(contactId, have);
  }
  const rank: Reason[] = ["owner", "project", "follow", "campaign", "shared_inbox"];
  const all = [...byContact.entries()]
    .map(([contactId, set]) => ({ contactId, reasons: rank.filter((r) => set.has(r)), alertOnReplies: num(first(ctx.db.all(`SELECT * FROM inbox_follow WHERE "contactId" = ? AND "principalId" = ? AND deleted_at IS NULL`, contactId, ctx.principal.id)), "alertOnReplies") === 1 }))
    .sort((a, b) => a.contactId.localeCompare(b.contactId));
  const p = pageOf(all, w);
  return { rows: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

// ---- inbox.send_options

interface Option {
  kind: "mailbox" | "number";
  id: string;
  address: string;
  canSend: boolean;
  isDefault: boolean;
}

export async function sendOptions(ctx: InboxCtx, input: { conversationId?: string; contactId?: string }): Promise<{ channels: ("email" | "sms")[]; inboxes: Option[] }> {
  ensure(ctx);
  if (!input.conversationId && !input.contactId) bad(ctx, "Name a conversation or a contact.");
  const conv = input.conversationId
    ? (getConversation(ctx, input.conversationId) ?? missing(ctx, "There is no such conversation."))
    : first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE "contactId" = ? AND deleted_at IS NULL`, input.contactId));
  const contactId = input.contactId ?? strOrNull(conv, "contactId");
  const items = conv ? rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE "conversationId" = ?`, str(conv, "id"))) : [];

  const addresses = new Set<string>(items.map((i) => str(i, "address")));
  if (conv) addresses.add(str(conv, "address"));
  if (contactId) {
    for (const a of list(obj(await ctx.call("contacts.address.list", { contactId })).addresses).map(obj)) addresses.add(text(a.value).toLowerCase());
  }
  const hasEmail = [...addresses].some((a) => /^[^\s@]+@[^\s@]+$/.test(a));
  const hasPhone = [...addresses].some((a) => /^\+[1-9][0-9]{6,14}$/.test(a));
  const channels: ("email" | "sms")[] = [...(hasEmail ? (["email"] as const) : []), ...(hasPhone ? (["sms"] as const) : [])];

  const inboxes: Option[] = [];
  for (const m of list(obj(await ctx.call("mail.mailbox.list", { scope: "all" })).mailboxes).map(obj)) {
    const id = text(m.id);
    const okState = !["paused", "error", "disconnected", "pending"].includes(text(m.state)) && text(m.provider) !== "inbound_only";
    const allowed = ctx.authorize({ perm: text(m.kind) === "shared" ? "comms.shared_send" : null, level: "use" }, { type: "mailbox", id }).effect === "allow";
    if (id) inboxes.push({ kind: "mailbox", id, address: text(m.address), canSend: okState && allowed, isDefault: false });
  }
  for (const n of list(obj(await ctx.call("telephony.number.list", {})).numbers).map(obj)) {
    const id = text(n.id);
    if (!id || !strings(n.capabilities).includes("sms")) continue;
    const allowed = ctx.authorize({ perm: null, level: "use" }, { type: "number", id }).effect === "allow";
    inboxes.push({ kind: "number", id, address: text(n.e164), canSend: text(n.state) === "active" && allowed, isDefault: false });
  }

  // replies go out from the inbox the thread came in on; with no history, the first inbox that can send on the first channel
  const latestIn = [...items].filter((i) => str(i, "direction") === "in" && str(i, "kind") !== "call").sort((a, b) => num(b, "at") - num(a, "at"))[0];
  const wantKind = latestIn ? (str(latestIn, "kind") === "sms" ? "number" : "mailbox") : channels[0] === "sms" ? "number" : "mailbox";
  const wantId = latestIn ? (wantKind === "number" ? str(latestIn, "numberId") : str(latestIn, "mailboxId")) : "";
  const pick = inboxes.find((o) => o.kind === wantKind && o.id === wantId && o.canSend) ?? inboxes.find((o) => o.kind === wantKind && o.canSend) ?? inboxes.find((o) => o.canSend);
  if (pick) pick.isDefault = true;
  return { channels, inboxes };
}

// ---- inbox.recipients_search

export async function recipientsSearch(
  ctx: InboxCtx, input: { q: string; kinds?: ("contact" | "member" | "inbox" | "group")[]; limit?: number },
): Promise<{ results: { kind: "contact" | "member" | "inbox" | "group"; id: string; label: string; address?: string; score: number }[] }> {
  ensure(ctx);
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (!q || q.length > 200) bad(ctx, "Search text is 1 to 200 characters.");
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) bad(ctx, "The limit is 1 to 50.");
  const kinds = new Set(input.kinds ?? ["contact", "member", "inbox", "group"]);
  const score = (label: string, address: string): number => {
    const l = label.toLowerCase();
    const n = q.toLowerCase();
    if (l === n || address.toLowerCase() === n) return 1;
    if (l.startsWith(n) || address.toLowerCase().startsWith(n)) return 0.9;
    if (l.split(/\s+/).some((w) => w.startsWith(n))) return 0.8;
    return has(l, n) || has(address, n) ? 0.6 : 0;
  };
  const results: { kind: "contact" | "member" | "inbox" | "group"; id: string; label: string; address?: string; score: number }[] = [];
  const add = (kind: "contact" | "inbox" | "group", id: string, label: string, address: string, floor = 0): void => {
    const s = Math.max(score(label, address), floor);
    if (!id || s <= 0) return;
    results.push(address ? { kind, id, label: label || address, address, score: s } : { kind, id, label: label || id, score: s });
  };
  if (kinds.has("contact")) {
    for (const type of ["contact", "company"]) {
      for (const r of list(obj(await ctx.call("records.search", { type, q, limit })).rows).map(obj)) {
        const f = obj(r.fields);
        add("contact", text(r.id), text(f.name), text(f.email) || text(f.phone), 0.5);   // the records search already judged it a hit
      }
    }
  }
  if (kinds.has("inbox")) {
    for (const m of list(obj(await ctx.call("mail.mailbox.list", { scope: "all" })).mailboxes).map(obj)) add("inbox", text(m.id), text(m.title), text(m.address));
  }
  if (kinds.has("group")) {
    for (const g of list(obj(await ctx.call("access.groups.list", { q })).groups).map(obj)) add("group", text(g.id), text(g.name), "", 0.5);
  }
  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { results: results.slice(0, limit) };
}


