// mail.message.get / list / search / set_private and mail.attachment.save (spec 2.18: Views, Message status and deliverability).
// One message record sits in every inbox that received it (inboxIds); reading it needs view access on any one of them. Reading a person's own
// mailbox as someone else writes a per-person read log row (spec 2.18: reads are logged per person).
// Search is a word match over subject, snippet, addresses and body inside the caller's visible mail; the host's FTS index serves the sync window.
import { fail } from "../../../../host/src/routes/errors.ts";
import {
  bad, can, first, isId, logRead, missing, num, readStrings, rowsOf, str, strOrNull,
} from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import {
  ensureAll, idemRef, MESSAGE_COLUMNS, messageRow, newestFirst, pageOf, parsePage, preconditionFailed, rememberIdem,
} from "./common.ts";
import type { MessageRow, PageIn } from "./common.ts";

const STATUSES = new Set(["draft", "queued", "sent", "delivered", "bounced", "complained", "failed", "received"]);
const TRACE = /^[0-9a-f]{32}$/;

const emlId = (ctx: MailCtx, value: unknown): string => {
  if (!isId("eml", value)) bad(ctx, "Message id is not valid.");
  return value as string;
};

const inboxesOf = (row: Row): string[] => {
  const ids = readStrings(str(row, "inboxIds"));
  return ids.length ? ids : [str(row, "mailboxId")];
};

/** The inboxes of a message the caller may view, with the verdict cached for one request. */
class Viewer {
  private readonly verdicts = new Map<string, boolean>();
  private readonly touched = new Set<string>();
  private readonly ctx: MailCtx;
  constructor(ctx: MailCtx) {
    this.ctx = ctx;
  }

  may(mailboxId: string): boolean {
    let v = this.verdicts.get(mailboxId);
    if (v === undefined) {
      v = can(this.ctx, "view", { type: "mailbox", id: mailboxId });
      this.verdicts.set(mailboxId, v);
    }
    return v;
  }

  /** The first inbox of the message that lets the caller in, remembered as read when the message is returned. */
  door(row: Row): string | null {
    for (const id of inboxesOf(row)) if (this.may(id)) return id;
    return null;
  }

  read(mailboxId: string): void {
    this.touched.add(mailboxId);
  }

  /** One log row per mailbox read: only a personal mailbox read by someone other than its owner is a read of a person's mail. */
  flush(): void {
    for (const id of this.touched) {
      const box = first(this.ctx.db.all(`SELECT kind, "ownerId" FROM mail_mailbox WHERE id = ?`, id));
      const owner = strOrNull(box, "ownerId");
      if (!owner || str(box, "kind") !== "personal" || owner === this.ctx.principal.id) continue;
      logRead(this.ctx, id, owner, `read:${this.ctx.principal.id}`);
    }
  }
}

function loadMessage(ctx: MailCtx, id: string): Row {
  const row = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, id));
  if (!row) missing(ctx, "Message does not exist.");
  return row;
}

function refuse(ctx: MailCtx, row: Row): never {
  for (const id of inboxesOf(row)) {
    const d = ctx.authorize({ perm: null, level: "view" }, { type: "mailbox", id });
    if (d.effect !== "allow" && d.reason.toLowerCase().includes("clearance")) throw fail("permission.above_clearance", ctx.trace.traceId);
  }
  throw fail("permission.no_grant", ctx.trace.traceId);
}

// ---- attachments (stored on the message row as JSON; an ingested one carries a blobId, a draft's one a fileId)

export interface AttachmentRow { attachmentId: string; name: string; mime: string; size: number; fileId?: string; blobId?: string }

export function readAttachments(value: unknown): AttachmentRow[] {
  if (typeof value !== "string" || value.length === 0) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: AttachmentRow[] = [];
  parsed.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const row: AttachmentRow = {
      attachmentId: typeof o.attachmentId === "string" && o.attachmentId ? o.attachmentId : `att_${i + 1}`,
      name: typeof o.name === "string" ? o.name : "",
      mime: typeof o.mime === "string" ? o.mime : "application/octet-stream",
      size: typeof o.size === "number" && Number.isFinite(o.size) ? Math.max(0, Math.trunc(o.size)) : 0,
    };
    if (typeof o.fileId === "string" && o.fileId) row.fileId = o.fileId;
    if (typeof o.blobId === "string" && o.blobId) row.blobId = o.blobId;
    out.push(row);
  });
  return out;
}

