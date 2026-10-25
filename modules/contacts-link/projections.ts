// contacts-link store helpers (spec 2.18, 2.19; ARCH 8.2): the context subset the handlers use, row readers, the normal form of an email, a phone
// number and a handle, the one-time schema apply, and the reads and writes of contact and company records. The records are stored by the records
// module, so every read and write of one goes through records.get, records.query and records.update; this module owns only the address index,
// the suppression list and the dismissed duplicate suggestions.
// Note for this module: scripts/boundaries.ts reads any `import` directly followed by a quote as an import statement, so the suppression reason
// `import` and the capability name contacts.suppression.import are written as template literals here, never as quoted strings.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HostError, fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface ContactsDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the contacts-link handlers use; the host Ctx satisfies it. */
export interface ContactsCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: ContactsDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type RecordType = "contact" | "company";
export type Channel = "email" | "sms" | "call";

export const EMAIL = /^[^\s@]+@[^\s@]+$/;
export const PHONE = /^\+[1-9][0-9]{6,14}$/;

// ---- ids and errors

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts (^prefix_[a-z0-9]+$). */
export function newId(prefix: string, now: number): string {
  return `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
}

export function isId(prefix: string, value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(value);
}

export function bad(ctx: Pick<ContactsCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

export function missing(ctx: Pick<ContactsCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}

export function refuse(ctx: Pick<ContactsCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}

/** True for the two ways a read of a record says it is not there for this caller. */
export function isNotFound(e: unknown): boolean {
  return e instanceof HostError && (e.error.code === "validation.not_found" || e.error.code === "permission.not_found");
}

// ---- rows

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

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---- the normal form of an address (spec 2.18: one contact record holds every email, phone and handle)

export const normEmail = (v: string): string => v.trim().toLowerCase();

/** E.164 from what people type: spaces, dots, hyphens and brackets are dropped. Returns "" when the rest is not a number with a country code. */
export function normPhone(v: string): string {
  const s = v.trim().replace(/[\s.\-()]/g, "");
  return PHONE.test(s) ? s : "";
}

export const normHandle = (v: string): string => v.trim().toLowerCase().replace(/^@+/, "");

export function normalize(kind: "email" | "phone" | "handle", value: string): string {
  if (kind === "email") return EMAIL.test(normEmail(value)) ? normEmail(value) : "";
  if (kind === "phone") return normPhone(value);
  return normHandle(value);
}

/** The address of a suppression row: an email for the email channel, an E.164 number for text and calls. Empty when it is neither. */
export function normChannel(channel: Channel, value: string): string {
  return channel === "email" ? normalize("email", value) : normPhone(value);
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_contacts_link.sql", import.meta.url)), "utf8");

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

/**
 * Make sure this module's tables exist. One cheap SELECT per call; only when it fails are the CREATE ... IF NOT EXISTS statements applied,
 * so a host that already ran the migration (or the generated schema) pays nothing more.
 */
export function ensure(ctx: Pick<ContactsCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "suggestionId" FROM contacts_dismissed WHERE "suggestionId" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- records (contact and company), through the records module

export interface RecordLite {
  id: string;
  type: RecordType;
  fields: Record<string, unknown>;
}

const toLite = (type: RecordType, raw: unknown): RecordLite | null => {
  const r = obj(raw);
  return typeof r.id === "string" ? { id: r.id, type, fields: obj(r.fields) } : null;
};

/** One record of a known type, or null when it is not there (or not visible to the caller). */
export async function getRecord(ctx: ContactsCtx, type: RecordType, recordId: string): Promise<RecordLite | null> {
  try {
    return toLite(type, obj(await ctx.call("records.get", { type, recordId })).record);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** A contact, else a company, with this id. */
export async function findRecord(ctx: ContactsCtx, recordId: string): Promise<RecordLite | null> {
  return (await getRecord(ctx, "contact", recordId)) ?? (await getRecord(ctx, "company", recordId));
}

export type Filter = { and: Filter[] } | { or: Filter[] } | { not: Filter } | { field: string; op: "eq" | "ne" | "in" | "contains" | "is_null"; value?: unknown };

const PAGE = 500;

/** Up to `max` rows of a record type that pass a filter, paged through records.query. */
export async function queryRecords(ctx: ContactsCtx, type: RecordType, filter: Filter | undefined, max = 2000): Promise<RecordLite[]> {
  const out: RecordLite[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const input: Record<string, unknown> = { type, limit: Math.min(PAGE, max - out.length) };
    if (filter) input.filter = filter;
    if (cursor) input.cursor = cursor;
    const page = obj(await ctx.call("records.query", input));
    for (const raw of list(page.rows)) {
      const lite = toLite(type, raw);
      if (lite) out.push(lite);
    }
    cursor = typeof page.next === "string" && page.next ? page.next : undefined;
    if (!cursor) break;
  }
  return out;
}

export const nameOf = (r: RecordLite): string => text(r.fields.name);

// ---- who holds an address

/** What `holders` answers: normal-form address to the ids of the records that hold it. */
export type Holders = Map<string, Set<string>>;

const add = (m: Holders, key: string, id: string): void => {
  const set = m.get(key) ?? new Set<string>();
  set.add(id);
  m.set(key, set);
};

const BATCH = 50;

/**
 * The records that hold each address, from the address index and from the primary email and phone fields of the records themselves.
 * Emails and phones are given in any form and answered in normal form. A match here is exact: it is what makes a message "sure".
 */
export async function holders(ctx: ContactsCtx, q: { emails?: string[]; phones?: string[]; handles?: string[] }): Promise<Holders> {
  const found: Holders = new Map();
  const emails = [...new Set((q.emails ?? []).map(normEmail).filter((e) => EMAIL.test(e)))];
  const phones = [...new Set((q.phones ?? []).map(normPhone).filter(Boolean))];
  const handles = [...new Set((q.handles ?? []).map(normHandle).filter(Boolean))];
  for (const [kind, values] of [["email", emails], ["phone", phones], ["handle", handles]] as const) {
    for (const value of values) {
      for (const r of rowsOf(ctx.db.all(`SELECT "contactId" FROM contacts_link_address WHERE kind = ? AND normalized = ? AND deleted_at IS NULL`, kind, value))) {
        add(found, `${kind}:${value}`, str(r, "contactId"));
      }
    }
  }
  for (let i = 0; i < emails.length; i += BATCH) {
    const chunk = emails.slice(i, i + BATCH);
    const rows = await queryRecords(ctx, "contact", { or: chunk.map((value) => ({ field: "email", op: "contains" as const, value })) }, 1000);
    for (const rec of rows) {
      const own = normEmail(text(rec.fields.email));
      if (chunk.includes(own)) add(found, `email:${own}`, rec.id);   // contains is a substring match; only the exact address counts
    }
  }
  for (let i = 0; i < phones.length; i += BATCH) {
    const chunk = phones.slice(i, i + BATCH);
    for (const type of ["contact", "company"] as const) {
      for (const rec of await queryRecords(ctx, type, { field: "phone", op: "in", value: chunk }, 1000)) {
        const own = normPhone(text(rec.fields.phone));
        if (chunk.includes(own)) add(found, `phone:${own}`, rec.id);
      }
    }
  }
  return found;
}

/** Same as `holders` for one address; the ids it answers. */
export async function holdersOf(ctx: ContactsCtx, kind: "email" | "phone" | "handle", value: string): Promise<string[]> {
  const q = kind === "email" ? { emails: [value] } : kind === "phone" ? { phones: [value] } : { handles: [value] };
  const key = `${kind}:${normalize(kind, value)}`;
  return [...((await holders(ctx, q)).get(key) ?? [])];
}
