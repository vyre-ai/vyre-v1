// inbox store helpers (spec 2.18 Matching, Views, Following; 3.3; ARCH 7.3): the context subset the handlers use, row readers, the normal form of an address, the
// one-time schema apply, and the conversation row every view returns. The module owns the conversation and follow entities and an index of the messages, texts and
// calls each conversation holds (inbox_item); the messages themselves stay in mail, telephony and meetings, and records are read and written through records.* only.
// Note: scripts/boundaries.ts reads any word `import` directly followed by a quote as an import statement; none is written here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HostError, fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface InboxDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the inbox handlers use; the host Ctx satisfies it. */
export interface InboxCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: InboxDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(
    action: { perm: string | null; level: "view" | "use" | "edit" | "manage" },
    resource: { type: string; id: string | null },
  ): { effect: "allow" | "deny" | "hold"; reason: string; decisionId: string };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;
export type Channel = "email" | "sms" | "call";
export type RecordType = "contact" | "company";

export const EMAIL = /^[^\s@]+@[^\s@]+$/;
export const PHONE = /^\+[1-9][0-9]{6,14}$/;

// ---- ids and errors

export function newId(prefix: string, now: number): string {
  return `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
}
export const isId = (prefix: string, v: unknown): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(v);

export function bad(ctx: Pick<InboxCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}
export function missing(ctx: Pick<InboxCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}
export function refuse(ctx: Pick<InboxCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}
export const isNotFound = (e: unknown): boolean => e instanceof HostError && (e.error.code === "validation.not_found" || e.error.code === "permission.not_found");
export const codeOf = (e: unknown): string => (e instanceof HostError ? e.error.code : "");

// ---- readers

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export function str(row: Row | null, key: string): string {
  const v = row?.[key];
  return typeof v === "string" ? v : "";
}
export function num(row: Row | null, key: string): number {
  const v = row?.[key];
  return typeof v === "number" ? v : 0;
}
export function strOrNull(row: Row | null, key: string): string | null {
  const v = row?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");

/** A JSON array of strings kept in a text column. */
export function jsonList(v: unknown): string[] {
  if (typeof v !== "string" || v === "") return [];
  try {
    return strings(JSON.parse(v));
  } catch {
    return [];
  }
}
export const toJson = (v: string[]): string => JSON.stringify([...new Set(v)]);

// ---- addresses

/** An email in lower case, a phone number without the marks people type, anything else (a handle) in lower case without a leading @. */
export function normAddress(value: string): string {
  const v = value.trim();
  if (EMAIL.test(v)) return v.toLowerCase();
  const phone = v.replace(/[\s.\-()]/g, "");
  if (PHONE.test(phone)) return phone;
  return v.toLowerCase().replace(/^@+/, "");
}
export const kindOfAddress = (a: string): "email" | "phone" | "handle" => (EMAIL.test(a) ? "email" : PHONE.test(a) ? "phone" : "handle");

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_inbox.sql", import.meta.url)), "utf8");

export function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Make sure this module's tables exist: one cheap SELECT per call, the CREATE ... IF NOT EXISTS statements only when it fails. */
export function ensure(ctx: Pick<InboxCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "conversationId" FROM inbox_match_task WHERE "conversationId" = ?`, "probe");
    ctx.db.all(`SELECT "id" FROM inbox_item WHERE "id" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- the conversation row

export interface ConversationRow {
  id: string;
  contactId?: string;
  address: string;
  displayName: string;
  lastMessageAt: number;
  lastChannel: Channel;
  lastPreview: string;
  unreadCount: number;
  needsMatch: boolean;
  ownerId?: string;
  mailboxIds: string[];
  campaignId?: string;
  followed: boolean;
  alertOnReplies: boolean;
  organisation?: string;
  dnd?: boolean;
  bounced?: boolean;
  unmatched?: boolean;
  draftReady?: boolean;
}

export function getConversation(ctx: Pick<InboxCtx, "db">, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM inbox_conversation WHERE id = ? AND deleted_at IS NULL`, id));
}

/** The caller's own follow of a contact, if any. */
export function followOf(ctx: Pick<InboxCtx, "db" | "principal">, contactId: string | null): { followed: boolean; alertOnReplies: boolean } {
  if (!contactId) return { followed: false, alertOnReplies: false };
  const row = first(ctx.db.all(`SELECT * FROM inbox_follow WHERE "contactId" = ? AND "principalId" = ? AND deleted_at IS NULL`, contactId, ctx.principal.id));
  return row ? { followed: true, alertOnReplies: num(row, "alertOnReplies") === 1 } : { followed: false, alertOnReplies: false };
}

export function toConversation(ctx: Pick<InboxCtx, "db" | "principal">, row: Row): ConversationRow {
  const ch = str(row, "lastChannel");
  const out: ConversationRow = {
    id: str(row, "id"), address: str(row, "address"), displayName: str(row, "displayName") || str(row, "address"), lastMessageAt: num(row, "lastMessageAt"),
    lastChannel: ch === "sms" || ch === "call" ? ch : "email", lastPreview: str(row, "lastPreview"), unreadCount: Math.max(0, Math.trunc(num(row, "unreadCount"))),
    needsMatch: num(row, "needsMatch") === 1, mailboxIds: jsonList(row.mailboxIds), followed: false, alertOnReplies: false,
  };
  const contactId = strOrNull(row, "contactId");
  if (contactId) out.contactId = contactId;
  const ownerId = strOrNull(row, "ownerId");
  if (ownerId) out.ownerId = ownerId;
  const campaignId = strOrNull(row, "campaignId");
  if (campaignId) out.campaignId = campaignId;
  const f = followOf(ctx, contactId);
  out.followed = f.followed;
  out.alertOnReplies = f.alertOnReplies;
  return out;
}

/** Bump the version of an entity row the way the sync layer expects a module write to. */
export const nextVersion = (row: Row | null): number => num(row, "version") + 1;

// ---- records, through the records module

export interface RecordLite {
  id: string;
  type: RecordType;
  fields: Json;
}

export const nameOf = (r: RecordLite): string => text(r.fields.name) || text(r.fields.title) || r.id;

export async function getRecord(ctx: InboxCtx, type: RecordType, recordId: string): Promise<RecordLite | null> {
  try {
    const rec = obj(obj(await ctx.call("records.get", { type, recordId })).record);
    return typeof rec.id === "string" ? { id: rec.id, type, fields: obj(rec.fields) } : null;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** A contact, else a company, with this id. */
export async function findRecord(ctx: InboxCtx, recordId: string): Promise<RecordLite | null> {
  return (await getRecord(ctx, "contact", recordId)) ?? (await getRecord(ctx, "company", recordId));
}
