// mail.ingest, mail.connect, mail.sync_now, and IMAP IDLE replay.
// Dedupe key is the provider id. The same RFC message in another inbox is one record.
// A single strong address match links. Several candidates, or a prior outbound with no
// record, become a Needs you task. Private and paused mailboxes stay in the mailbox view.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  allow, bad, EMAIL, ensure, first, isId, logRead, missing, newId, normalizeEmail, num, partyJson, snippetOf, str, strOrNull,
} from "../fixtures/db.ts";
import type { MailCtx, Party, Row } from "../fixtures/db.ts";
import { openImapSession } from "../fixtures/replay.ts";
import type { ImapConfig, ImapFetched } from "../fixtures/replay.ts";
import { bumpUnread } from "../projections.ts";

const SOURCES = new Set(["google", "microsoft", "imap", "resend", "mailgun"]);
const PROVIDERS = new Set(["google", "microsoft", "imap"]);
const PRIVACY = new Set(["private", "space", "people"]);
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const SURE = 0.8;

export interface IngestIn {
  source: "google" | "microsoft" | "imap" | "resend" | "mailgun";
  mailboxId?: string;
  envelopeTo?: string;
  providerId: string;
  rfcMessageId: string;
  threadKey?: string;
  direction?: "in" | "out";
  from: Party;
  to: Party[];
  cc?: Party[];
  subject: string;
  text?: string;
  html?: string;
  receivedAt: number;
  attachments?: { name: string; mime: string; size: number; blobId: string }[];
  headers?: Record<string, string>;
}

export interface IngestOut {
  messageId: string;
  deduped: boolean;
  linked: "sure" | "unsure" | "none";
  contactId?: string;
  conversationId?: string;
  taskId?: string;
}

export interface ConnectIn {
  provider: "google" | "microsoft" | "imap";
  address: string;
  privacy?: "private" | "space" | "people";
  imap?: ImapConfig;
  idempotencyKey: string;
}

export interface MailboxOut {
  id: string;
  kind: "personal" | "shared" | "agent" | "service";
  address: string;
  title: string;
  ownerId?: string;
  agentId?: string;
  provider: "google" | "microsoft" | "imap" | "inbound_only";
  privacy: "private" | "space" | "people";
  state: "pending" | "syncing" | "paused" | "error" | "disconnected";
  lastSyncAt?: number;
}

interface Parsed {
  source: IngestIn["source"];
  mailboxId?: string;
  providerId: string;
  rfc: string;
  threadKey?: string;
  direction: "in" | "out";
  from: Party;
  to: Party[];
  cc: Party[];
  subject: string;
  text?: string;
  html?: string;
  receivedAt: number;
  attachments: { name: string; mime: string; size: number; blobId: string }[];
  headers?: Record<string, string>;
}

interface Match {
  linked: "sure" | "unsure" | "none";
  contactId: string | null;
  suggestions: { contactId: string; score: number }[];
  needsTask: boolean;
}

export function rememberAddress(ctx: MailCtx, email: string, contactId: string, score: number): void {
  ensure(ctx);
  const address = normalizeEmail(email);
  if (!EMAIL.test(address)) bad(ctx, "Address is not an email.");
  if (!isId("rec", contactId)) bad(ctx, "Contact id is not valid.");
  if (!(score >= 0 && score <= 1)) bad(ctx, "Match score must be from 0 to 1.");
  const existing = first(ctx.db.all(`SELECT email FROM mail_party WHERE email = ? AND "contactId" = ?`, address, contactId));
  if (existing) {
    ctx.db.run(`UPDATE mail_party SET score = ? WHERE email = ? AND "contactId" = ?`, score, address, contactId);
    return;
  }
  ctx.db.run(`INSERT INTO mail_party (email, "contactId", score) VALUES (?, ?, ?)`, address, contactId, score);
}

