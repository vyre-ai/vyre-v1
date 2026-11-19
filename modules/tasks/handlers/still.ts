// "Still need these?" (lane r42-alive, living tasks). One calm card, never a notification: the tasks the Space cannot tell about, each with why it is asked, up to seven, Keep or Archive per row.
// A task lands here when a moment the Space only guessed passed (clock.ts). Keep stops the question for 90 days; Archive puts it away (code asked, by the person); a row nobody answers for a week archives
// itself (code quiet). Nothing is deleted and Put back undoes any of it.
import {
  NOT_ARCHIVED,
  allTasks,
  clearMoment,
  findTask,
  isOpen,
  outFor,
  openIndex,
  readPolicy,
  tzOf,
  visibleTo,
  whoIs,
} from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import { cannotArchive, putAway } from "./archive.ts";
import { mayLetGo } from "./state.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;

/** The words a person reads for a moment: "Thu 5 Nov", on the clock of whoever holds the task. */
export function momentWords(at: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })
      .format(at)
      .replace(",", "");
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** Not on the card and not kept: rows the clock still has to ask about (one ? is the time now). */
export const NOT_ASKED =
  "AND NOT EXISTS (SELECT 1 FROM tasks_ask k WHERE k.task_id = c.id AND (k.kept_until IS NULL OR k.kept_until > ?))";
export const CARD_MAX = 7;
export const UNANSWERED_MS = 7 * DAY;
export const KEEP_MS = 90 * DAY;

/** What nobody has touched for two weeks goes on the card, once: the Space cannot tell if it still matters, and the person is asked (never told) instead of finding it on top of Needs you forever. Returns how many were added. */
export function askUntouched(ctx: TasksCtx): number {
  const policy = readPolicy(ctx.db);
  if (!policy.tidy) return 0;
  const now = ctx.now();
  let n = 0;
  for (const t of allTasks(
    ctx.db,
    `c.state NOT IN ('done', 'canceled') AND ${NOT_ARCHIVED} AND c.updated_at <= ? ${NOT_ASKED} ORDER BY c.updated_at`,
    now - policy.askAfterDays * DAY,
    now,
  ).slice(0, 200)) {
    if (t.snoozedUntil !== undefined && t.snoozedUntil > now) continue;
    if (t.due !== undefined && t.due > now) continue; // something is still coming
    if (t.relevantUntil !== undefined && t.momentStated !== false) continue; // its stated moment decides
    if (cannotArchive(ctx, t) !== null) continue; // a held act, a Run or other work waits on it
    const holder = t.assigned.kind === "person" ? tzOf(ctx.db, t.assigned.id) : "UTC";
    const why =
      t.due !== undefined
        ? `Due ${momentWords(t.due, holder)}, nothing since.`
        : `Nothing has happened for ${policy.askAfterDays} days.`;
    if (putOnCard(ctx, t, why)) n += 1;
  }
  return n;
}

/** Put a task on the card, once: a task already asked, or kept and not yet due to be asked again, is left alone. */
export function putOnCard(ctx: TasksCtx, t: Task, why: string): boolean {
  const row = ctx.db.all("SELECT kept_until FROM tasks_ask WHERE task_id = ?", t.id)[0] as
    | { kept_until?: number | null }
    | undefined;
  if (row && (row.kept_until == null || row.kept_until > ctx.now())) return false;
  ctx.db.run(
    "INSERT OR REPLACE INTO tasks_ask (task_id, at, why, kept_until) VALUES (?, ?, ?, NULL)",
    t.id,
    ctx.now(),
    why,
  );
  return true;
}

/**
 * A row nobody answered archives itself, once, but only a week after someone who may answer it first had it in front of them (seen_at, stamped when the card is shown), so a person who was away, or a task whose
 * holder nobody could ask, is never put away unseen. Overdue work (a due date that has passed) is owed: it stays on the card and is never put away for silence. Returns how many.
 */
