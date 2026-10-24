// Shared db helpers for the mail handlers. SQL stays inside mail_* tables (ARCH B2).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import { mintUuid } from "../../../lib/ids.ts";

export interface MailDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface MailCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
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

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/0001_mail_core.sql", import.meta.url)), "utf8");

export const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function newId(prefix: string, now: number): string {
  return `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
}

export function bad(ctx: MailCtx, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

export function missing(ctx: MailCtx, message: string): never {
  throw fail("validation.not_found", ctx.trace.traceId, { message });
}

export function allow(ctx: MailCtx, level: Level, resource: { type: string; id: string | null }): void {
  const decision = ctx.authorize({ perm: null, level }, resource);
  if (decision.effect === "allow") return;
  if (decision.reason.toLowerCase().includes("clearance")) throw fail("permission.above_clearance", ctx.trace.traceId);
  throw fail("permission.no_grant", ctx.trace.traceId);
}

export function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
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

export function ensure(ctx: MailCtx): void {
  if (ready.has(ctx.db)) return;
  for (const statement of statements(migrationSql)) ctx.db.run(statement);
  ready.add(ctx.db);
}

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  if (!row || typeof row !== "object") return null;
  return row as Row;
}

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

export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

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

export function snippetOf(text: string | undefined, subject: string): string {
  const raw = text && text.trim() ? text : subject;
  return raw.replace(/\s+/g, " ").slice(0, 160);
}

export function isId(prefix: string, value: string): boolean {
  return new RegExp(`^${prefix}_[a-z0-9]+$`).test(value);
}

export function logRead(ctx: MailCtx, mailboxId: string, action: string): void {
  ctx.db.run(
    `INSERT INTO mail_read_log (id, actor, "mailboxId", action, at) VALUES (?, ?, ?, ?, ?)`,
    newId("rdl", ctx.now()),
    ctx.principal.id,
    mailboxId,
    action,
    ctx.now(),
  );
}
