// Two failures in a row, not one (owner, 19 Nov 2026): a sending domain stays verified through one failed check, test or sign-in, and stops being verified on the second in a row.
// A pass clears the count. A mail server that was moved is a new place and is not given the benefit: that un-verifies at once (smtp.ts). The count and its reason are shown on the Email page.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { first, num, rowsOf, statements, str, strOrNull } from "../projections.ts";
import type { MailCtx, Row } from "../projections.ts";

export const STRIKES_TO_STOP = 2;
/** Failures from sends and tests count at most once an hour, so a burst of retries is one failure, not two. The daily check counts once a day by itself. */
export const SAME_FAILURE_MS = 60 * 60_000;
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
  /** the domain was the default sender when it was stopped: it is made the default again when it passes, if nobody else took the place */
  wasDefault?: boolean;
}

export function watchOf(ctx: MailCtx, domainId: string): Watch {
  ensureWatch(ctx);
  const row = first(ctx.db.all(`SELECT * FROM mail_domain_watch WHERE "domainId" = ?`, domainId));
  if (!row) return { domainId, failures: 0 };
  const why = strOrNull(row, "why");
  return {
    domainId,
    failures: num(row, "strikes"),
    ...(why ? { why } : {}),
    checkedAt: num(row, "checkedAt"),
    wasDefault: num(row, "wasDefault") === 1,
  };
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

/**
 * One more failure. On the second in a row the domain stops being verified (and stops being the default sender). Answers the count.
 * `minGapMs`: a failure that comes close behind the last one is the same bad moment and is not counted again.
 */
export function strike(ctx: MailCtx, domainId: string, why: string, opts: { minGapMs?: number; wasDefault?: boolean } = {}): number {
  ensureWatch(ctx);
  const before = watchOf(ctx, domainId);
  const now = ctx.now();
  if (
    opts.minGapMs !== undefined &&
    before.failures > 0 &&
    before.checkedAt !== undefined &&
    now - before.checkedAt < opts.minGapMs
  )
    return before.failures;
  const failures = before.failures + 1;
  const dom = first(ctx.db.all(`SELECT "isDefault" FROM mail_domain WHERE id = ?`, domainId));
  // the caller may know better than the row: the check that failed already cleared the default flag
  const wasDefault = before.wasDefault === true || opts.wasDefault === true || (dom !== null && num(dom, "isDefault") === 1) ? 1 : 0;
  if (before.failures > 0)
    ctx.db.run(
      `UPDATE mail_domain_watch SET strikes = ?, why = ?, "checkedAt" = ?, "wasDefault" = ? WHERE "domainId" = ?`,
      failures,
      why.slice(0, 300),
      now,
      wasDefault,
      domainId,
    );
  else
    ctx.db.run(
      `INSERT INTO mail_domain_watch ("domainId", strikes, why, "checkedAt", "wasDefault") VALUES (?, ?, ?, ?, ?)`,
      domainId,
      failures,
      why.slice(0, 300),
      now,
      wasDefault,
    );
  if (failures >= STRIKES_TO_STOP)
    ctx.db.run(`UPDATE mail_domain SET verified = ?, "isDefault" = ?, updated_at = ? WHERE id = ?`, 0, 0, now, domainId);
  return failures;
}

/** A pass. Answers what the domain had been: stopped (and the default sender), so the caller can bring it back. */
export function clearStrikes(ctx: MailCtx, domainId: string): { wasStopped: boolean; wasDefault: boolean } {
  ensureWatch(ctx);
  const w = watchOf(ctx, domainId);
  if (w.failures > 0) ctx.db.run(`DELETE FROM mail_domain_watch WHERE "domainId" = ?`, domainId);
  return { wasStopped: w.failures >= STRIKES_TO_STOP, wasDefault: w.wasDefault === true };
}

/** Every verified domain that sends through the Space's own mail server takes the failure (at most once an hour). */
export function strikeSmtpDomains(ctx: MailCtx, why: string): void {
  for (const d of rowsOf(
    ctx.db.all(
      `SELECT id FROM mail_domain WHERE provider = ? AND verified = ? AND deleted_at IS NULL`,
      "smtp",
      1,
    ),
  ))
    strike(ctx, str(d, "id"), why, { minGapMs: SAME_FAILURE_MS });
}

export function clearSmtpStrikes(ctx: MailCtx): void {
  for (const d of rowsOf(
    ctx.db.all(`SELECT id FROM mail_domain WHERE provider = ? AND deleted_at IS NULL`, "smtp"),
  ))
    clearStrikes(ctx, str(d, "id"));
}
