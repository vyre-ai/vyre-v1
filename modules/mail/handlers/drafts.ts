// mail.draft, mail.drafts.list, mail.drafts.discard (spec 2.18 Views: "Draft (an agent drafts; Send, Edit, Discard, with a Gate line)").
// A draft is a mail_message row with status 'draft' and direction 'out'. Nothing leaves the Space from here: sending is mail.send / mail.send_as.
// An agent draft carries a Gate line that tells the person why the send waits for approval. A person editing the draft does not clear who drafted it.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  allow, bad, can, EMAIL, ensure, first, isId, missing, newId, normalizeEmail, num, partyJson, readParties, readStrings, rowsOf, snippetOf, str, strOrNull,
} from "../projections.ts";
import type { MailCtx, Party, Row } from "../projections.ts";

export interface DraftIn {
  mailboxId: string;
  to?: Party[];
  cc?: Party[];
  bcc?: Party[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: string[];
  replyToMessageId?: string;
  contactId?: string;
  campaignId?: string;
  draftId?: string;
  idempotencyKey: string;
}

export interface DraftOut {
  draftId: string;
  gateLine?: string;
}

export interface MessageRowOut {
  id: string;
  mailboxId: string;
  inboxIds: string[];
  threadId: string;
  direction: "in" | "out";
  status: string;
  from: Party;
  to: Party[];
  cc: Party[];
  subject: string;
  snippet: string;
  sentAt: number;
  contactId?: string;
  isPrivate: boolean;
  campaignId?: string;
  draftedByAgent?: string;
}

const GATE_LINE = "An agent wrote this draft. It is sent only after a person approves.";
const DEFAULT_LIMIT = 50;

export async function draft(ctx: MailCtx, input: DraftIn): Promise<DraftOut> {
  ensure(ctx);
  if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0) bad(ctx, "Idempotency key is required.");
  const box = first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, input.mailboxId));
  if (!box) missing(ctx, "Mailbox does not exist.");

  const prior = strOrNull(first(ctx.db.all(`SELECT "refId" FROM mail_idem WHERE "idemKey" = ? AND kind = ?`, input.idempotencyKey, "draft")), "refId");
  if (prior) return answer(ctx, prior);

  const existing = input.draftId === undefined ? null : loadDraft(ctx, input.draftId);
  if (input.draftId !== undefined) {
    if (!existing) missing(ctx, "Draft does not exist.");
    if (str(existing, "mailboxId") !== input.mailboxId) bad(ctx, "That draft belongs to another mailbox.");
  }

  const parent = input.replyToMessageId === undefined ? null : loadParent(ctx, input, box);
  const own = str(box, "address");
  const text = input.text;
  const to = cleanParties(ctx, input.to ?? (parent ? replyTargets(parent, own) : existing ? readParties(str(existing, "toAddresses")) : []));
  const cc = cleanParties(ctx, input.cc ?? (existing ? readParties(str(existing, "ccAddresses")) : []));
  const bcc = cleanParties(ctx, input.bcc ?? (existing ? readParties(bccOf(ctx, str(existing, "id"))) : []));
  const lists = dedupeRecipients(to, cc, bcc);
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (input.campaignId !== undefined && !isId("cmp", input.campaignId)) bad(ctx, "Campaign id is not valid.");
  const files = input.attachments ?? (existing ? attachmentIds(str(existing, "attachments")) : []);
  for (const f of files) if (!isId("fil", f)) bad(ctx, "Attachment id is not valid.");

  const subject = input.subject ?? (existing ? str(existing, "subject") : parent ? replySubject(str(parent, "subject")) : "");
  const bodyText = text ?? (existing ? textOf(ctx, str(existing, "id")) : undefined);
  const bodyHtml = input.html ?? (existing ? htmlOf(ctx, str(existing, "id")) : undefined);
  const contactId = input.contactId ?? strOrNull(existing, "contactId") ?? strOrNull(parent, "contactId");
  const campaignId = input.campaignId ?? strOrNull(existing, "campaignId") ?? strOrNull(parent, "campaignId");
  const agentId = ctx.principal.kind === "agent" && isId("agt", ctx.principal.id) ? ctx.principal.id : null;
  const now = ctx.now();
  const draftId = existing ? str(existing, "id") : newId("eml", now);
  const threadId = existing ? str(existing, "threadId") : strOrNull(parent, "threadId") ?? draftId;
  const draftedBy = strOrNull(existing, "draftedByAgent") ?? agentId;

  if (existing) {
    ctx.db.run(
      `UPDATE mail_message SET "toAddresses" = ?, "ccAddresses" = ?, subject = ?, snippet = ?, body = ?, "sentAt" = ?, "contactId" = ?, "campaignId" = ?,
        attachments = ?, "draftedByAgent" = ?, version = ?, updated_at = ? WHERE id = ?`,
      partyJson(lists.to), partyJson(lists.cc), subject, snippetOf(bodyText, subject), bodyText ?? bodyHtml ?? "", now, contactId, campaignId,
      JSON.stringify(files.map((fileId) => ({ fileId }))), draftedBy, num(existing, "version") + 1, now, draftId,
    );
    ctx.db.run(
      `UPDATE mail_body SET text = ?, html = ?, bcc = ? WHERE "messageId" = ?`,
      bodyText ?? null, bodyHtml ?? null, partyJson(lists.bcc), draftId,
    );
  } else {
    ctx.db.run(
      `INSERT INTO mail_message (
        id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
        "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
        "isPrivate", "campaignId", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      draftId, input.mailboxId, JSON.stringify([input.mailboxId]), null, null, threadId, "out", "draft",
      own, partyJson(lists.to), partyJson(lists.cc), subject, snippetOf(bodyText, subject), bodyText ?? bodyHtml ?? "", now, contactId,
      str(box, "privacy") === "private" ? 1 : 0, campaignId, JSON.stringify(files.map((fileId) => ({ fileId }))), draftedBy, ctx.trace.traceId, 1, now, null,
    );
    ctx.db.run(
      `INSERT INTO mail_body ("messageId", text, html, "fromName", bcc, headers) VALUES (?, ?, ?, ?, ?, ?)`,
      draftId, bodyText ?? null, bodyHtml ?? null, null, partyJson(lists.bcc), null,
    );
  }
  ctx.db.run(`INSERT OR IGNORE INTO mail_idem ("idemKey", kind, "refId") VALUES (?, ?, ?)`, input.idempotencyKey, "draft", draftId);

  const payload: { draftId: string; mailboxId: string; byAgent?: string; contactId?: string } = { draftId, mailboxId: input.mailboxId };
  if (draftedBy) payload.byAgent = draftedBy;
  if (contactId) payload.contactId = contactId;
  ctx.emit("mail_draft.saved", `mail_message/${draftId}`, payload);
  return answer(ctx, draftId);
}

export async function draftsList(
  ctx: MailCtx,
  input: { mailboxId?: string; contactId?: string; cursor?: string; limit?: number },
): Promise<{ drafts: MessageRowOut[]; next?: string; total: number }> {
  ensure(ctx);
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  const limit = input.limit === undefined ? DEFAULT_LIMIT : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");

  const where = [`status = ?`, `deleted_at IS NULL`];
  const args: unknown[] = ["draft"];
  if (input.mailboxId) { where.push(`"mailboxId" = ?`); args.push(input.mailboxId); }
  if (input.contactId) { where.push(`"contactId" = ?`); args.push(input.contactId); }
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_message WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`, ...args));

  // Drafts are mail: a caller sees the drafts of mailboxes they may read.
  const verdict = new Map<string, boolean>();
  const visible = rows.filter((r) => {
    const id = str(r, "mailboxId");
    if (!verdict.has(id)) verdict.set(id, can(ctx, "view", { type: "mailbox", id }));
    return verdict.get(id) === true;
  });
  const page = visible.slice(offset, offset + limit);
  const out: { drafts: MessageRowOut[]; next?: string; total: number } = { drafts: page.map(rowOut), total: visible.length };
  if (offset + limit < visible.length) out.next = String(offset + limit);
  return out;
}