const codeOf = (e: unknown): string => {
  const shaped = e as { error?: { code?: unknown } } | null;
  return typeof shaped?.error?.code === "string" ? shaped.error.code : "";
};

/** A draft's attachment is only a Files id; the name, type and size come from Files. A file that cannot be read keeps a plain placeholder. */
async function describeFiles(ctx: MailCtx, list: AttachmentRow[]): Promise<AttachmentRow[]> {
  const out: AttachmentRow[] = [];
  for (const a of list) {
    if (a.name || !a.fileId) { out.push(a); continue; }
    try {
      const got = (await ctx.call("files.get", { fileId: a.fileId })) as { file?: { name?: unknown; mime?: unknown; size?: unknown } } | null;
      const f = got?.file;
      out.push({
        ...a,
        name: typeof f?.name === "string" && f.name ? f.name : "Attachment",
        mime: typeof f?.mime === "string" && f.mime ? f.mime : a.mime,
        size: typeof f?.size === "number" ? f.size : a.size,
      });
    } catch {
      out.push({ ...a, name: "Attachment" });
    }
  }
  return out;
}

// ---- mail.message.get

export interface MessageDetail {
  message: MessageRow;
  text?: string;
  html?: string;
  attachments: { attachmentId: string; name: string; mime: string; size: number; fileId?: string }[];
  provider: { providerId?: string; dns?: { spf: "pass" | "fail" | "pending"; dkim: "pass" | "fail" | "pending"; dmarc: "pass" | "fail" | "pending" }; traceId: string };
}

const dnsState = (v: string): "pass" | "fail" | "pending" => (v === "pass" || v === "fail" ? v : "pending");

export async function messageGet(ctx: MailCtx, input: { messageId: string }): Promise<MessageDetail> {
  ensureAll(ctx);
  const id = emlId(ctx, input.messageId);
  const row = loadMessage(ctx, id);
  const viewer = new Viewer(ctx);
  const door = viewer.door(row);
  if (!door) refuse(ctx, row);
  viewer.read(door);
  viewer.flush();

  const body = first(ctx.db.all(`SELECT text, html FROM mail_body WHERE "messageId" = ?`, id));
  const out: MessageDetail = {
    message: messageRow(ctx, row),
    attachments: (await describeFiles(ctx, readAttachments(str(row, "attachments")))).map((a) => {
      const item: MessageDetail["attachments"][number] = { attachmentId: a.attachmentId, name: a.name, mime: a.mime, size: a.size };
      if (a.fileId) item.fileId = a.fileId;
      return item;
    }),
    provider: { traceId: TRACE.test(str(row, "traceId")) ? str(row, "traceId") : ctx.trace.traceId },
  };
  const text = strOrNull(body, "text");
  const html = strOrNull(body, "html");
  if (text !== null) out.text = text;
  else if (html === null && str(row, "body")) out.text = str(row, "body");
  if (html !== null) out.html = html;
  const providerId = strOrNull(row, "providerId");
  if (providerId) out.provider.providerId = providerId;
  // DNS state is shown for mail that left through a Space sending domain.
  if (str(row, "direction") === "out") {
    const from = str(row, "fromAddress");
    const domain = first(ctx.db.all(`SELECT spf, dkim, dmarc FROM mail_domain WHERE name = ? AND deleted_at IS NULL`, from.slice(from.lastIndexOf("@") + 1)));
    if (domain) out.provider.dns = { spf: dnsState(str(domain, "spf")), dkim: dnsState(str(domain, "dkim")), dmarc: dnsState(str(domain, "dmarc")) };
  }
  return out;
}

// ---- mail.message.list / search

interface MessageList { messages: MessageRow[]; next?: string; total: number }

function finish(ctx: MailCtx, viewer: Viewer, rows: Row[], offset: number, limit: number): MessageList {
  const page = pageOf(rows, offset, limit);
  for (const r of page.items) viewer.read(viewer.door(r) ?? str(r, "mailboxId"));
  viewer.flush();
  const out: MessageList = { messages: page.items.map((r) => messageRow(ctx, r)), total: page.total };
  if (page.next) out.next = page.next;
  return out;
}

