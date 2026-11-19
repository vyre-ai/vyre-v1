// Shared pieces of the mail handlers that P-L5_01c adds: the extra tables, paging, and the row shapes the manifest returns.
// The extra tables are this packet's own (CREATE IF NOT EXISTS, applied once per database next to the core mail schema).
// Known gap outside this packet's files: mail.route.set accepts localPart '*', but ingest.ts resolveMailbox looks up the exact local part only; the catch-all fallback belongs to the packet that owns ingest.ts.
import { fail } from "../../../../host/src/routes/errors.ts";
import {
  bad,
  ensure,
  first,
  num,
  readParties,
  readStrings,
  rowsOf,
  str,
  strOrNull,
  statements,
} from "../../projections.ts";
import { ensureCleanup, noteRemovedDuplicate, oweProviderRouteDelete } from "../cleanup.ts";
import type { MailCtx, Party, Row } from "../../projections.ts";

const EXTRA_SQL = `
-- The provider's own id for an inbound route (Mailgun route id). Resend routes need none: MX on the domain does the work.
CREATE TABLE IF NOT EXISTS mail_route_ext (
  "routeId" TEXT PRIMARY KEY,
  "providerRouteId" TEXT
);
-- Provider status events already applied, so a replayed webhook changes nothing and emits nothing twice.
CREATE TABLE IF NOT EXISTS mail_status_log (
  "eventKey" TEXT PRIMARY KEY,
  "messageId" TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  "appliedAt" INTEGER NOT NULL
);
`;

const ROUTE_UNIQUE = `CREATE UNIQUE INDEX IF NOT EXISTS mail_route__address ON mail_route ("domainId", "localPart") WHERE deleted_at IS NULL`;
/**
 * Two live routes for one address: keep the one mail.ingest already uses (it takes the first it finds, which is the first in the table's own order, so what arrives today keeps arriving where it did), remove the rest, and leave a visible note.
 * A Mailgun route is deleted only when it is a different one from the kept row's: if the duplicates share one, nothing is deleted, and if only a removed row had one, the kept row takes it over, so the address never loses its only route.
 * Every step is safe to run again, so a failure part way is finished by the next start.
 */
function dedupeRoutes(ctx: Pick<MailCtx, "db" | "now">): void {
  const live = rowsOf(ctx.db.all(`SELECT * FROM mail_route`)).filter(
    (r) => r.deleted_at === null || r.deleted_at === undefined,
  );
  const groups = new Map<string, Row[]>();
  for (const r of live) {
    const k = `${str(r, "domainId")}/${str(r, "localPart")}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const ext = (id: string): string => {
    const row = first(ctx.db.all(`SELECT "providerRouteId" FROM mail_route_ext WHERE "routeId" = ?`, id));
    return row ? str(row, "providerRouteId") : "";
  };
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const [keep, ...rest] = rows as [Row, ...Row[]];
    const domain = first(ctx.db.all(`SELECT name FROM mail_domain WHERE id = ?`, str(keep, "domainId")));
    const address = `${str(keep, "localPart")}@${domain ? str(domain, "name") : "a domain"}`;
    let keptRoute = ext(str(keep, "id"));
    for (const r of rest) {
      ctx.db.run(
        `UPDATE mail_route SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`,
        ctx.now(),
        num(r, "version") + 1,
        ctx.now(),
        str(r, "id"),
      );
      const theirs = ext(str(r, "id"));
      if (!theirs || theirs === keptRoute) continue; // nothing of its own, or the very route the kept row uses
      if (!keptRoute) {
        // the kept row had no provider route: it takes this one over, so mail for the address still arrives
        ctx.db.run(`INSERT INTO mail_route_ext ("routeId", "providerRouteId") VALUES (?, ?)`, str(keep, "id"), theirs);
        keptRoute = theirs;
        continue;
      }
      oweProviderRouteDelete(ctx, theirs, `${address}: the duplicate Mailgun route is being deleted.`);
    }
    noteRemovedDuplicate(
      ctx,
      `${address} had ${rows.length} routes. The one that was already receiving mail was kept and ${rest.length === 1 ? "the other was" : "the others were"} removed, so mail goes to one inbox only.`,
    );
  }
}

const ready = new WeakSet<object>();

/** Make sure the core mail tables and this packet's extra tables exist. One cheap probe per call after the first. */
export function ensureAll(ctx: Pick<MailCtx, "db" | "now" | "log">): void {
  ensure(ctx);
  ensureCleanup(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "routeId" FROM mail_route_ext WHERE "routeId" = ?`, "probe");
  } catch {
    for (const statement of statements(EXTRA_SQL)) ctx.db.run(statement);
  }
  // One live route per address. The database refuses a second, so two people adding the same name at once cannot both write it: the loser is told, and nothing is repointed.
  // An older database may already hold two: the oldest is kept, the others are removed, and a note says so (and a provider route left behind is queued for deletion), before the index is made.
  dedupeRoutes(ctx);
  try {
    ctx.db.run(ROUTE_UNIQUE);
  } catch (e) {
    ctx.log.warn("mail: the unique index on route addresses could not be made", {
      error: e instanceof Error ? e.message : String(e),
    });
    throw fail("internal.unexpected", "0000000000000000", {
      message:
        "The mail routes could not be made safe against duplicates. Nothing was changed; ask an admin to look at the log.",
    });
  }
  ready.add(ctx.db);
}

