// Work the mail module owes: a provider route that must be deleted, and notes about routes it had to remove. Kept in a table so a failure is retried and shown, never swallowed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newId, num, rowsOf, statements, str, strOrNull } from "../projections.ts";
import type { MailCtx, Row } from "../projections.ts";

const sql = readFileSync(fileURLToPath(new URL("../migrations/0009_mail_cleanup.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();
const NOTE_DAYS = 14;
const MIN = 60_000;

export function ensureCleanup(ctx: Pick<MailCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT id FROM mail_cleanup WHERE id = ?`, "probe");
  } catch {
    for (const statement of statements(sql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export interface CleanupOut {
  id: string;
  kind: "provider_route" | "duplicate_route";
  note: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

function add(
  ctx: Pick<MailCtx, "db" | "now">,
  kind: CleanupOut["kind"],
  ref: string | null,
  note: string,
  done: boolean,
): string {
  ensureCleanup(ctx);
  const id = newId("cln", ctx.now());
  ctx.db.run(
    `INSERT INTO mail_cleanup (id, kind, ref, note, attempts, "lastError", "lastTryAt", "createdAt", "doneAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    kind,
    ref,
    note,
    0,
    null,
    null,
    ctx.now(),
    done ? ctx.now() : null,
  );
  return id;
}

/** A Mailgun route that must go. It is deleted by the background pass until it is. */
export const oweProviderRouteDelete = (
  ctx: Pick<MailCtx, "db" | "now">,
  providerRouteId: string,
  note: string,
): string => add(ctx, "provider_route", providerRouteId, note, false);
/** A line for the page: what was found and what was done. Shown for two weeks. */
export const noteRemovedDuplicate = (ctx: Pick<MailCtx, "db" | "now">, note: string): string =>
  add(ctx, "duplicate_route", null, note, true);

/** What the Email page shows: open deletions until they are gone, and recent notes. */
export function openCleanups(ctx: Pick<MailCtx, "db" | "now">): CleanupOut[] {
  ensureCleanup(ctx);
  const cutoff = ctx.now() - NOTE_DAYS * 24 * 60 * MIN;
  return rowsOf(ctx.db.all(`SELECT * FROM mail_cleanup`))
    .filter((r: Row) =>
      r.doneAt === null || r.doneAt === undefined
        ? true
        : str(r, "kind") === "duplicate_route" && num(r, "createdAt") >= cutoff,
    )
    .map((r: Row) => ({
      id: str(r, "id"),
      kind: str(r, "kind") === "duplicate_route" ? "duplicate_route" : "provider_route",
      note: str(r, "note"),
      attempts: num(r, "attempts"),
      ...(strOrNull(r, "lastError") ? { lastError: str(r, "lastError") } : {}),
      createdAt: num(r, "createdAt"),
    }));
}

const backoff = (attempts: number): number => Math.min(2 ** attempts, 360) * MIN;
const gone = (e: unknown): boolean => {
  const code = (e as { error?: { code?: unknown } } | null)?.error?.code;
  return code === "validation.not_found";
};

/** One try at every open provider-route deletion that is due (backing off 1, 2, 4 ... minutes up to 6 hours). Answers how many are still open. */
export async function retryCleanups(ctx: MailCtx): Promise<number> {
  ensureCleanup(ctx);
  let open = 0;
  for (const r of rowsOf(ctx.db.all(`SELECT * FROM mail_cleanup`))) {
    if (str(r, "kind") !== "provider_route" || (r.doneAt !== null && r.doneAt !== undefined)) continue;
    const attempts = num(r, "attempts");
    const last = typeof r.lastTryAt === "number" ? r.lastTryAt : 0;
    if (attempts > 0 && ctx.now() < last + backoff(attempts)) {
      open += 1;
      continue;
    }
    try {
      await ctx.call("mailgun.routes.delete", {
        idempotencyKey: `mail.cleanup:${str(r, "id")}:${attempts}`,
        routeId: str(r, "ref"),
      });
      ctx.db.run(
        `UPDATE mail_cleanup SET "doneAt" = ?, attempts = ?, "lastTryAt" = ?, "lastError" = ? WHERE id = ?`,
        ctx.now(),
        attempts + 1,
        ctx.now(),
        null,
        str(r, "id"),
      );
    } catch (e) {
      if (gone(e)) {
        ctx.db.run(
          `UPDATE mail_cleanup SET "doneAt" = ?, attempts = ?, "lastTryAt" = ? WHERE id = ?`,
          ctx.now(),
          attempts + 1,
          ctx.now(),
          str(r, "id"),
        );
        continue;
      }
      open += 1;
      const code = (e as { error?: { code?: unknown } } | null)?.error?.code;
      ctx.db.run(
        `UPDATE mail_cleanup SET attempts = ?, "lastTryAt" = ?, "lastError" = ? WHERE id = ?`,
        attempts + 1,
        ctx.now(),
        typeof code === "string" ? code : "failed",
        str(r, "id"),
      );
    }
  }
  return open;
}