export function markThreadFollowed(ctx: MailCtx, threadKey: string): void {
  ensure(ctx);
  const key = threadKey.trim();
  if (!key) bad(ctx, "Thread key is empty.");
  const existing = first(ctx.db.all(`SELECT "threadKey" FROM mail_follow WHERE "threadKey" = ?`, key));
  if (!existing) ctx.db.run(`INSERT INTO mail_follow ("threadKey") VALUES (?)`, key);
}

export async function ingest(ctx: MailCtx, input: IngestIn): Promise<IngestOut> {
  allow(ctx, "edit", { type: "space", id: ctx.space });
  ensure(ctx);
  const parsed = parseIngest(ctx, input);
  const box = parsed.mailboxId ? loadMailbox(ctx, parsed.mailboxId) : null;
  if (parsed.mailboxId && !box) bad(ctx, "Mailbox does not exist.");

  const seen = first(ctx.db.all(
    `SELECT "messageId" FROM mail_seen WHERE source = ? AND "providerId" = ?`,
    parsed.source,
    parsed.providerId,
  ));
  if (seen) {
    const messageId = str(seen, "messageId");
    noteInbox(ctx, messageId, parsed.mailboxId);
    await maybeFile(ctx, messageId, parsed, box);
    return resultOf(messageId, true, readLink(ctx, messageId));
  }

  const byRfc = first(ctx.db.all(`SELECT "messageId" FROM mail_rfc WHERE "rfcMessageId" = ?`, parsed.rfc));
  if (byRfc) {
    const messageId = str(byRfc, "messageId");
    ctx.db.run(
      `INSERT INTO mail_seen (source, "providerId", "messageId") VALUES (?, ?, ?)`,
      parsed.source,
      parsed.providerId,
      messageId,
    );
    noteInbox(ctx, messageId, parsed.mailboxId);
    await maybeFile(ctx, messageId, parsed, box);
    return resultOf(messageId, true, readLink(ctx, messageId));
  }

  const messageId = newId("eml", ctx.now());
  insertMessage(ctx, messageId, parsed);
  ctx.db.run(
    `INSERT INTO mail_seen (source, "providerId", "messageId") VALUES (?, ?, ?)`,
    parsed.source,
    parsed.providerId,
    messageId,
  );
  ctx.db.run(`INSERT INTO mail_rfc ("rfcMessageId", "messageId") VALUES (?, ?)`, parsed.rfc, messageId);
  await applyFiling(ctx, messageId, parsed, box);
  if (parsed.mailboxId) {
    bumpUnread(ctx.db, parsed.mailboxId);
    logRead(ctx, parsed.mailboxId, "ingest");
  }
  return resultOf(messageId, false, readLink(ctx, messageId));
}

