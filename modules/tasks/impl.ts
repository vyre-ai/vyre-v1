// Tasks module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
import { handlers } from "./handlers/index.ts";

export { handlers };
import { countNeedsYou } from "./handlers/state.ts";
import { resumeRunOf, settleFromSource } from "./handlers/resume.ts";
import { syncPolicy } from "./projections.ts";
import { onAgentDeleted, onPersonLeft } from "./handlers/departures.ts";
import { onCrewMerged, onRunStopped, onTaskChanged } from "./handlers/schedule.ts";
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
  /** Finishing a task starts what waited on it and tells a parent only what it has to hear (handlers/schedule.ts). */
  "tasks.schedule": { on: ["task.transitioned", "task.withdrawn", "task.deleted", "task.created"], run: (ctx: TasksCtx, event: Parameters<typeof onTaskChanged>[1]) => onTaskChanged(ctx, event) },
  "tasks.crew_merged": { on: ["crew.job_merged"], run: (ctx: TasksCtx, event: Parameters<typeof onCrewMerged>[1]) => onCrewMerged(ctx, event) },
  "tasks.run_stopped": { on: ["run.stopped", "run.failed"], run: (ctx: TasksCtx, event: Parameters<typeof onRunStopped>[1]) => onRunStopped(ctx, event) },
  "tasks.run_resume": { on: ["task.transitioned"], run: (ctx: TasksCtx, event: Parameters<typeof resumeRunOf>[1]) => resumeRunOf(ctx, event) },
  /** The source decided (a card in the chat, the access or key card): its tasks close, for everyone they were addressed to (handlers/resume.ts). */
  "tasks.source_settle": {
    on: ["block.answered", "plan.approved", "plan.rejected", "access.granted", "access.declined", "vault.request_fulfilled", "vault.request_declined", "vault.request_canceled"],
    run: (ctx: TasksCtx, event: Parameters<typeof settleFromSource>[1]) => settleFromSource(ctx, event),
  },
  /** Nothing waits on someone who is gone: what they held moves on, with one line of history. */
  "tasks.person_left": { on: ["member.removed"], run: (ctx: TasksCtx, event: Parameters<typeof onPersonLeft>[1]) => onPersonLeft(ctx, event) },
  "tasks.agent_deleted": { on: ["agent.deleted"], run: (ctx: TasksCtx, event: Parameters<typeof onAgentDeleted>[1]) => onAgentDeleted(ctx, event) },
};
