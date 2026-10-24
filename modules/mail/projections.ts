// mail store helpers and projections (ARCH 4.5). The shared pieces of the mail handlers: the context subset they use, row readers,
// id and address helpers, the per-person read log and the one-time schema apply. mail keeps no inline projection of its own yet:
// unread counts belong to inbox.counts (L5_08), which reads the per-person read state, not this module's tables.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface MailDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the mail handlers use; the host Ctx satisfies it. */
export interface MailCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  run?: string;
  now(): number;
  db: MailDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(
    action: { perm: string | null; level: "view" | "use" | "edit" | "manage" },
    resource: { type: string; id: string | null },
  ): { effect: "allow" | "deny" | "hold"; reason: string; decisionId: string };
  vault: { use(handle: string): { handle: string } };
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Level = "view" | "use" | "edit" | "manage";
export type Row = Record<string, string | number | null>;

export interface Party {
  address: string;
  name?: string;
  contactId?: string;
}

export const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** `prefix_` plus 32 lowercase hex digits: the shape every id pattern in the manifests accepts (^prefix_[a-z0-9]+$). */
export function newId(prefix: string, now: number): string {
  return `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
}

export function isId(prefix: string, value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-z0-9]+$`).test(value);
}

export function bad(ctx: Pick<MailCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

export function missing(ctx: Pick<MailCtx, "trace">, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}

/** Ask the host to authorize `level` on a resource; used where the capability cannot bind the resource itself. */
export function allow(ctx: MailCtx, level: Level, resource: { type: string; id: string | null }): void {
  const decision = ctx.authorize({ perm: null, level }, resource);
  if (decision.effect === "allow") return;
  if (decision.reason.toLowerCase().includes("clearance")) throw fail("permission.above_clearance", ctx.trace.traceId);
  throw fail("permission.no_grant", ctx.trace.traceId);
}

export function can(ctx: MailCtx, level: Level, resource: { type: string; id: string | null }): boolean {
  return ctx.authorize({ perm: null, level }, resource).effect === "allow";
}

// ---- rows

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  if (!row || typeof row !== "object") return null;
  return row as Row;
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

// ---- addresses

export const normalizeEmail = (address: string): string => address.trim().toLowerCase();

export function partyJson(parties: readonly Party[]): string {
  return JSON.stringify(parties.map((party) => {
    const out: Party = { address: normalizeEmail(party.address) };
    if (party.name) out.name = party.name;
    if (party.contactId) out.contactId = party.contactId;
    return out;
  }));
}

export function readParties(value: unknown): Party[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Party[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.address !== "string") continue;
      const party: Party = { address: rec.address };
      if (typeof rec.name === "string" && rec.name) party.name = rec.name;
      if (typeof rec.contactId === "string" && rec.contactId) party.contactId = rec.contactId;
      out.push(party);
    }
    return out;
  } catch {
    return [];
  }
}

export function readStrings(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function snippetOf(text: string | undefined, subject: string): string {
  const raw = text && text.trim() ? text : subject;
  return raw.replace(/\s+/g, " ").trim().slice(0, 160);
}

// ---- read log (spec 2.18: every mailbox read writes a per-person log row)

export function logRead(ctx: MailCtx, mailboxId: string, actor: string, action: string): void {
  ctx.db.run(
    `INSERT INTO mail_read_log (id, actor, "mailboxId", action, at) VALUES (?, ?, ?, ?, ?)`,
    newId("rdl", ctx.now()), actor, mailboxId, action, ctx.now(),
  );
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_mail_core.sql", import.meta.url)), "utf8");

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
 * Make sure the mail tables exist. The probe is one cheap SELECT per call; only when it fails are the CREATE ... IF NOT EXISTS
 * statements applied, so a host that already ran the migration (or the generated schema) pays nothing more.
 */
export function ensure(ctx: Pick<MailCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "messageId" FROM mail_link WHERE "messageId" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export const inline = {};
export const consumers = {};
export const codecs = {};