export async function connect(ctx: MailCtx, input: ConnectIn): Promise<{ mailbox: MailboxOut }> {
  allow(ctx, "edit", { type: "space", id: ctx.space });
  ensure(ctx);
  if (!PROVIDERS.has(input.provider)) bad(ctx, "Provider is not supported.");
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0) bad(ctx, "Idempotency key is required.");
  const address = normalizeEmail(input.address ?? "");
  if (!EMAIL.test(address)) bad(ctx, "Address is not an email.");
  const privacy = input.privacy ?? "space";
  if (!PRIVACY.has(privacy)) bad(ctx, "Privacy is not supported.");
  const prior = idemRef(ctx, input.idempotencyKey, "connect");
  if (prior) {
    const row = loadMailbox(ctx, prior);
    if (!row) bad(ctx, "Mailbox does not exist.");
    return { mailbox: mailboxOut(row) };
  }
  const ownerId = ctx.principal.kind === "person" ? ctx.principal.id : null;
  const agentId = ctx.principal.kind === "agent" ? ctx.principal.id : null;
  if (duplicateMailbox(ctx, address, input.provider, ownerId, agentId)) {
    throw fail("validation.duplicate", ctx.trace.traceId, { message: "This mailbox is already connected." });
  }
  const imap = input.provider === "imap" ? requireImap(ctx, input.imap) : null;
  if (imap) await probeImap(ctx, imap);

  const id = newId("mbx", ctx.now());
  const now = ctx.now();
  const kind = agentId ? "agent" : "personal";
  const title = address.split("@")[0] || address;
  ctx.db.run(
    `INSERT INTO mail_mailbox (
      id, kind, address, title, "ownerId", "agentId", provider, privacy, state, "connectionId", "lastSyncAt", paused, version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, kind, address, title, ownerId, agentId, input.provider, privacy, "pending", null, null, 0, 1, now, null,
  );
  if (imap) {
    ctx.db.run(
      `INSERT INTO mail_imap ("mailboxId", host, port, secure, username, "passwordHandle") VALUES (?, ?, ?, ?, ?, ?)`,
      id, imap.host, imap.port, imap.secure ? 1 : 0, imap.username, imap.passwordHandle,
    );
    logRead(ctx, id, "login");
  }
  ctx.db.run(`INSERT INTO mail_idem (key, kind, "refId") VALUES (?, ?, ?)`, input.idempotencyKey, "connect", id);
  const memberId = isId("usr", ctx.principal.id) ? ctx.principal.id : undefined;
  const payload: { mailboxId: string; provider: string; auto: boolean; memberId?: string } = {
    mailboxId: id,
    provider: input.provider,
    auto: false,
  };
  if (memberId) payload.memberId = memberId;
  ctx.emit("mailbox.connected", `mailbox/${id}`, payload, { vis: "participants" });
  ctx.log.info("mail.connect", { mailboxId: id, provider: input.provider });
  const row = loadMailbox(ctx, id);
  if (!row) bad(ctx, "Mailbox does not exist.");
  return { mailbox: mailboxOut(row) };
}

export async function syncNow(ctx: MailCtx, input: { mailboxId: string }): Promise<{ runId: string }> {
  if (!isId("mbx", input.mailboxId ?? "")) bad(ctx, "Mailbox id is not valid.");
  allow(ctx, "use", { type: "mailbox", id: input.mailboxId });
  ensure(ctx);
  const box = loadMailbox(ctx, input.mailboxId);
  if (!box) missing(ctx, "Mailbox does not exist.");
  const runId = newId("run", ctx.now());
  if (syncBlocked(box)) {
    ctx.emit("mailbox.sync_failed", `mailbox/${input.mailboxId}`, {
      mailboxId: input.mailboxId,
      reason: "Mailbox is paused",
    }, { vis: "participants" });
    return { runId };
  }
  try {
    const pulled = str(box, "provider") === "imap" ? await pullImap(ctx, input.mailboxId) : { received: 0, sent: 0 };
    ctx.db.run(
      `UPDATE mail_mailbox SET state = ?, "lastSyncAt" = ?, updated_at = ? WHERE id = ?`,
      "syncing", ctx.now(), ctx.now(), input.mailboxId,
    );
    ctx.emit("mailbox.sync_completed", `mailbox/${input.mailboxId}`, {
      mailboxId: input.mailboxId,
      received: pulled.received,
      sent: pulled.sent,
    }, { vis: "participants" });
    ctx.log.info("mail.sync", { mailboxId: input.mailboxId, received: pulled.received });
  } catch {
    ctx.db.run(`UPDATE mail_mailbox SET state = ?, updated_at = ? WHERE id = ?`, "error", ctx.now(), input.mailboxId);
    ctx.emit("mailbox.sync_failed", `mailbox/${input.mailboxId}`, {
      mailboxId: input.mailboxId,
      reason: "Sign-in failed",
    }, { vis: "participants" });
  }
  return { runId };
}

function parseIngest(ctx: MailCtx, input: IngestIn): Parsed {
  if (!SOURCES.has(input.source)) bad(ctx, "Source is not supported.");
  if (typeof input.providerId !== "string" || input.providerId.trim().length === 0) bad(ctx, "Provider id is required.");
  if (typeof input.rfcMessageId !== "string" || input.rfcMessageId.trim().length === 0) bad(ctx, "Message id is required.");
  if (typeof input.subject !== "string") bad(ctx, "Subject is required.");
  if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) bad(ctx, "Received time is not valid.");
  if (!input.from || !EMAIL.test(normalizeEmail(input.from.address ?? ""))) bad(ctx, "From address is not an email.");
  if (!Array.isArray(input.to)) bad(ctx, "To is required.");
  const mailboxId = input.mailboxId;
  if (mailboxId !== undefined && !isId("mbx", mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const direction = input.direction ?? "in";
  if (direction !== "in" && direction !== "out") bad(ctx, "Direction is not valid.");
  const from = cleanParty(ctx, input.from);
  const to = input.to.map((party) => cleanParty(ctx, party));
  const cc = (input.cc ?? []).map((party) => cleanParty(ctx, party));
  const parsed: Parsed = {
    source: input.source,
    providerId: input.providerId.trim(),
    rfc: input.rfcMessageId.trim().toLowerCase(),
    direction,
    from,
    to,
    cc,
    subject: input.subject,
    receivedAt: input.receivedAt,
    attachments: input.attachments ?? [],
  };
  if (mailboxId) parsed.mailboxId = mailboxId;
  if (input.threadKey && input.threadKey.trim()) parsed.threadKey = input.threadKey.trim();
  if (input.text !== undefined) parsed.text = input.text;
  if (input.html !== undefined) parsed.html = input.html;
  if (input.headers) parsed.headers = input.headers;
  return parsed;
}

function cleanParty(ctx: MailCtx, party: Party): Party {
  const address = normalizeEmail(party.address ?? "");
  if (!EMAIL.test(address)) bad(ctx, "Address is not an email.");
  if (party.contactId !== undefined && !isId("rec", party.contactId)) bad(ctx, "Contact id is not valid.");
  const out: Party = { address };
  if (party.name) out.name = party.name;
  if (party.contactId) out.contactId = party.contactId;
  return out;
}

function insertMessage(ctx: MailCtx, messageId: string, parsed: Parsed): void {
  const inboxIds = parsed.mailboxId ? [parsed.mailboxId] : [];
  const body = parsed.text ?? parsed.html ?? "";
  ctx.db.run(
    `INSERT INTO mail_message (
      id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
      "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
      "isPrivate", "campaignId", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    messageId,
    parsed.mailboxId ?? null,
    JSON.stringify(inboxIds),
    parsed.providerId,
    parsed.rfc,
    parsed.threadKey ?? parsed.rfc,
    parsed.direction,
    parsed.direction === "out" ? "sent" : "received",
    parsed.from.address,
    partyJson(parsed.to),
    partyJson(parsed.cc),
    parsed.subject,
    snippetOf(parsed.text, parsed.subject),
    body,
    parsed.receivedAt,
    null,
    0,
    null,
    JSON.stringify(parsed.attachments),
    null,
    ctx.trace.traceId,
    1,
    ctx.now(),
    null,
  );
  ctx.db.run(
    `INSERT INTO mail_body ("messageId", text, html, "fromName", bcc, headers) VALUES (?, ?, ?, ?, ?, ?)`,
    messageId,
    parsed.text ?? null,
    parsed.html ?? null,
    parsed.from.name ?? null,
    null,
    parsed.headers ? JSON.stringify(parsed.headers) : null,
  );
}

