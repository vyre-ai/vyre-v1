// Tasks module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
import { handlers } from "./handlers/index.ts";

export { handlers };
import { countNeedsYou } from "./handlers/state.ts";
import { resumeRunOf } from "./handlers/resume.ts";
import { syncPolicy } from "./projections.ts";
import type { TasksCtx } from "./projections.ts";
export { findStuck, mintApprovalToken, readApprovalToken, ACT_KEYS } from "./handlers/act.ts";
export { applyMove, checkMove, commitMove, planMove, submitTarget, afterReview } from "./handlers/state.ts";

/** What the Space switcher shows as Needs you on this person's tile (spaces.attention, P-L7_21): the same count as tasks.count_needs_you, asked for the person the host call runs as. */
export const hostCalls = {
  "tasks.attention": async (ctx: Parameters<typeof countNeedsYou>[0]): Promise<number> => {
    try { return Number(((await countNeedsYou(ctx, {} as never)) as { count?: number }).count ?? 0); } catch { return 0; }
  },
};

/** A Run waiting on a task goes on when the task is Done or Canceled, whichever way it got there (handlers/resume.ts). */
export const consumers = {
  /** The Space's tasks.* settings, copied here from settings.changed: a module reads only its own tables. */
  "tasks.settings_sync": {
    on: ["settings.changed"],
    async run(ctx: TasksCtx, event: { payload: Record<string, unknown> }): Promise<string[]> { return syncPolicy(ctx.db, event.payload) ? [String(event.payload["key"])] : []; },
  },
  "tasks.run_resume": { on: ["task.transitioned"], run: (ctx: TasksCtx, event: Parameters<typeof resumeRunOf>[1]) => resumeRunOf(ctx, event) },
};