function candidates(ctx: MailCtx, mailboxId: string | undefined, extra: Record<string, string>): Row[] {
  const where = [`deleted_at IS NULL`];
  const args: unknown[] = [];
  for (const [col, value] of Object.entries(extra)) { where.push(`"${col}" = ?`); args.push(value); }
  if (mailboxId) { where.push(`"inboxIds" LIKE ?`); args.push(`%"${mailboxId}"%`); }
  const rows = rowsOf(ctx.db.all(`SELECT ${MESSAGE_COLUMNS} FROM mail_message WHERE ${where.join(" AND ")}`, ...args));
  // The LIKE only narrows; the exact test is on the parsed list.
  return mailboxId ? rows.filter((r) => inboxesOf(r).includes(mailboxId)) : rows;
}

export async function messageList(
  ctx: MailCtx,
  input: PageIn & { mailboxId?: string; threadId?: string; contactId?: string; status?: string },
): Promise<MessageList> {
  ensureAll(ctx);
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (input.threadId !== undefined && (typeof input.threadId !== "string" || input.threadId.length === 0)) bad(ctx, "Thread id is not valid.");
  if (input.status !== undefined && !STATUSES.has(input.status)) bad(ctx, "Status is not valid.");
  const { offset, limit } = parsePage(ctx, input);
  const extra: Record<string, string> = {};
  if (input.threadId) extra.threadId = input.threadId;
  if (input.contactId) extra.contactId = input.contactId;
  if (input.status) extra.status = input.status;
  const viewer = new Viewer(ctx);
  // Drafts have their own list (mail.drafts.list); they show here only when asked for by status.
  const rows = candidates(ctx, input.mailboxId, extra).filter((r) => (input.status === "draft" || str(r, "status") !== "draft") && viewer.door(r) !== null);
  return finish(ctx, viewer, newestFirst(rows), offset, limit);
}