function noteInbox(ctx: MailCtx, messageId: string, mailboxId: string | undefined): void {
  if (!mailboxId) return;
  const row = first(ctx.db.all(`SELECT "inboxIds" FROM mail_message WHERE id = ?`, messageId));
  if (!row) return;
  const ids = readIds(str(row, "inboxIds"));
  if (ids.includes(mailboxId)) return;
  ids.push(mailboxId);
  ctx.db.run(`UPDATE mail_message SET "inboxIds" = ?, updated_at = ? WHERE id = ?`, JSON.stringify(ids), ctx.now(), messageId);
  bumpUnread(ctx.db, mailboxId);
}

async function maybeFile(ctx: MailCtx, messageId: string, parsed: Parsed, box: Row | null): Promise<void> {
  const link = readLink(ctx, messageId);
  if (link && num(link, "filed") === 1) return;
  if (box && filingBlocked(box)) return;
  await applyFiling(ctx, messageId, parsed, box);
}

async function applyFiling(ctx: MailCtx, messageId: string, parsed: Parsed, box: Row | null): Promise<void> {
  if (box && filingBlocked(box)) {
    saveLink(ctx, messageId, "none", null, null, null, 0);
    return;
  }
  const match = await resolveMatch(ctx, parsed);
  const conversationId = newId("cnv", ctx.now());
  const taskId = match.needsTask ? newId("tsk", ctx.now()) : null;
  if (taskId) {
    ctx.db.run(
      `INSERT INTO mail_needs (id, "messageId", address, suggestions, state) VALUES (?, ?, ?, ?, ?)`,
      taskId,
      messageId,
      counterparty(parsed),
      JSON.stringify(match.suggestions),
      "open",
    );
  }
  if (match.contactId) {
    ctx.db.run(`UPDATE mail_message SET "contactId" = ?, updated_at = ? WHERE id = ?`, match.contactId, ctx.now(), messageId);
  }
  saveLink(ctx, messageId, match.linked, match.contactId, conversationId, taskId, 1);
  if (parsed.mailboxId) {
    const payload: { messageId: string; mailboxId: string; from: string; subject: string; contactId?: string } = {
      messageId,
      mailboxId: parsed.mailboxId,
      from: parsed.from.address,
      subject: parsed.subject,
    };
    if (match.contactId) payload.contactId = match.contactId;
    ctx.emit("mail.received", `mailbox/${parsed.mailboxId}`, payload);
  }
}

