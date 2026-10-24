// mail.ingest, mail.connect, mail.sync_now (spec 2.18, 3.3; ARCH 7.3, 8).
// ingest lands one message: dedupe on the provider id, one record for the same RFC message across inboxes, then the shared
// linking step (`inbox.link_message`) matches the address: a sure match links, an unsure one raises Needs you. Mail from a
// private or paused mailbox is stored but never linked, so it stays in the mailbox view.
// connect creates the caller's own mailbox (Pending until the first sync); an IMAP connection proves LOGIN and NOOP first.
// sync_now pulls an IMAP mailbox (UID watermark, peek only, then IDLE for a bounded window); Google and Microsoft mailboxes
// are pulled by their connectors, which this handler asks and which call mail.ingest for each message.
import { fail } from "../../../host/src/routes/errors.ts";
import {
  bad, ensure, EMAIL, first, isId, logRead, missing, newId, normalizeEmail, num, partyJson, snippetOf, str, strOrNull,
} from "../projections.ts";
import type { MailCtx, Party, Row } from "../projections.ts";

const SOURCES = new Set(["google", "microsoft", "imap", "resend", "mailgun"]);
const PULL_SOURCES = new Set(["google", "microsoft", "imap"]);
const PROVIDERS = new Set(["google", "microsoft", "imap"]);
const PRIVACY = new Set(["private", "space", "people"]);
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
/** How long one sync_now waits in IMAP IDLE after the catch-up fetch; the scheduler starts the next run. */
export const IDLE_WINDOW_MS = 25_000;

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

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordHandle: string;
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

// ---- IMAP session seam. The method names follow imapflow. CI never opens a socket: tests bind a recorded session
// (fixtures/replay.ts) and the host binds the live imapflow one (impl.ts).

/** One folder watermark per folder name, plus the UIDVALIDITY the watermarks belong to. */
export interface ImapCursor {
  uidValidity: number;
  uids: Record<string, number>;
}

