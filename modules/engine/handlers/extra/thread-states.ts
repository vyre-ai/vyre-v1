// engine.thread_states: the latest turn of each chat in one call (the sidebar's failed mark). One grouped query on the engine's own table; as the asker: only a chat whose latest turn the caller asked, and that they may view, has a state. Anything else is absent (never an error that says it exists).
import { actorOf } from "../../projections.ts";
import type { EngineCtx } from "../../projections.ts";
import { ensureExtra } from "./schema.ts";

type Row = Record<string, unknown>;
const MAX = 200;
export const GENERIC_FAILURE = "Something went wrong.";

/** The words a failed turn carries: its message, cut short, or a plain sentence when it has none. A code, a trace id and any next-step list stay behind the turn's own page. */
export function failedLineOf(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return GENERIC_FAILURE;
  try {
    const v = JSON.parse(raw) as { message?: unknown };
    const m = typeof v.message === "string" ? v.message.trim() : "";
    return m === "" ? GENERIC_FAILURE : m.slice(0, 160);
  } catch {
    return GENERIC_FAILURE;
  }
}

const STATE: Record<string, "running" | "waiting" | "failed" | "done"> = {
  queued: "running",
  running: "running",
  waiting: "waiting",
  failed: "failed",
  completed: "done",
  cancelled: "done",
};

export function threadStates(
  ctx: EngineCtx,
  input: { threadIds: string[] },
): { states: { threadId: string; state: "running" | "waiting" | "failed" | "done"; failedLine?: string }[] } {
  ensureExtra(ctx.db);
  const ids = [...new Set(input.threadIds)].slice(0, MAX);
  if (ids.length === 0) return { states: [] };
  const rows = ctx.db.all(
    `SELECT t.thread_id, t.asker, t.state, t.error FROM engine_turns t
       JOIN (SELECT thread_id, MAX(qseq) AS m FROM engine_turns WHERE thread_id IN (${ids.map(() => "?").join(", ")}) GROUP BY thread_id) x
         ON t.thread_id = x.thread_id AND t.qseq = x.m`,
    ...ids,
  ) as Row[];
  const states = [];
  for (const r of rows) {
    const threadId = String(r["thread_id"]);
    // Only the turns the caller asked: the kernel's view of a chat is wider than who may open it (a private chat is the chat module's own rule), so a state is never told for a chat by its id alone.
    if (String(r["asker"]) !== actorOf(ctx)) continue;
    if (ctx.authorize({ perm: null, level: "view" }, { type: "thread", id: threadId }).effect !== "allow") continue;
    const state = STATE[String(r["state"])] ?? "done";
    states.push({ threadId, state, ...(state === "failed" ? { failedLine: failedLineOf(r["error"]) } : {}) });
  }
  return { states };
}