export async function draftsDiscard(ctx: MailCtx, input: { draftId: string }): Promise<{ discarded: boolean }> {
  ensure(ctx);
  if (!isId("eml", input.draftId)) bad(ctx, "Draft id is not valid.");
  const row = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, input.draftId));
  if (!row) missing(ctx, "Draft does not exist.");
  allow(ctx, "use", { type: "mailbox", id: str(row, "mailboxId") });
  if (str(row, "status") !== "draft") {
    throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Only a draft can be discarded." });
  }
  ctx.db.run(`UPDATE mail_message SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, ctx.now(), num(row, "version") + 1, ctx.now(), input.draftId);
  ctx.emit("mail_draft.discarded", `mail_message/${input.draftId}`, { draftId: input.draftId });
  return { discarded: true };
}

// ---- helpers

function answer(ctx: MailCtx, draftId: string): DraftOut {
  const row = first(ctx.db.all(`SELECT "draftedByAgent" FROM mail_message WHERE id = ?`, draftId));
  const out: DraftOut = { draftId };
  if (strOrNull(row, "draftedByAgent")) out.gateLine = GATE_LINE;
  return out;
}

function loadDraft(ctx: MailCtx, id: string): Row | null {
  if (!isId("eml", id)) bad(ctx, "Draft id is not valid.");
  const row = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, id));
  if (row && str(row, "status") !== "draft") {
    throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "That message is no longer a draft." });
  }
  return row;
}

function loadParent(ctx: MailCtx, input: DraftIn, box: Row): Row {
  const id = input.replyToMessageId ?? "";
  if (!isId("eml", id)) bad(ctx, "Reply target id is not valid.");
  const parent = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, id));
  // The reply goes out from an inbox the message sits in; a message in none of the caller's mailboxes is not theirs to answer.
  if (!parent || !readStrings(str(parent, "inboxIds")).includes(str(box, "id"))) missing(ctx, "The message you are replying to is not in this mailbox.");
  return parent;
}

/** Who a reply goes to: the sender of mail we received, the recipients of mail we sent. Never this mailbox itself. */
function replyTargets(parent: Row, own: string): Party[] {
  const sentByUs = str(parent, "direction") === "out";
  const people: Party[] = sentByUs ? readParties(str(parent, "toAddresses")) : [{ address: str(parent, "fromAddress") }];
  return people.filter((p) => normalizeEmail(p.address) !== normalizeEmail(own));
}

const replySubject = (s: string): string => (/^re:\s/i.test(s) ? s : `Re: ${s}`);

function cleanParties(ctx: MailCtx, parties: Party[]): Party[] {
  if (!Array.isArray(parties)) bad(ctx, "Recipients must be a list.");
  return parties.map((p) => {
    const address = normalizeEmail(p?.address ?? "");
    if (!EMAIL.test(address)) bad(ctx, "Address is not an email.");
    if (p.contactId !== undefined && !isId("rec", p.contactId)) bad(ctx, "Contact id is not valid.");
    const out: Party = { address };
    if (p.name) out.name = p.name;
    if (p.contactId) out.contactId = p.contactId;
    return out;
  });
}

/** One recipient field everywhere (spec 2.18): an address appears once, in To before Cc before Bcc. */
function dedupeRecipients(to: Party[], cc: Party[], bcc: Party[]): { to: Party[]; cc: Party[]; bcc: Party[] } {
  const seen = new Set<string>();
  const keep = (list: Party[]): Party[] => list.filter((p) => {
    if (seen.has(p.address)) return false;
    seen.add(p.address);
    return true;
  });
  const a = keep(to);
  const b = keep(cc);
  return { to: a, cc: b, bcc: keep(bcc) };
}

function bodyRow(ctx: MailCtx, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_body WHERE "messageId" = ?`, id));
}
const bccOf = (ctx: MailCtx, id: string): string => str(bodyRow(ctx, id), "bcc");
const textOf = (ctx: MailCtx, id: string): string | undefined => strOrNull(bodyRow(ctx, id), "text") ?? undefined;
const htmlOf = (ctx: MailCtx, id: string): string | undefined => strOrNull(bodyRow(ctx, id), "html") ?? undefined;

function attachmentIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) if (item && typeof item === "object" && typeof (item as { fileId?: unknown }).fileId === "string") out.push((item as { fileId: string }).fileId);
    return out;
  } catch {
    return [];
  }
}

function rowOut(row: Row): MessageRowOut {
  const out: MessageRowOut = {
    id: str(row, "id"),
    mailboxId: str(row, "mailboxId"),
    inboxIds: readStrings(str(row, "inboxIds")),
    threadId: str(row, "threadId"),
    direction: str(row, "direction") === "in" ? "in" : "out",
    status: str(row, "status"),
    from: { address: str(row, "fromAddress") },
    to: readParties(str(row, "toAddresses")),
    cc: readParties(str(row, "ccAddresses")),
    subject: str(row, "subject"),
    snippet: str(row, "snippet"),
    sentAt: num(row, "sentAt"),
    isPrivate: num(row, "isPrivate") === 1,
  };
  const contactId = strOrNull(row, "contactId");
  const campaignId = strOrNull(row, "campaignId");
  const agent = strOrNull(row, "draftedByAgent");
  if (contactId) out.contactId = contactId;
  if (campaignId) out.campaignId = campaignId;
  if (agent) out.draftedByAgent = agent;
  return out;
}