// ---- paging

export const DEFAULT_LIMIT = 50;

export interface PageIn {
  cursor?: string;
  limit?: number;
}

export function parsePage(ctx: MailCtx, input: PageIn): { offset: number; limit: number } {
  const limit = input.limit === undefined ? DEFAULT_LIMIT : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");
  return { offset, limit };
}

export function pageOf<T>(list: T[], offset: number, limit: number): { items: T[]; next?: string; total: number } {
  const items = list.slice(offset, offset + limit);
  const out: { items: T[]; next?: string; total: number } = { items, total: list.length };
  if (offset + limit < list.length) out.next = String(offset + limit);
  return out;
}

// ---- mailbox rows

export interface MailboxRow {
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

export function mailboxRow(row: Row): MailboxRow {
  const out: MailboxRow = {
    id: str(row, "id"),
    kind: str(row, "kind") as MailboxRow["kind"],
    address: str(row, "address"),
    title: str(row, "title"),
    provider: str(row, "provider") as MailboxRow["provider"],
    privacy: str(row, "privacy") as MailboxRow["privacy"],
    state: str(row, "state") as MailboxRow["state"],
  };
  const ownerId = strOrNull(row, "ownerId");
  const agentId = strOrNull(row, "agentId");
  if (ownerId) out.ownerId = ownerId;
  if (agentId) out.agentId = agentId;
  if (typeof row.lastSyncAt === "number") out.lastSyncAt = row.lastSyncAt;
  return out;
}

/** The mailbox if it exists and is not removed. */
export function liveMailbox(ctx: MailCtx, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, id));
}

export function duplicate(ctx: MailCtx, message: string): never {
  throw fail("validation.duplicate", ctx.trace.traceId, { message });
}

export function preconditionFailed(ctx: MailCtx, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}

// ---- idempotency (mail_idem is the core table; kinds here are this packet's)

export function idemRef(ctx: MailCtx, key: unknown, kind: string): string | null {
  if (typeof key !== "string" || key.length === 0) bad(ctx, "Idempotency key is required.");
  return strOrNull(
    first(ctx.db.all(`SELECT "refId" FROM mail_idem WHERE "idemKey" = ? AND kind = ?`, key, kind)),
    "refId",
  );
}

export function rememberIdem(ctx: MailCtx, key: string, kind: string, refId: string): void {
  ctx.db.run(`INSERT OR IGNORE INTO mail_idem ("idemKey", kind, "refId") VALUES (?, ?, ?)`, key, kind, refId);
}

// ---- message rows

export interface MessageRow {
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
  draftedByAgent?: string;
}

/** Every mail_message column except the body, which can be large and which the list shapes never return. */
export const MESSAGE_COLUMNS = [
  "id",
  "mailboxId",
  "inboxIds",
  "providerId",
  "rfcMessageId",
  "threadId",
  "direction",
  "status",
  "fromAddress",
  "toAddresses",
  "ccAddresses",
  "subject",
  "snippet",
  "sentAt",
  "contactId",
  "isPrivate",
  "attachments",
  "draftedByAgent",
  "traceId",
  "version",
  "updated_at",
]
  .map((c) => `"${c}"`)
  .join(", ");

export function messageRow(ctx: MailCtx, row: Row): MessageRow {
  const id = str(row, "id");
  const inboxIds = readStrings(str(row, "inboxIds"));
  const fromName = strOrNull(
    first(ctx.db.all(`SELECT "fromName" FROM mail_body WHERE "messageId" = ?`, id)),
    "fromName",
  );
  const from: Party = { address: str(row, "fromAddress") };
  if (fromName) from.name = fromName;
  const out: MessageRow = {
    id,
    mailboxId: str(row, "mailboxId"),
    inboxIds: inboxIds.length ? inboxIds : [str(row, "mailboxId")],
    threadId: str(row, "threadId"),
    direction: str(row, "direction") === "in" ? "in" : "out",
    status: str(row, "status"),
    from,
    to: readParties(str(row, "toAddresses")),
    cc: readParties(str(row, "ccAddresses")),
    subject: str(row, "subject"),
    snippet: str(row, "snippet"),
    sentAt: num(row, "sentAt"),
    isPrivate: num(row, "isPrivate") === 1,
  };
  const contactId = strOrNull(row, "contactId");
  const agent = strOrNull(row, "draftedByAgent");
  if (contactId) out.contactId = contactId;
  if (agent) out.draftedByAgent = agent;
  return out;
}

/** Newest first, ties broken by id so a page boundary never repeats or skips a row. */
export function newestFirst(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => num(b, "sentAt") - num(a, "sentAt") || (str(a, "id") < str(b, "id") ? -1 : 1));
}
