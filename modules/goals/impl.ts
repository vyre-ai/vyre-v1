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
    on: ["task.created", "task.updated", "task.transitioned", "task.completed", "task.withdrawn", "task.deleted", "task.children_settled"],
    run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onTask(ctx, event),
  },
  /** Budget: each turn in a goal's chats. */
  "goals.turns": { on: ["turn.completed", "turn.failed"], run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onTurn(ctx, event) },
  /** A turn in a goal's chat parked on a person: the goal waits on them. */
  "goals.waiting": { on: ["turn.waiting"], run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onWaiting(ctx, event) },
  /** A person mentioned in a goal's chat may read its folder. */
  "goals.mention": { on: ["message.mentioned"], run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onMention(ctx, event) },
  /** Files dropped in a goal chat are kept in the goal's folder. */
  "goals.drops": { on: ["message.received"], run: (ctx: GoalsCtx, event: Ev): Promise<string[]> => onMessage(ctx, event) },
};