export async function messageSearch(
  ctx: MailCtx,
  input: PageIn & { q: string; mailboxId?: string; from?: number; to?: number },
): Promise<MessageList> {
  ensureAll(ctx);
  if (typeof input.q !== "string" || input.q.trim().length === 0) bad(ctx, "Search text is required.");
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  for (const t of [input.from, input.to]) if (t !== undefined && !Number.isSafeInteger(t)) bad(ctx, "Dates must be timestamps.");
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) bad(ctx, "The start date is after the end date.");
  const { offset, limit } = parsePage(ctx, input);
  const words = input.q.toLowerCase().split(/\s+/).filter(Boolean);
  const viewer = new Viewer(ctx);
  const where = [`deleted_at IS NULL`];
  const args: unknown[] = [];
  if (input.mailboxId) { where.push(`"inboxIds" LIKE ?`); args.push(`%"${input.mailboxId}"%`); }
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_message WHERE ${where.join(" AND ")}`, ...args)).filter((r) => {
    if (str(r, "status") === "draft") return false;
    if (input.mailboxId && !inboxesOf(r).includes(input.mailboxId)) return false;
    const at = num(r, "sentAt");
    if (input.from !== undefined && at < input.from) return false;
    if (input.to !== undefined && at > input.to) return false;
    if (viewer.door(r) === null) return false;
    const hay = [str(r, "subject"), str(r, "snippet"), str(r, "fromAddress"), str(r, "toAddresses"), str(r, "ccAddresses"), str(r, "body")].join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return finish(ctx, viewer, newestFirst(rows), offset, limit);
}

// ---- mail.message.set_private

/** Only the owner of one of the inboxes the message sits in (or someone who manages it) may mark or clear the private flag. */
function mayMark(ctx: MailCtx, row: Row): boolean {
  for (const id of inboxesOf(row)) {
    const box = first(ctx.db.all(`SELECT "ownerId" FROM mail_mailbox WHERE id = ?`, id));
    if (strOrNull(box, "ownerId") === ctx.principal.id && ctx.principal.kind === "person") return true;
    if (can(ctx, "manage", { type: "mailbox", id })) return true;
  }
  return false;
}

export async function messageSetPrivate(ctx: MailCtx, input: { messageId: string; isPrivate: boolean }): Promise<{ message: MessageRow }> {
  ensureAll(ctx);
  const id = emlId(ctx, input.messageId);
  if (typeof input.isPrivate !== "boolean") bad(ctx, "The private flag must be true or false.");
  const row = loadMessage(ctx, id);
  if (!mayMark(ctx, row)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only the owner of the inbox can mark a message private." });
  if ((num(row, "isPrivate") === 1) !== input.isPrivate) {
    ctx.db.run(`UPDATE mail_message SET "isPrivate" = ?, version = ?, updated_at = ? WHERE id = ?`, input.isPrivate ? 1 : 0, num(row, "version") + 1, ctx.now(), id);
  }
  return { message: messageRow(ctx, loadMessage(ctx, id)) };
}

// ---- mail.attachment.save

const FOLDER_NAME = "Mail attachments";

async function resolveFolder(ctx: MailCtx, path: string): Promise<string | null> {
  try {
    const out = (await ctx.call("files.resolve", { path })) as { folderId?: unknown } | null;
    return typeof out?.folderId === "string" ? out.folderId : null;
  } catch (e) {
    if (codeOf(e) === "validation.not_found") return null;
    throw e;
  }
}

/** Where a save lands when the caller names no folder: a folder called Mail attachments in their Personal files, made on first use. */
async function defaultFolder(ctx: MailCtx): Promise<string> {
  const found = await resolveFolder(ctx, `Personal/${FOLDER_NAME}`);
  if (found) return found;
  const root = await resolveFolder(ctx, "Personal");
  if (!root) preconditionFailed(ctx, "Your Personal files folder is not available.");
  try {
    const made = (await ctx.call("files.folder.create", { idempotencyKey: `mail-saved:${ctx.trace.traceId}`, parentId: root, name: FOLDER_NAME })) as { folder?: { folderId?: unknown } } | null;
    if (typeof made?.folder?.folderId === "string") return made.folder.folderId;
  } catch (e) {
    if (codeOf(e) !== "validation.duplicate") throw e;   // made a moment ago by another save: look it up again
  }
  const again = await resolveFolder(ctx, `Personal/${FOLDER_NAME}`);
  if (!again) preconditionFailed(ctx, "The Mail attachments folder could not be created.");
  return again;
}

const cleanName = (name: string): string => name.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "attachment";

/** "report.pdf" becomes "report (2).pdf" when the folder already has one. */
function numbered(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

export async function attachmentSave(
  ctx: MailCtx,
  input: { messageId: string; attachmentId: string; folderId?: string; idempotencyKey: string },
): Promise<{ fileId: string }> {
  ensureAll(ctx);
  const priorFile = idemRef(ctx, input.idempotencyKey, "attsave");
  if (priorFile) return { fileId: priorFile };
  const id = emlId(ctx, input.messageId);
  if (typeof input.attachmentId !== "string" || input.attachmentId.length === 0) bad(ctx, "Attachment id is required.");
  if (input.folderId !== undefined && !isId("fld", input.folderId)) bad(ctx, "Folder id is not valid.");
  const row = loadMessage(ctx, id);
  if (new Viewer(ctx).door(row) === null) refuse(ctx, row);

  const list = readAttachments(str(row, "attachments"));
  const at = list.findIndex((a) => a.attachmentId === input.attachmentId);
  const found = at >= 0 ? list[at] : undefined;
  if (!found) missing(ctx, "The message has no such attachment.");

  // Already a Files file (a draft's attachment) or already saved to the default place: answer with it, so a second click adds no copy.
  if (found.fileId && (!found.blobId || input.folderId === undefined)) {
    rememberIdem(ctx, input.idempotencyKey, "attsave", found.fileId);
    return { fileId: found.fileId };
  }
  if (!found.blobId) preconditionFailed(ctx, "This attachment has no content to save.");

  const folderId = input.folderId ?? (await defaultFolder(ctx));
  const base = cleanName(found.name);
  let fileId = "";
  for (let n = 1; n <= 20 && !fileId; n++) {
    try {
      const made = (await ctx.call("files.create", { idempotencyKey: `mail-save:${ctx.trace.traceId}:${n}`, folderId, name: numbered(base, n), mime: found.mime, content: { blobId: found.blobId } })) as { file?: { fileId?: unknown } } | null;
      if (typeof made?.file?.fileId === "string") fileId = made.file.fileId;
      else throw fail("provider.bad_response", ctx.trace.traceId, { message: "Files did not return the saved file." });
    } catch (e) {
      if (codeOf(e) !== "validation.duplicate" || n === 20) throw e;
    }
  }

  // Keep the stable id and the saved file on the message so the next read shows it.
  const next = list.map((a, i) => (i === at ? { ...a, fileId } : a));
  ctx.db.run(
    `UPDATE mail_message SET attachments = ?, version = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(next), num(row, "version") + 1, ctx.now(), id,
  );
  rememberIdem(ctx, input.idempotencyKey, "attsave", fileId);
  return { fileId };
}