export interface ImapMessage {
  folder: string;
  uid: number;
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

export interface ImapSession {
  /** Sign in and report the folder epoch. Throws when the server refuses the sign-in. */
  connect(): Promise<{ uidValidity: number }>;
  noop(): Promise<void>;
  /** Messages with a UID above each folder watermark. Reads with PEEK: the person's unread mail stays unread. */
  fetchAfter(uids: Record<string, number>): Promise<ImapMessage[]>;
  /** Wait for new mail up to `ms`; `onExists` runs for every wake-up and may fetch. */
  idle(onExists: () => Promise<void>, ms: number): Promise<void>;
  logout(): Promise<void>;
}

export type ImapSessionFactory = (cfg: ImapConfig, ctx: MailCtx) => ImapSession;

const bound = new WeakMap<object, ImapSessionFactory>();
let defaultFactory: ImapSessionFactory | null = null;

/** Bind a session factory to one context (tests bind the recorded replay). */
export function bindImapSession(ctx: MailCtx, factory: ImapSessionFactory): void {
  bound.set(ctx, factory);
}

/** The host binds the live imapflow factory once at boot (impl.ts). */
export function setDefaultImapSession(factory: ImapSessionFactory | null): void {
  defaultFactory = factory;
}

function openImapSession(ctx: MailCtx, cfg: ImapConfig): ImapSession {
  const factory = bound.get(ctx) ?? defaultFactory;
  if (!factory) throw fail("internal.unavailable", ctx.trace.traceId, { message: "IMAP is not set up on this server." });
  return factory(cfg, ctx);
}

// ---- mail.ingest

interface Parsed {
  source: IngestIn["source"];
  mailboxId?: string;
  envelopeTo?: string;
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

export async function ingest(ctx: MailCtx, input: IngestIn): Promise<IngestOut> {
  ensure(ctx);
  const parsed = parseIngest(ctx, input);
  const box = resolveMailbox(ctx, parsed);
  const mailboxId = str(box, "id");

  const known = knownMessage(ctx, parsed);
  if (known) {
    // A copy in another inbox: one record, one more inbox. A copy from a mailbox that may file can still settle the link.
    ctx.db.run(
      `INSERT OR IGNORE INTO mail_seen (source, "providerId", "messageId") VALUES (?, ?, ?)`,
      parsed.source, parsed.providerId, known,
    );
    addInbox(ctx, known, mailboxId);
    noteOwnerRead(ctx, box, parsed);
    const link = await settleLink(ctx, known, parsed, box);
    return result(known, true, link);
  }

  const messageId = newId("eml", ctx.now());
  const reply = replyContext(ctx, parsed);
  insertMessage(ctx, messageId, parsed, box, reply);
  ctx.db.run(`INSERT INTO mail_seen (source, "providerId", "messageId") VALUES (?, ?, ?)`, parsed.source, parsed.providerId, messageId);
  ctx.db.run(`INSERT INTO mail_rfc ("rfcMessageId", "messageId") VALUES (?, ?)`, parsed.rfc, messageId);
  noteOwnerRead(ctx, box, parsed);
  const link = await settleLink(ctx, messageId, parsed, box, reply.campaignId);
  if (parsed.direction === "in") {
    const payload: { messageId: string; mailboxId: string; from: string; subject: string; contactId?: string; campaignId?: string } = {
      messageId, mailboxId, from: parsed.from.address, subject: parsed.subject,
    };
    if (link?.contactId) payload.contactId = link.contactId;
    if (reply.campaignId) payload.campaignId = reply.campaignId;
    // Mail kept in the mailbox view is announced to the mailbox owner only.
    if (filingBlocked(box)) ctx.emit("mail.received", `mailbox/${mailboxId}`, payload, { vis: "owner" });
    else ctx.emit("mail.received", `mailbox/${mailboxId}`, payload);
  }
  return result(messageId, false, link);
}

function parseIngest(ctx: MailCtx, input: IngestIn): Parsed {
  if (!SOURCES.has(input.source)) bad(ctx, "Source is not supported.");
  if (typeof input.providerId !== "string" || input.providerId.trim().length === 0) bad(ctx, "Provider id is required.");
  if (typeof input.rfcMessageId !== "string" || input.rfcMessageId.trim().length === 0) bad(ctx, "Message id is required.");
  if (typeof input.subject !== "string") bad(ctx, "Subject is required.");
  if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) bad(ctx, "Received time is not valid.");
  if (!input.from || !EMAIL.test(normalizeEmail(input.from.address ?? ""))) bad(ctx, "From address is not an email.");
  if (!Array.isArray(input.to)) bad(ctx, "To is required.");
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (input.mailboxId === undefined && !input.envelopeTo) bad(ctx, "A mailbox id or an envelope address is required.");
  if (input.envelopeTo !== undefined && !EMAIL.test(normalizeEmail(input.envelopeTo))) bad(ctx, "Envelope address is not an email.");
  const direction = input.direction ?? "in";
  if (direction !== "in" && direction !== "out") bad(ctx, "Direction is not valid.");
  const parsed: Parsed = {
    source: input.source,
    providerId: input.providerId.trim(),
    rfc: normalizeRfc(input.rfcMessageId),
    direction,
    from: cleanParty(ctx, input.from),
    to: input.to.map((p) => cleanParty(ctx, p)),
    cc: (input.cc ?? []).map((p) => cleanParty(ctx, p)),
    subject: input.subject,
    receivedAt: input.receivedAt,
    attachments: input.attachments ?? [],
  };
  if (input.mailboxId) parsed.mailboxId = input.mailboxId;
  if (input.envelopeTo) parsed.envelopeTo = normalizeEmail(input.envelopeTo);
  if (input.threadKey && input.threadKey.trim()) parsed.threadKey = input.threadKey.trim();
  if (input.text !== undefined) parsed.text = input.text;
  if (input.html !== undefined) parsed.html = input.html;
  if (input.headers) parsed.headers = lowerKeys(input.headers);
  return parsed;
}

function cleanParty(ctx: MailCtx, party: Party): Party {
  const address = normalizeEmail(party?.address ?? "");
  if (!EMAIL.test(address)) bad(ctx, "Address is not an email.");
  if (party.contactId !== undefined && !isId("rec", party.contactId)) bad(ctx, "Contact id is not valid.");
  const out: Party = { address };
  if (party.name) out.name = party.name;
  if (party.contactId) out.contactId = party.contactId;
  return out;
}

const normalizeRfc = (id: string): string => id.trim().toLowerCase();

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/** The mailbox a message belongs to: the id the connector gave, else the mailbox that owns the envelope address, else an inbound route. */
function resolveMailbox(ctx: MailCtx, p: Parsed): Row {
  if (p.mailboxId) {
    const box = loadMailbox(ctx, p.mailboxId);
    if (!box) missing(ctx, "Mailbox does not exist.");
    return box;
  }
  const to = p.envelopeTo ?? "";
  const byAddress = first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE address = ? AND deleted_at IS NULL`, to));
  if (byAddress) return byAddress;
  const at = to.lastIndexOf("@");
  const domain = first(ctx.db.all(`SELECT id FROM mail_domain WHERE name = ? AND deleted_at IS NULL`, to.slice(at + 1)));
  const route = domain
    ? first(ctx.db.all(`SELECT "mailboxId" FROM mail_route WHERE "domainId" = ? AND "localPart" = ? AND deleted_at IS NULL`, str(domain, "id"), to.slice(0, at)))
    : null;
  const routed = route ? loadMailbox(ctx, str(route, "mailboxId")) : null;
  if (!routed) missing(ctx, "No mailbox takes that address.");
  return routed;
}

function knownMessage(ctx: MailCtx, p: Parsed): string | null {
  const seen = first(ctx.db.all(`SELECT "messageId" FROM mail_seen WHERE source = ? AND "providerId" = ?`, p.source, p.providerId));
  if (seen) return str(seen, "messageId");
  const byRfc = first(ctx.db.all(`SELECT "messageId" FROM mail_rfc WHERE "rfcMessageId" = ?`, p.rfc));
  return byRfc ? str(byRfc, "messageId") : null;
}

interface ReplyContext {
  threadId?: string;
  campaignId?: string;
}

/** A reply keeps the thread and the campaign of the message it answers (In-Reply-To, then the last References entry). */
function replyContext(ctx: MailCtx, p: Parsed): ReplyContext {
  const out: ReplyContext = {};
  const refs = (p.headers?.references ?? "").split(/\s+/).filter(Boolean);
  const candidates = [p.headers?.["in-reply-to"], refs[refs.length - 1]].filter((v): v is string => !!v).map(normalizeRfc);
  for (const rfc of candidates) {
    const parent = first(ctx.db.all(`SELECT "threadId", "campaignId" FROM mail_message WHERE "rfcMessageId" = ? AND deleted_at IS NULL`, rfc));
    if (!parent) continue;
    const thread = strOrNull(parent, "threadId");
    const campaign = strOrNull(parent, "campaignId");
    if (thread) out.threadId = thread;
    if (campaign) out.campaignId = campaign;
    break;
  }
  return out;
}

function insertMessage(ctx: MailCtx, messageId: string, p: Parsed, box: Row, reply: ReplyContext): void {
  const mailboxId = str(box, "id");
  ctx.db.run(
    `INSERT INTO mail_message (
      id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
      "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
      "isPrivate", "campaignId", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    messageId, mailboxId, JSON.stringify([mailboxId]), p.providerId, p.rfc,
    p.threadKey ?? reply.threadId ?? p.rfc,
    p.direction, p.direction === "out" ? "sent" : "received",
    p.from.address, partyJson(p.to), partyJson(p.cc), p.subject, snippetOf(p.text, p.subject), p.text ?? p.html ?? "", p.receivedAt,
    null,
    str(box, "privacy") === "private" ? 1 : 0,   // mail in a private mailbox is private-marked: it never leaves the mailbox view
    reply.campaignId ?? null, JSON.stringify(p.attachments), null, ctx.trace.traceId, 1, ctx.now(), null,
  );
  ctx.db.run(
    `INSERT INTO mail_body ("messageId", text, html, "fromName", bcc, headers) VALUES (?, ?, ?, ?, ?, ?)`,
    messageId, p.text ?? null, p.html ?? null, p.from.name ?? null, null, p.headers ? JSON.stringify(p.headers) : null,
  );
}

function addInbox(ctx: MailCtx, messageId: string, mailboxId: string): void {
  const row = first(ctx.db.all(`SELECT "inboxIds" FROM mail_message WHERE id = ?`, messageId));
  if (!row) return;
  const ids = jsonStrings(str(row, "inboxIds"));
  if (ids.includes(mailboxId)) return;
  ids.push(mailboxId);
  ctx.db.run(`UPDATE mail_message SET "inboxIds" = ?, updated_at = ? WHERE id = ?`, JSON.stringify(ids), ctx.now(), messageId);
}

/** A pull from a person's own mailbox is a read of that person's mail: one log row, keyed by the owner. */
function noteOwnerRead(ctx: MailCtx, box: Row, p: Parsed): void {
  const owner = strOrNull(box, "ownerId");
  if (owner && PULL_SOURCES.has(p.source)) logRead(ctx, str(box, "id"), owner, "ingest");
}

interface Link {
  linked: "sure" | "unsure" | "none";
  contactId?: string;
  conversationId?: string;
  taskId?: string;
}

/** Run the linking step once per message, only for mailboxes that may file. Returns what the message is linked to so far. */
async function settleLink(ctx: MailCtx, messageId: string, p: Parsed, box: Row, campaignId?: string): Promise<Link | null> {
  const stored = readLink(ctx, messageId);
  if (stored) return stored;
  if (filingBlocked(box)) return null;
  let answer: Link;
  try {
    const counterparty = p.direction === "out" ? (p.to[0]?.address ?? p.from.address) : p.from.address;
    const input: Record<string, unknown> = {
      channel: "email",
      ref: { kind: "mail_message", id: messageId },
      address: counterparty,
      direction: p.direction,
      at: p.receivedAt,
      mailboxId: str(box, "id"),
      preview: snippetOf(p.text, p.subject),
    };
    if (campaignId) input.campaignId = campaignId;
    answer = parseLink(await ctx.call("inbox.link_message", input));
  } catch (e) {
    // The message is stored either way. With no link row the next copy (or a re-sync) tries again.
    ctx.log.warn("mail.ingest link failed", { messageId, error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
  ctx.db.run(
    `INSERT INTO mail_link ("messageId", linked, "contactId", "conversationId", "taskId") VALUES (?, ?, ?, ?, ?)`,
    messageId, answer.linked, answer.contactId ?? null, answer.conversationId ?? null, answer.taskId ?? null,
  );
  if (answer.contactId) {
    ctx.db.run(`UPDATE mail_message SET "contactId" = ?, updated_at = ? WHERE id = ?`, answer.contactId, ctx.now(), messageId);
  }
  return answer;
}

function parseLink(v: unknown): Link {
  if (!v || typeof v !== "object") throw new Error("inbox.link_message answered nothing");
  const o = v as Record<string, unknown>;
  const linked = o.linked;
  if (linked !== "sure" && linked !== "unsure" && linked !== "none") throw new Error("inbox.link_message answered an unknown link state");
  const out: Link = { linked };
  if (typeof o.contactId === "string") out.contactId = o.contactId;
  if (typeof o.conversationId === "string") out.conversationId = o.conversationId;
  if (typeof o.taskId === "string") out.taskId = o.taskId;
  return out;
}

function readLink(ctx: MailCtx, messageId: string): Link | null {
  const row = first(ctx.db.all(`SELECT linked, "contactId", "conversationId", "taskId" FROM mail_link WHERE "messageId" = ?`, messageId));
  if (!row) return null;
  const raw = str(row, "linked");
  const out: Link = { linked: raw === "sure" || raw === "unsure" ? raw : "none" };
  const contactId = strOrNull(row, "contactId");
  const conversationId = strOrNull(row, "conversationId");
  const taskId = strOrNull(row, "taskId");
  if (contactId) out.contactId = contactId;
  if (conversationId) out.conversationId = conversationId;
  if (taskId) out.taskId = taskId;
  return out;
}

function result(messageId: string, deduped: boolean, link: Link | null): IngestOut {
  const out: IngestOut = { messageId, deduped, linked: link?.linked ?? "none" };
  if (link?.contactId) out.contactId = link.contactId;
  if (link?.conversationId) out.conversationId = link.conversationId;
  if (link?.taskId) out.taskId = link.taskId;
  return out;
}

function jsonStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function loadMailbox(ctx: MailCtx, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, id));
}

/** Private and paused mailboxes keep their mail in the mailbox view. */
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

// ---- mail.connect

export async function connect(ctx: MailCtx, input: ConnectIn): Promise<{ mailbox: MailboxOut }> {
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
    if (row) return { mailbox: mailboxOut(row) };
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
  ctx.db.run(
    `INSERT INTO mail_mailbox (
      id, kind, address, title, "ownerId", "agentId", provider, privacy, state, "connectionId", "lastSyncAt", paused, version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, agentId ? "agent" : "personal", address, address.split("@")[0] || address, ownerId, agentId, input.provider, privacy,
    "pending", null, null, 0, 1, now, null,
  );
  if (imap) {
    ctx.db.run(
      `INSERT INTO mail_imap ("mailboxId", host, port, secure, username, "passwordHandle", "uidValidity", cursor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, imap.host, imap.port, imap.secure ? 1 : 0, imap.username, imap.passwordHandle, null, null,
    );
    if (ownerId) logRead(ctx, id, ownerId, "login");
  }
  ctx.db.run(`INSERT INTO mail_idem ("idemKey", kind, "refId") VALUES (?, ?, ?)`, input.idempotencyKey, "connect", id);
  const payload: { mailboxId: string; provider: string; auto: boolean; memberId?: string } = { mailboxId: id, provider: input.provider, auto: false };
  if (ownerId && isId("usr", ownerId)) payload.memberId = ownerId;
  ctx.emit("mailbox.connected", `mailbox/${id}`, payload, { vis: "participants" });
  const row = loadMailbox(ctx, id);
  if (!row) bad(ctx, "Mailbox does not exist.");
  return { mailbox: mailboxOut(row) };
}

function duplicateMailbox(ctx: MailCtx, address: string, provider: string, ownerId: string | null, agentId: string | null): boolean {
  const rows = ctx.db.all(`SELECT "ownerId", "agentId" FROM mail_mailbox WHERE address = ? AND provider = ? AND deleted_at IS NULL`, address, provider);
  return rows.some((item) => {
    const row = item as Row;
    return strOrNull(row, "ownerId") === ownerId && strOrNull(row, "agentId") === agentId;
  });
}

function idemRef(ctx: MailCtx, key: string, kind: string): string | null {
  return strOrNull(first(ctx.db.all(`SELECT "refId" FROM mail_idem WHERE "idemKey" = ? AND kind = ?`, key, kind)), "refId");
}

function requireImap(ctx: MailCtx, imap: ImapConfig | undefined): ImapConfig {
  if (!imap) bad(ctx, "IMAP needs a host, port, username and password handle.");
  if (typeof imap.host !== "string" || imap.host.trim().length === 0 || /\s/.test(imap.host)) bad(ctx, "IMAP host is not valid.");
  if (!Number.isSafeInteger(imap.port) || imap.port < 1 || imap.port > 65535) bad(ctx, "IMAP port is not valid.");
  if (typeof imap.secure !== "boolean") bad(ctx, "IMAP secure flag is not valid.");
  if (typeof imap.username !== "string" || imap.username.length === 0) bad(ctx, "IMAP username is required.");
  if (!HANDLE.test(imap.passwordHandle ?? "")) bad(ctx, "Password handle is not valid.");
  return { host: imap.host.trim().toLowerCase(), port: imap.port, secure: imap.secure, username: imap.username, passwordHandle: imap.passwordHandle };
}

const SIGN_IN_FAILED = "The mailbox did not accept the sign-in.";

/** LOGIN and NOOP only: a probe never fetches, sends or changes anything. */
async function probeImap(ctx: MailCtx, imap: ImapConfig): Promise<void> {
  const refuse = (): never => { throw fail("provider.auth_failed", ctx.trace.traceId, { message: SIGN_IN_FAILED }); };
  try {
    ctx.vault.use(imap.passwordHandle);
  } catch {
    return refuse();
  }
  let session: ImapSession;
  try {
    session = openImapSession(ctx, imap);
  } catch (e) {
    if (e instanceof Error && e.name === "HostError") throw e;
    return refuse();
  }
  try {
    await session.connect();
    await session.noop();
  } catch {
    return refuse();
  } finally {
    await session.logout().catch(() => undefined);
  }
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

// ---- mail.sync_now

export async function syncNow(ctx: MailCtx, input: { mailboxId: string }): Promise<{ runId: string }> {
  ensure(ctx);
  if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const box = loadMailbox(ctx, input.mailboxId);
  if (!box) missing(ctx, "Mailbox does not exist.");
  const runId = ctx.run && isId("run", ctx.run) ? ctx.run : newId("run", ctx.now());
  const subject = `mailbox/${input.mailboxId}`;
  if (syncBlocked(box)) {
    ctx.emit("mailbox.sync_failed", subject, { mailboxId: input.mailboxId, reason: "The mailbox is paused. Resume it to sync." }, { vis: "participants" });
    return { runId };
  }
  const provider = str(box, "provider");
  try {
    if (provider === "imap") {
      const pulled = await pullImap(ctx, input.mailboxId);
      ctx.db.run(`UPDATE mail_mailbox SET state = ?, "lastSyncAt" = ?, updated_at = ? WHERE id = ?`, "syncing", ctx.now(), ctx.now(), input.mailboxId);
      ctx.emit("mailbox.sync_completed", subject, { mailboxId: input.mailboxId, received: pulled.received, sent: pulled.sent }, { vis: "participants" });
    } else if (provider === "google" || provider === "microsoft") {
      await askConnector(ctx, provider, str(box, "address"), runId);
    }
    // inbound_only mailboxes have nothing to pull: their mail arrives through inbound routes.
  } catch (e) {
    ctx.db.run(`UPDATE mail_mailbox SET state = ?, updated_at = ? WHERE id = ?`, "error", ctx.now(), input.mailboxId);
    ctx.log.warn("mail.sync failed", { mailboxId: input.mailboxId, error: e instanceof Error ? e.name : "unknown" });
    ctx.emit("mailbox.sync_failed", subject, { mailboxId: input.mailboxId, reason: failureReason(e) }, { vis: "participants" });
  }
  return { runId };
}

/** The connectors own the pull for Google and Microsoft; a manual sync is a synthetic change notice they dedupe by run id. */
async function askConnector(ctx: MailCtx, provider: "google" | "microsoft", address: string, runId: string): Promise<void> {
  if (provider === "google") {
    await ctx.call("google.receive_push", { kind: "gmail", messageId: `sync_${runId}`, mailbox: address });
    return;
  }
  await ctx.call("ms.receive_notification", {
    notificationId: `sync_${runId}`, subscriptionId: "manual", resource: `users/${address}/messages`, changeType: "updated", clientStateOk: true,
  });
}

function failureReason(e: unknown): string {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown; error?: { code?: unknown } }) : {};
  const c = String(code.error?.code ?? code.code ?? "");
  if (c === "provider.auth_failed" || /auth|login|sign-?in/i.test(e instanceof Error ? e.message : "")) {
    return "The mailbox did not accept the sign-in. Reconnect it.";
  }
  return "The mailbox could not be reached. It will be tried again.";
}

interface Pulled { received: number; sent: number }

async function pullImap(ctx: MailCtx, mailboxId: string): Promise<Pulled> {
  const row = first(ctx.db.all(
    `SELECT host, port, secure, username, "passwordHandle", "uidValidity", cursor FROM mail_imap WHERE "mailboxId" = ?`, mailboxId,
  ));
  if (!row) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "This mailbox has no IMAP settings." });
  const cfg: ImapConfig = {
    host: str(row, "host"), port: num(row, "port"), secure: num(row, "secure") === 1, username: str(row, "username"), passwordHandle: str(row, "passwordHandle"),
  };
  const owner = strOrNull(loadMailbox(ctx, mailboxId), "ownerId");
  if (owner) logRead(ctx, mailboxId, owner, "sync");
  ctx.vault.use(cfg.passwordHandle);
  const session = openImapSession(ctx, cfg);
  const pulled: Pulled = { received: 0, sent: 0 };
  try {
    const { uidValidity } = await session.connect();
    await session.noop();
    let uids = readCursor(strOrNull(row, "cursor"));
    if (row.uidValidity !== null && row.uidValidity !== undefined && num(row, "uidValidity") !== uidValidity) uids = {};   // new epoch: UIDs mean nothing; dedupe absorbs the re-read
    const land = async (): Promise<void> => {
      const batch = await session.fetchAfter(uids);
      for (const m of batch) {
        const out = await ctx.call("mail.ingest", toIngest(mailboxId, m));
        const fresh = !(out && typeof out === "object" && (out as { deduped?: unknown }).deduped === true);
        if (fresh) { if (m.direction === "out") pulled.sent += 1; else pulled.received += 1; }
        uids = { ...uids, [m.folder]: Math.max(uids[m.folder] ?? 0, m.uid) };
      }
      ctx.db.run(`UPDATE mail_imap SET "uidValidity" = ?, cursor = ? WHERE "mailboxId" = ?`, uidValidity, JSON.stringify(uids), mailboxId);
    };
    await land();
    await session.idle(land, IDLE_WINDOW_MS);
  } finally {
    await session.logout().catch(() => undefined);
  }
  return pulled;
}

function readCursor(value: string | null): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function toIngest(mailboxId: string, m: ImapMessage): IngestIn {
  const input: IngestIn = {
    source: "imap", mailboxId, providerId: m.providerId, rfcMessageId: m.rfcMessageId, direction: m.direction ?? "in",
    from: m.from, to: m.to, subject: m.subject, receivedAt: m.receivedAt,
  };
  if (m.threadKey) input.threadKey = m.threadKey;
  if (m.cc) input.cc = m.cc;
  if (m.text !== undefined) input.text = m.text;
  if (m.html !== undefined) input.html = m.html;
  if (m.attachments) input.attachments = m.attachments;
  if (m.headers) input.headers = m.headers;
  return input;
}