async function resolveMatch(ctx: MailCtx, parsed: Parsed): Promise<Match> {
  const address = counterparty(parsed);
  const none: Match = { linked: "none", contactId: null, suggestions: [], needsTask: false };
  if (!address) return none;
  const byId = new Map<string, { score: number; strong: boolean }>();
  const add = (id: string, score: number, strong: boolean): void => {
    if (!isId("rec", id)) return;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, { score, strong });
      return;
    }
    cur.score = Math.max(cur.score, score);
    cur.strong = cur.strong || strong;
  };
  const explicit = parsed.direction === "out" ? parsed.to[0]?.contactId : parsed.from.contactId;
  if (explicit) add(explicit, 1, true);
  for (const row of ctx.db.all(`SELECT "contactId", score FROM mail_party WHERE email = ?`, address)) {
    const rec = row as Row;
    const score = typeof rec.score === "number" ? rec.score : 0;
    add(str(rec, "contactId"), score, score >= SURE);
  }
  try {
    const remote = parseResolve(await ctx.call("contacts.resolve", { email: address }));
    for (const cand of remote.sure) add(cand.recordId, cand.score, true);
    for (const cand of remote.unsure) add(cand.recordId, cand.score, false);
  } catch {
    // contacts.resolve stays a stub until that module is live
  }
  const ids = [...byId.entries()];
  const strong = ids.filter(([, v]) => v.strong);
  const weak = ids.filter(([, v]) => !v.strong);
  if (strong.length === 1 && weak.length === 0) {
    return { linked: "sure", contactId: strong[0]![0], suggestions: [], needsTask: false };
  }
  if (ids.length > 0) {
    return {
      linked: "unsure",
      contactId: null,
      suggestions: ids.map(([contactId, v]) => ({ contactId, score: v.score })),
      needsTask: true,
    };
  }
  if (hasPriorOutbound(ctx, address) || (parsed.threadKey ? followed(ctx, parsed.threadKey) : false)) {
    return { linked: "unsure", contactId: null, suggestions: [], needsTask: true };
  }
  return none;
}

function hasPriorOutbound(ctx: MailCtx, address: string): boolean {
  return first(ctx.db.all(
    `SELECT id FROM mail_message WHERE direction = ? AND deleted_at IS NULL AND "toAddresses" LIKE ?`,
    "out",
    `%"address":"${address}"%`,
  )) !== null;
}

