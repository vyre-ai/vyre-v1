// A routine that cannot run says so, once, in plain words (P1 step 4, the failure rule).
//   tries    a Run that cannot start is tried three times (the wake's fire retries it); the third failed try pauses the routine, the way three failed Runs in a row do.
//   told     the pause makes ONE Needs-you item for the owner ("<routine> paused: <why>") and ONE line in the routine's chat. A trouble that clears on a retry tells nobody.
//   cleared  a Run that goes well withdraws the item.
//   missed   a server that was off across several times starts the routine once; its chat says how many came due.
// No code reaches a sentence: the reason is a clause from lib/words/failure.ts, and the raw message stays in the log.
import { failureClause } from "../../lib/words/failure.ts";
import { nextRun } from "./projections.ts";
import type { AgentsCtx, Db } from "./projections.ts";

type Row = Record<string, unknown>;
const ready = new WeakSet<object>();
function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run(
    'CREATE TABLE IF NOT EXISTS agents_routine_told ("routineId" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL, "at" INTEGER NOT NULL)',
  );
  ready.add(db as object);
}

/** The words of one cause for a person: a clause from the shared table; a start that failed has no provider code of its own. */
export function whyWords(code: string): string {
  return code === "start_failed" ? "Vyre could not start it" : failureClause(code);
}

/** One line in a routine's chat. A channel's id names its main chat; the chat capabilities take that chat's own id. A line that cannot be posted is logged, never thrown: the Run is not worth failing over it. */
export async function sayInChat(ctx: AgentsCtx, channelId: string | null, body: string, key: string): Promise<void> {
  if (!channelId || !ctx.call) return;
  try {
    let threadId = channelId;
    if (threadId.startsWith("chn_"))
      threadId = String(
        ((await ctx.call("channels.get", { channelId: threadId })) as { channel?: { mainThreadId?: string } }).channel
          ?.mainThreadId ?? threadId,
      );
    await ctx.call("chat.post", { threadId, body, mentions: [], idempotencyKey: key });
  } catch (e) {
    ctx.log.warn("a routine's line could not be said in its chat", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** The routine paused itself: say so in its chat and make the one item for its owner. `at` is the time the pause was made, so a second look at the same pause makes nothing new. */
export async function tellPaused(
  ctx: AgentsCtx,
  p: { routineId: string; ownerId: string; title: string; channelId: string | null; code: string; at: number },
): Promise<void> {
  ensure(ctx.db);
  const why = whyWords(p.code);
  await sayInChat(
    ctx,
    p.channelId,
    `Paused "${p.title}" after 3 failed runs: ${why}`,
    `routine-paused:${p.routineId}:${p.at}`,
  );
  if (!ctx.call) return;
  try {
    const made = (await ctx.call("tasks.create", {
      kind: "unblock",
      title: `${p.title} paused: ${why}`,
      summary: `${p.title} paused after 3 failed runs because ${why}. It starts again by itself once that is fixed, or turn it back on from its page.`,
      why: "A routine that fails three times in a row stops, so it does not keep failing.",
      assigned: { kind: "person", id: p.ownerId },
      source: { kind: "manual", id: p.routineId },
      actions: [{ key: "cannot", label: "Dismiss", note: "optional" }],
      idempotencyKey: `routine-paused:${p.routineId}:${p.at}`,
    })) as { task?: { id?: string } } | undefined;
    const taskId = made?.task?.id;
    if (taskId)
      ctx.db.run(
        'INSERT OR REPLACE INTO agents_routine_told ("routineId", "taskId", "at") VALUES (?, ?, ?)',
        p.routineId,
        taskId,
        p.at,
      );
  } catch (e) {
    ctx.log.warn("the Needs-you item for a paused routine could not be made", {
      routineId: p.routineId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** A Run of this routine went well: its item is no longer true. */
export async function withdrawTold(ctx: AgentsCtx, routineId: string): Promise<void> {
  ensure(ctx.db);
  const row = (ctx.db.all('SELECT "taskId" FROM agents_routine_told WHERE "routineId" = ?', routineId) as Row[])[0];
  if (!row || !ctx.call) return;
  try {
    await ctx.call("tasks.withdraw", { taskId: String(row["taskId"]), note: "The routine ran well again." });
    ctx.db.run('DELETE FROM agents_routine_told WHERE "routineId" = ?', routineId);
  } catch (e) {
    ctx.log.warn("the Needs-you item for a routine could not be withdrawn", {
      routineId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

const MAX_COUNT = 1000;
/** How many times of this cron came due after the first, up to now: what a server that was off missed. */
export function missedAfterFirst(cron: string, due: number, now: number): number {
  let count = 0;
  for (let t: number | null = due; t !== null && t <= now && count < MAX_COUNT; t = nextRun(cron, t)) count += 1;
  return Math.max(0, count - 1);
}

export async function tellMissed(
  ctx: AgentsCtx,
  r: { id: string; title: string; channelId: string | null; cron: string },
  due: number,
  now: number,
): Promise<void> {
  const n = missedAfterFirst(r.cron, due, now);
  if (n === 0) return;
  await sayInChat(
    ctx,
    r.channelId,
    `${n} ${n === 1 ? "run" : "runs"} of "${r.title}" came due while Vyre's server was off. It ran once, now.`,
    `routine-missed:${r.id}:${due}`,
  );
}
