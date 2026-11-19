// The alive line (lane r42-alive): what the Space did to the reader's tasks since a time, built from the archive log and the task rows, never written by a model. "Since Tuesday: 2 put away because they passed,
// 1 because the chat was closed, 3 new for you". Each item names the task, the reason (the sentence it was put away with) and when, so the person can press it and Put back. What the reader did by hand is not news.
import { NOT_ARCHIVED, allTasks, isMyTurn, isOpen, openIndex, visibleTo, whoIs } from "../projections.ts";
import type { ArchiveCode, TasksCtx } from "../projections.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAX_ITEMS = 50;

export async function changes(ctx: TasksCtx, input: In): Promise<unknown> {
  const since = Number(input.since);
  const me = whoIs(ctx);
  const rows = ctx.db.all(
    "SELECT task_id, at, by, code, why FROM tasks_archive WHERE at >= ? AND by <> ? ORDER BY at DESC LIMIT 500",
    since,
    me.id,
  ) as { task_id: string; at: number; by: string; code: ArchiveCode; why: string }[];
  const counts: Record<string, number> = {};
  const items: { taskId: string; title: string; code: ArchiveCode; why: string; at: number; by: string }[] = [];
  const byId = new Map(allTasks(ctx.db, "a.at >= ?", since).map((t) => [t.id, t] as const));
  for (const r of rows) {
    const t = byId.get(r.task_id);
    if (!t || !visibleTo(ctx, t)) continue;
    counts[r.code] = (counts[r.code] ?? 0) + 1;
    if (items.length < MAX_ITEMS)
      items.push({ taskId: t.id, title: t.title, code: r.code, why: r.why, at: r.at, by: r.by });
  }
  // new for you: tasks made since then whose next move is the reader's
  const idx = openIndex(ctx.db);
  let fresh = 0;
  for (const t of allTasks(ctx.db, `c.created_at >= ? AND ${NOT_ARCHIVED}`, since))
    if (isOpen(t.state) && t.createdBy !== me.id && isMyTurn(ctx, t, idx)) fresh += 1;
  return { since, items, counts, fresh };
}