function followed(ctx: MailCtx, threadKey: string): boolean {
  return first(ctx.db.all(`SELECT "threadKey" FROM mail_follow WHERE "threadKey" = ?`, threadKey)) !== null;
}

function counterparty(parsed: Parsed): string {
  if (parsed.direction === "out") return parsed.to[0]?.address ?? "";
  return parsed.from.address;
}

function parseResolve(v: unknown): { sure: { recordId: string; score: number }[]; unsure: { recordId: string; score: number }[] } {
  const read = (value: unknown): { recordId: string; score: number }[] => {
    if (!Array.isArray(value)) return [];
    const out: { recordId: string; score: number }[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { recordId?: unknown; score?: unknown };
      if (typeof rec.recordId !== "string") continue;
      out.push({ recordId: rec.recordId, score: typeof rec.score === "number" ? rec.score : 0 });
    }
    return out;
  };
  if (!v || typeof v !== "object") return { sure: [], unsure: [] };
  const o = v as { sure?: unknown; unsure?: unknown };
  return { sure: read(o.sure), unsure: read(o.unsure) };
}

function saveLink(
  ctx: MailCtx,
  messageId: string,
  linked: Match["linked"],
  contactId: string | null,
  conversationId: string | null,
  taskId: string | null,
  filed: number,
): void {
  const existing = readLink(ctx, messageId);
  if (!existing) {
    ctx.db.run(
      `INSERT INTO mail_link ("messageId", linked, "contactId", "conversationId", "taskId", filed) VALUES (?, ?, ?, ?, ?, ?)`,
      messageId, linked, contactId, conversationId, taskId, filed,
    );
    return;
  }
  ctx.db.run(
    `UPDATE mail_link SET linked = ?, "contactId" = ?, "conversationId" = ?, "taskId" = ?, filed = ? WHERE "messageId" = ?`,
    linked, contactId, conversationId, taskId, filed, messageId,
  );
}

function readLink(ctx: MailCtx, messageId: string): Row | null {
  return first(ctx.db.all(
    `SELECT linked, "contactId", "conversationId", "taskId", filed FROM mail_link WHERE "messageId" = ?`,
    messageId,
  ));
}

function resultOf(messageId: string, deduped: boolean, link: Row | null): IngestOut {
  const linkedRaw = str(link, "linked");
  const linked = linkedRaw === "sure" || linkedRaw === "unsure" || linkedRaw === "none" ? linkedRaw : "none";
  const out: IngestOut = { messageId, deduped, linked };
  const contactId = strOrNull(link, "contactId");
  const conversationId = strOrNull(link, "conversationId");
  const taskId = strOrNull(link, "taskId");
  if (contactId) out.contactId = contactId;
  if (conversationId) out.conversationId = conversationId;
  if (taskId) out.taskId = taskId;
  return out;
}

function readIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function loadMailbox(ctx: MailCtx, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, id));
}

function filingBlocked(box: Row): boolean {
  if (num(box, "paused") === 1) return true;
  const state = str(box, "state");
  if (state === "paused" || state === "disconnected") return true;
  return str(box, "privacy") === "private";
}

function syncBlocked(box: Row): boolean {
  if (num(box, "paused") === 1) return true;
  const state = str(box, "state");
  return state === "paused" || state === "disconnected";
}

function duplicateMailbox(ctx: MailCtx, address: string, provider: string, ownerId: string | null, agentId: string | null): boolean {
  const rows = ctx.db.all(
    `SELECT "ownerId", "agentId" FROM mail_mailbox WHERE address = ? AND provider = ? AND deleted_at IS NULL`,
    address,
    provider,
  );
  return rows.some((item) => {
    const row = item as Row;
    return strOrNull(row, "ownerId") === ownerId && strOrNull(row, "agentId") === agentId;
  });
}

function idemRef(ctx: MailCtx, key: string, kind: string): string | null {
  const row = first(ctx.db.all(`SELECT "refId" FROM mail_idem WHERE key = ? AND kind = ?`, key, kind));
  return strOrNull(row, "refId");
}

