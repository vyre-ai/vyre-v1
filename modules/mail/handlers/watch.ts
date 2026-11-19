// Two failures in a row, not one (owner, 19 Nov 2026): a sending domain stays verified through one failed check, test or sign-in, and stops being verified on the second in a row.
// A pass clears the count. A mail server that was moved is a new place and is not given the benefit: that un-verifies at once (smtp.ts). The count and its reason are shown on the Email page.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { first, num, rowsOf, statements, str, strOrNull } from "../projections.ts";
import type { MailCtx, Row } from "../projections.ts";

export const STRIKES_TO_STOP = 2;
const sql = readFileSync(fileURLToPath(new URL("../migrations/0008_mail_domain_watch.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();

export function ensureWatch(ctx: Pick<MailCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "domainId" FROM mail_domain_watch WHERE "domainId" = ?`, "probe");
  } catch {
    for (const statement of statements(sql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export interface Watch {
  domainId: string;
  failures: number;
  why?: string;
  checkedAt?: number;
}

export function watchOf(ctx: MailCtx, domainId: string): Watch {
  ensureWatch(ctx);
  const row = first(ctx.db.all(`SELECT * FROM mail_domain_watch WHERE "domainId" = ?`, domainId));
  if (!row) return { domainId, failures: 0 };
  const why = strOrNull(row, "why");
  return { domainId, failures: num(row, "strikes"), ...(why ? { why } : {}), checkedAt: num(row, "checkedAt") };
}

export function allWatches(ctx: MailCtx): Watch[] {
  ensureWatch(ctx);
  return rowsOf(ctx.db.all(`SELECT * FROM mail_domain_watch`))
    .filter((r: Row) => num(r, "strikes") > 0)
    .map((r: Row) => ({
      domainId: str(r, "domainId"),
      failures: num(r, "strikes"),
      ...(strOrNull(r, "why") ? { why: str(r, "why") } : {}),
      checkedAt: num(r, "checkedAt"),
    }));
}

/** One more failure. On the second in a row the domain stops being verified (and stops being the default sender). Answers the count. */
export function strike(ctx: MailCtx, domainId: string, why: string): number {
  ensureWatch(ctx);
  const failures = watchOf(ctx, domainId).failures + 1;
  const now = ctx.now();
  if (watchOf(ctx, domainId).failures > 0)
    ctx.db.run(
      `UPDATE mail_domain_watch SET strikes = ?, why = ?, "checkedAt" = ? WHERE "domainId" = ?`,
      failures,
      why.slice(0, 300),
      now,
      domainId,
    );
  else
    ctx.db.run(
      `INSERT INTO mail_domain_watch ("domainId", strikes, why, "checkedAt") VALUES (?, ?, ?, ?)`,
      domainId,
      failures,
      why.slice(0, 300),
      now,
    );
  if (failures >= STRIKES_TO_STOP)
    ctx.db.run(
      `UPDATE mail_domain SET verified = ?, "isDefault" = ?, updated_at = ? WHERE id = ?`,
      0,
      0,
      now,
      domainId,
    );
  return failures;
}

export function clearStrikes(ctx: MailCtx, domainId: string): void {
  ensureWatch(ctx);
  if (watchOf(ctx, domainId).failures > 0) ctx.db.run(`DELETE FROM mail_domain_watch WHERE "domainId" = ?`, domainId);
}

/** Every verified domain that sends through the Space's own mail server takes the failure. */
export function strikeSmtpDomains(ctx: MailCtx, why: string): void {
  for (const d of rowsOf(
    ctx.db.all(`SELECT id FROM mail_domain WHERE provider = ? AND verified = ? AND deleted_at IS NULL`, "smtp", 1),
  ))
    strike(ctx, str(d, "id"), why);
}

export function clearSmtpStrikes(ctx: MailCtx): void {
  for (const d of rowsOf(ctx.db.all(`SELECT id FROM mail_domain WHERE provider = ? AND deleted_at IS NULL`, "smtp")))
    clearStrikes(ctx, str(d, "id"));
}