export function archiveUnanswered(ctx: TasksCtx): number {
  if (!readPolicy(ctx.db).tidy) return 0;
  const now = ctx.now();
  let n = 0;
  const rows = ctx.db.all(
    "SELECT task_id FROM tasks_ask WHERE kept_until IS NULL AND seen_at IS NOT NULL AND seen_at <= ? ORDER BY seen_at LIMIT 200",
    now - UNANSWERED_MS,
  ) as { task_id: string }[];
  for (const r of rows) {
    const t = findTask(ctx.db, r.task_id);
    if (!t || !isOpen(t.state) || t.archived !== undefined) {
      ctx.db.run("DELETE FROM tasks_ask WHERE task_id = ?", r.task_id); // closed or put away meanwhile: nothing to ask
      continue;
    }
    if (t.due !== undefined && t.due <= now) continue; // owed work: stays on the card until a person answers
    if (cannotArchive(ctx, t) !== null) continue; // something waits on it: it stays, asked
    putAway(ctx, t, { code: "quiet", why: "Nobody said it still matters, so it was put away." });
    ctx.db.run("DELETE FROM tasks_ask WHERE task_id = ?", r.task_id);
    n += 1;
  }
  return n;
}

/** The card: what is asked of the reader, oldest ask first, at most seven. */
export async function stillNeeded(ctx: TasksCtx, _input: In): Promise<unknown> {
  const idx = openIndex(ctx.db);
  const rows = ctx.db.all("SELECT task_id, at, why FROM tasks_ask WHERE kept_until IS NULL ORDER BY at, task_id") as {
    task_id: string;
    at: number;
    why: string;
  }[];
  const items: { task: Record<string, unknown>; why: string; askedAt: number }[] = [];
  let total = 0;
  for (const r of rows) {
    const t = findTask(ctx.db, r.task_id);
    if (!t || !isOpen(t.state) || t.archived !== undefined || !visibleTo(ctx, t) || !mayLetGo(ctx, t)) continue;
    total += 1;
    if (items.length < CARD_MAX) items.push({ task: outFor(ctx, t, idx), why: r.why, askedAt: r.at });
  }
  return { items, total };
}

/**
 * Answer the card: keep (not asked again for 90 days), archive, or seen (the card was in front of the person: stamps the first time, so the week of silence starts then). A task the caller cannot see or may not
 * answer for is skipped the same way as one that does not exist, so a list with one such id answers the rest and tells nothing about it.
 */
export async function stillAnswer(ctx: TasksCtx, input: In): Promise<unknown> {
  const server = isTrustedService(whoIs(ctx));
  let kept = 0,
    archived = 0;
  for (const id of [...new Set<string>(input.taskIds ?? [])].slice(0, 50)) {
    const t = findTask(ctx.db, id);
    if (!t || (!server && (!visibleTo(ctx, t) || !mayLetGo(ctx, t)))) continue;
    if (!isOpen(t.state) || t.archived !== undefined) continue;
    if (input.answer === "seen") {
      ctx.db.run("UPDATE tasks_ask SET seen_at = ? WHERE task_id = ? AND seen_at IS NULL", ctx.now(), t.id);
      continue;
    }
    if (input.answer === "archive" && cannotArchive(ctx, t) === null) {
      putAway(ctx, t, { code: "asked", why: "Said it is not needed." });
      ctx.db.run("DELETE FROM tasks_ask WHERE task_id = ?", t.id);
      archived += 1;
      continue;
    }
    // Keep: not asked again for 90 days, and a guessed moment that already passed is dropped so the clock does not ask again
    ctx.db.run("DELETE FROM tasks_ask WHERE task_id = ?", t.id);
    ctx.db.run(
      "INSERT INTO tasks_ask (task_id, at, why, kept_until) VALUES (?, ?, '', ?)",
      t.id,
      ctx.now(),
      ctx.now() + KEEP_MS,
    );
    if (t.momentStated === false) clearMoment(ctx.db, t);
    kept += 1;
  }
  return { kept, archived };
}
