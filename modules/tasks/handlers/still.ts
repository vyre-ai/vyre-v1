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
  raise,
  readPolicy,
  tzOf,
  visibleTo,
  whoIs,
} from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";
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

/**
 * Visit the matching tasks a page at a time (a Space with 20,000 stale tasks takes about 100 passes, so about 100 minutes of the minute clock, to go all the way round), round and round: each pass reads the next `size` after where the last one stopped (tasks_cursor) and wraps at the end, so rows that are skipped every time (snoozed, due
 * later, waited on) never keep the rows behind them from being read, and no pass loads every stale task. `keyCol` is the sorted column and `keyOf` its value on the row.
 */
export function rotate(
  ctx: TasksCtx,
  name: string,
  where: string,
  args: unknown[],
  keyCol: string,
  keyOf: (t: Task) => number,
  visit: (t: Task) => void,
  size = 200,
): void {
  const row = ctx.db.all("SELECT value FROM tasks_cursor WHERE name = ?", name)[0] as { value?: string } | undefined;
  const [k, id] = (row?.value ?? "").split("|");
  const after = row?.value ? ` AND (${keyCol} > ? OR (${keyCol} = ? AND c.id > ?))` : "";
  const rows = allTasks(
    ctx.db,
    `${where}${after} ORDER BY ${keyCol}, c.id LIMIT ${size}`,
    ...args,
    ...(row?.value ? [Number(k), Number(k), id] : []),
  );
  for (const t of rows) visit(t);
  if (rows.length < size) ctx.db.run("DELETE FROM tasks_cursor WHERE name = ?", name);
  else {
    const last = rows[rows.length - 1]!;
    ctx.db.run("INSERT OR REPLACE INTO tasks_cursor (name, value) VALUES (?, ?)", name, `${keyOf(last)}|${last.id}`);
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
  rotate(
    ctx,
    "ask_untouched",
    `c.state NOT IN ('done', 'canceled') AND ${NOT_ARCHIVED} AND c.updated_at <= ? ${NOT_ASKED}`,
    [now - policy.askAfterDays * DAY, now],
    "c.updated_at",
    (t) => t.updatedAt,
    (t) => {
      if (t.snoozedUntil !== undefined && t.snoozedUntil > now) return;
      if (t.due !== undefined && t.due > now) return; // something is still coming
      if (t.relevantUntil !== undefined && t.momentStated !== false) return; // its stated moment decides
      if (cannotArchive(ctx, t) !== null) return; // a held act, a Run or other work waits on it
      const holder = t.assigned.kind === "person" ? tzOf(ctx.db, t.assigned.id) : "UTC";
      const why =
        t.due !== undefined
          ? `Due ${momentWords(t.due, holder)}, nothing since.`
          : `Nothing has happened for ${policy.askAfterDays} days.`;
      if (putOnCard(ctx, t, why)) n += 1;
    },
  );
  return n;
}

/** Put a task on the card, once: a task already asked, or kept and not yet due to be asked again, is left alone. */
export function putOnCard(
  ctx: TasksCtx,
  t: Task,
  why: string,
  look?: { quote: string; by: string; at: number },
): boolean {
  const row = ctx.db.all("SELECT kept_until FROM tasks_ask WHERE task_id = ?", t.id)[0] as
    | { kept_until?: number | null }
    | undefined;
  if (row && (row.kept_until == null || row.kept_until > ctx.now())) return false;
  ctx.db.run(
    "INSERT OR REPLACE INTO tasks_ask (task_id, at, why, kept_until, look, quote, quote_by, quote_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
    t.id,
    ctx.now(),
    why,
    look ? "done" : null,
    look?.quote ?? null,
    look?.by ?? null,
    look?.at ?? null,
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

/** Can the reader read this chat right now: it opens for them and they are one of its members. */
async function canRead(ctx: TasksCtx, threadId: string): Promise<boolean> {
  if (!ctx.call) return false;
  try {
    const r = (await ctx.call("threads.get", { threadId })) as { thread?: { members?: { id: string }[] } };
    const me = whoIs(ctx);
    return (r.thread?.members ?? []).some((m) => m.id === me.id || m.id === me.actingFor);
  } catch {
    return false;
  }
}

/** The card is a person's own: an agent or a service may not read it or answer it for them. */
function personOnly(ctx: TasksCtx): void {
  if (ctx.principal.kind !== "person")
    raise(ctx, "validation.precondition_failed", "The card is answered by the person it is for.", {
      reason: "wrong_actor",
    });
}

/** The card: what is asked of the reader, oldest ask first, at most seven. */
export async function stillNeeded(ctx: TasksCtx, _input: In): Promise<unknown> {
  personOnly(ctx);
  const idx = openIndex(ctx.db);
  const rows = ctx.db.all(
    "SELECT task_id, at, why, look, quote, quote_by, quote_at FROM tasks_ask WHERE kept_until IS NULL ORDER BY at, task_id",
  ) as {
    task_id: string;
    at: number;
    why: string;
    look: string | null;
    quote: string | null;
    quote_by: string | null;
    quote_at: number | null;
  }[];
  const items: {
    task: Record<string, unknown>;
    why: string;
    askedAt: number;
    lookDone?: { threadId: string; quote?: string; by?: string; at?: number };
  }[] = [];
  let total = 0;
  for (const r of rows) {
    const t = findTask(ctx.db, r.task_id);
    if (!t || !isOpen(t.state) || t.archived !== undefined || !visibleTo(ctx, t) || !mayLetGo(ctx, t)) continue;
    total += 1;
    if (items.length >= CARD_MAX) continue;
    let lookDone: { threadId: string; quote?: string; by?: string; at?: number } | undefined;
    if (r.look === "done" && r.quote) {
      // the quote is a line of a chat: it is shown only to someone who can read that chat right now, checked for this reader; anyone else sees that it looks done and where to look
      const thread = t.threadId ?? (t.source?.kind === "chat" ? t.source.id : undefined);
      if (thread) {
        lookDone = (await canRead(ctx, thread))
          ? { threadId: thread, quote: r.quote, by: r.quote_by ?? "", at: r.quote_at ?? 0 }
          : { threadId: thread };
      }
    }
    items.push({ task: outFor(ctx, t, idx), why: r.why, askedAt: r.at, ...(lookDone ? { lookDone } : {}) });
  }
  return { items, total };
}

/**
 * Answer the card: keep (not asked again for 90 days), archive, or seen (the card was in front of the person: stamps the first time, so the week of silence starts then). A task the caller cannot see or may not
 * answer for is skipped the same way as one that does not exist, so a list with one such id answers the rest and tells nothing about it.
 */
export async function stillAnswer(ctx: TasksCtx, input: In): Promise<unknown> {
  personOnly(ctx);
  let kept = 0,
    archived = 0,
    done = 0;
  for (const id of [...new Set<string>(input.taskIds ?? [])].slice(0, 50)) {
    const t = findTask(ctx.db, id);
    if (!t || !visibleTo(ctx, t) || !mayLetGo(ctx, t)) continue;
    if (!isOpen(t.state) || t.archived !== undefined) continue;
    if (input.answer === "seen") {
      ctx.db.run("UPDATE tasks_ask SET seen_at = ? WHERE task_id = ? AND seen_at IS NULL", ctx.now(), t.id);
      continue;
    }
    if (input.answer === "done" && ctx.call) {
      // the person says "yes, it is done" on a card row: the task closes through the ordinary move, as them, with a plain note
      try {
        await ctx.call("tasks.transition", { taskId: t.id, to: "done", note: "Marked done from the card." });
        ctx.db.run("DELETE FROM tasks_ask WHERE task_id = ?", t.id);
        done += 1;
      } catch {
        /* it cannot close from here (a step it waits on): it stays on the card */
      }
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
  return { kept, archived, done };
}