function requireImap(ctx: MailCtx, imap: ImapConfig | undefined): ImapConfig {
  if (!imap) bad(ctx, "IMAP needs a host, port, username and password handle.");
  if (typeof imap.host !== "string" || imap.host.trim().length === 0 || /\s/.test(imap.host)) bad(ctx, "IMAP host is not valid.");
  if (!Number.isSafeInteger(imap.port) || imap.port < 1 || imap.port > 65535) bad(ctx, "IMAP port is not valid.");
  if (typeof imap.secure !== "boolean") bad(ctx, "IMAP secure flag is not valid.");
  if (typeof imap.username !== "string" || imap.username.length === 0) bad(ctx, "IMAP username is required.");
  if (!HANDLE.test(imap.passwordHandle ?? "")) bad(ctx, "Password handle is not valid.");
  return {
    host: imap.host.trim().toLowerCase(),
    port: imap.port,
    secure: imap.secure,
    username: imap.username,
    passwordHandle: imap.passwordHandle,
  };
}

async function probeImap(ctx: MailCtx, imap: ImapConfig): Promise<void> {
  try {
    ctx.vault.use(imap.passwordHandle);
  } catch {
    throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The mailbox did not accept the sign-in." });
  }
  const session = openImapSession(ctx, imap);
  try {
    await session.connect();
    await session.noop();
  } catch {
    throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The mailbox did not accept the sign-in." });
  } finally {
    await session.logout();
  }
}

async function pullImap(ctx: MailCtx, mailboxId: string): Promise<{ received: number; sent: number }> {
  const row = first(ctx.db.all(
    `SELECT host, port, secure, username, "passwordHandle" FROM mail_imap WHERE "mailboxId" = ?`,
    mailboxId,
  ));
  if (!row) throw new Error("missing imap settings");
  const imap: ImapConfig = {
    host: str(row, "host"),
    port: num(row, "port"),
    secure: num(row, "secure") === 1,
    username: str(row, "username"),
    passwordHandle: str(row, "passwordHandle"),
  };
  logRead(ctx, mailboxId, "sync");
  ctx.vault.use(imap.passwordHandle);
  const session = openImapSession(ctx, imap);
  let received = 0;
  let sent = 0;
  const land = async (messages: ImapFetched[]): Promise<void> => {
    for (const message of messages) {
      if (message.direction === "out") sent += 1;
      else received += 1;
      await ctx.call("mail.ingest", toIngest(mailboxId, message));
    }
  };
  try {
    await session.connect();
    await session.noop();
    await land(await session.fetchUnseen());
    await session.idle(async (info) => {
      await land(await session.fetchSince(info.exists));
    });
  } finally {
    await session.logout();
  }
  return { received, sent };
}

function toIngest(mailboxId: string, message: ImapFetched): IngestIn {
  const input: IngestIn = {
    source: "imap",
    mailboxId,
    providerId: message.providerId,
    rfcMessageId: message.rfcMessageId,
    direction: message.direction ?? "in",
    from: message.from,
    to: message.to,
    subject: message.subject,
    receivedAt: message.receivedAt,
  };
  if (message.threadKey) input.threadKey = message.threadKey;
  if (message.cc) input.cc = message.cc;
  if (message.text !== undefined) input.text = message.text;
  if (message.html !== undefined) input.html = message.html;
  return input;
}

function mailboxOut(row: Row): MailboxOut {
  const out: MailboxOut = {
    id: str(row, "id"),
    kind: str(row, "kind") as MailboxOut["kind"],
    address: str(row, "address"),
    title: str(row, "title"),
    provider: str(row, "provider") as MailboxOut["provider"],
    privacy: str(row, "privacy") as MailboxOut["privacy"],
    state: str(row, "state") as MailboxOut["state"],
  };
  const ownerId = strOrNull(row, "ownerId");
  const agentId = strOrNull(row, "agentId");
  if (ownerId) out.ownerId = ownerId;
  if (agentId) out.agentId = agentId;
  if (typeof row.lastSyncAt === "number") out.lastSyncAt = row.lastSyncAt;
  return out;
}
