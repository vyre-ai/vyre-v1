// "Still need these?" (lane r42-alive, living tasks). One calm card, never a notification: the tasks the Space cannot tell about, each with why it is asked, up to seven, Keep or Archive per row.
// A task lands here when a moment the Space only guessed passed (clock.ts). Keep stops the question for 90 days; Archive puts it away (code asked, by the person); a row nobody answers for a week archives
// itself (code quiet). Nothing is deleted and Put back undoes any of it.
import { clearMoment, findTask, isOpen, outFor, openIndex, raise, visibleTo, whoIs } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import { cannotArchive, putAway } from "./archive.ts";
import { mayLetGo } from "./state.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;
export const CARD_MAX = 7;
export const UNANSWERED_MS = 7 * DAY;
export const KEEP_MS = 90 * DAY;

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

/** A row nobody answered for a week archives itself, once, with that sentence. Returns how many. */
export function archiveUnanswered(ctx: TasksCtx): number {
  let n = 0;
  const rows = ctx.db.all(
    "SELECT task_id FROM tasks_ask WHERE kept_until IS NULL AND at <= ? ORDER BY at LIMIT 200",
    ctx.now() - UNANSWERED_MS,
  ) as { task_id: string }[];
  for (const r of rows) {
    const t = findTask(ctx.db, r.task_id);
    if (!t || !isOpen(t.state) || t.archived !== undefined || cannotArchive(ctx, t) !== null) {
      ctx.db.run("DELETE FROM tasks_ask WHERE task_id = ?", r.task_id); // closed or put away meanwhile: nothing to ask
      continue;
    }
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

/** Keep or Archive, for one row or several. A task that cannot be archived (something waits on it) is kept and counted as such. */
export async function stillAnswer(ctx: TasksCtx, input: In): Promise<unknown> {
  const server = isTrustedService(whoIs(ctx));
  let kept = 0,
    archived = 0;
  for (const id of [...new Set<string>(input.taskIds ?? [])].slice(0, 50)) {
    const t = findTask(ctx.db, id);
    if (!t) continue;
    if (!server && !visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
    if (!server && !mayLetGo(ctx, t))
      raise(ctx, "validation.precondition_failed", "Only someone on this task can answer for it.", {
        reason: "wrong_actor",
      });
    if (!isOpen(t.state) || t.archived !== undefined) continue;
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
