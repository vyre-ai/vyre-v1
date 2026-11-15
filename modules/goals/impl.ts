import { eraseTables, eraseWhere, tryAll, tryRun } from "../../lib/erase-agent.ts";
import type { EraseCtx, EraseIn, Footprint } from "../../lib/erase-agent.ts";
// Goals module (lane L6). The handlers, what it reads from the event log, and its clock.
import { handlers } from "./handlers/index.ts";
import { onMention, onMessage, onTask, onTurn, onWaiting, sweep } from "./handlers/events.ts";
import type { GoalsCtx } from "./projections.ts";

export { handlers };
export { briefText, paceOf } from "./handlers/caps.ts";

type Ev = Parameters<typeof onTask>[1];

/** Every minute: deadlines, source reads, check-ins, wake-ups nobody answered, and what is due to send. State is all in the goal's tables, so a restart picks up where it was. */
export const periodic = {
  "goals.clock": { everyMs: 60_000, immediate: true, run: (ctx: GoalsCtx): Promise<string[]> => sweep(ctx) },
};

export const consumers = {
  /** The plan's tasks move: keep their state, wake the lead when one is done, and stop waiting when a question or a hold is answered. */
  "goals.tasks": {
    on: [
      "task.created",
      "task.updated",
      "task.transitioned",
      "task.completed",
      "task.withdrawn",
      "task.deleted",
      "task.children_settled",
    ],
    run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onTask(ctx, event),
  },
  /** Budget: each turn in a goal's chats. */
  "goals.turns": {
    on: ["turn.completed", "turn.failed"],
    run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onTurn(ctx, event),
  },
  /** A turn in a goal's chat parked on a person: the goal waits on them. */
  "goals.waiting": {
    on: ["turn.waiting"],
    run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onWaiting(ctx, event),
  },
  /** A person mentioned in a goal's chat may read its folder. */
  "goals.mention": {
    on: ["message.mentioned"],
    run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onMention(ctx, event),
  },
  /** Files dropped in a goal chat are kept in the goal's folder. */
  "goals.drops": {
    on: ["message.received"],
    run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onMessage(ctx, event),
  },
};

/** Delete an agent for good (F77): what this module holds of it is cleared when the agents module asks (lib/erase-agent.ts). */
export const hostCalls = {
  "goals.erase_agent": (ctx: EraseCtx, i: EraseIn): Footprint => {
    const named: NonNullable<Footprint["named"]> = tryAll(
      ctx.db,
      `SELECT id, title FROM goals_goal WHERE lead_agent = ? OR helpers LIKE ?`,
      i.agentId,
      `%${i.agentId}%`,
    ).map((r) => ({ kind: "goal" as const, id: String(r["id"]), title: String(r["title"]) }));
    if (i.dry === true) return { named };
    for (const g of named) {
      const row = tryAll(ctx.db, `SELECT helpers FROM goals_goal WHERE id = ?`, g.id)[0];
      let helpers = String(row?.["helpers"] ?? "");
      try {
        const v = JSON.parse(helpers) as unknown;
        if (Array.isArray(v))
          helpers = JSON.stringify(
            v.filter((x) => (typeof x === "string" ? x : (x as { id?: string })?.id) !== i.agentId),
          );
      } catch {
        /* kept as it is */
      }
      tryRun(
        ctx.db,
        `UPDATE goals_goal SET lead_agent = CASE WHEN lead_agent = ? THEN NULL ELSE lead_agent END, helpers = ?, updated_at = ? WHERE id = ?`,
        i.agentId,
        helpers,
        ctx.now(),
        g.id,
      );
      tryRun(
        ctx.db,
        `INSERT INTO goals_activity (goal_id, seq, at, kind, text, "by", ref) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM goals_activity WHERE goal_id = ?), ?, 'agent_deleted', ?, 'system', NULL)`,
        g.id,
        g.id,
        ctx.now(),
        "The agent on this goal was deleted for good, so it needs someone.",
      );
    }
    // the steps it did stay on other people's goals: they read "a deleted agent" (the id resolves through the tombstone)
    return { named };
  },
};
