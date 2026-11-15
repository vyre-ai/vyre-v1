import { eraseTables, eraseWhere, tryAll, tryRun } from "../../lib/erase-agent.ts";
import type { EraseCtx, EraseIn, Footprint } from "../../lib/erase-agent.ts";
// Scheduler module (lane L6). The host loads these handlers once the module is live (host/modules.json, ARCH 12.4).
// `tick` is what the host scheduler glue calls on every pass: it fires every schedule that is due. `catch_up`, `waits.match` and `waits.expire` are capabilities the glue calls too.
import { handlers } from "./handlers/index.ts";
import { fireWakes, sweepFires, tickWakes } from "./handlers/schedule.ts";
import { syncPolicy } from "./projections.ts";
import type { SchedCtx } from "./projections.ts";

export { handlers };

/** The Wake table's pass: due fires are made, finished ones are pruned. Runs only where the scheduled-work lease is held (the host's periodic runner), so two computers never both make a fire; and if they did, the insert makes one. */
export const periodic = {
  "scheduler.wakes": {
    everyMs: 10_000,
    immediate: false,
    run: async (ctx: SchedCtx): Promise<string[]> => {
      const r = tickWakes(ctx);
      const fired = await fireWakes(ctx);
      const swept = await sweepFires(ctx);
      return r.made + r.pruned + swept.closed + fired.started + fired.skipped > 0
        ? [
            `${r.made} made, ${fired.started} started, ${fired.skipped} skipped, ${r.pruned} pruned, ${swept.closed} closed`,
          ]
        : [];
    },
  },
};

/** Async consumers by name. */
export const consumers = {
  /** The Space's scheduler.* settings, copied here from settings.changed: a module reads only its own tables. */
  "scheduler.settings_sync": {
    on: ["settings.changed"],
    async run(ctx: SchedCtx, event: { payload: Record<string, unknown> }): Promise<string[]> {
      return syncPolicy(ctx.db, event.payload) ? [String(event.payload["key"])] : [];
    },
  },
};
export { fireWakes, prune, sweepFires, tick, tickWakes } from "./handlers/schedule.ts";
export { dueSchedules, nextCron, parseCron } from "./projections.ts";

/** Delete an agent for good (F77): what this module holds of it is cleared when the agents module asks (lib/erase-agent.ts). */
export const hostCalls = {
  "scheduler-api.erase_agent": eraseTables([], (ctx, i) => {
    if (i.dry === true) return {};
    const ids = tryAll(
      ctx.db,
      `SELECT id FROM scheduler_api_schedules WHERE (owner_kind = 'agent' AND owner_id = ?) OR agent_id = ?`,
      i.agentId,
      i.agentId,
    ).map((r) => String(r["id"]));
    for (const id of ids) {
      tryRun(ctx.db, `DELETE FROM scheduler_api_fires WHERE schedule_id = ?`, id);
      tryRun(ctx.db, `DELETE FROM scheduler_api_missed WHERE schedule_id = ?`, id);
      tryRun(ctx.db, `DELETE FROM scheduler_api_fires_wake WHERE schedule_id = ?`, id);
      tryRun(ctx.db, `DELETE FROM scheduler_api_schedules WHERE id = ?`, id);
    }
    tryRun(ctx.db, `DELETE FROM scheduler_api_waits WHERE subject_type = 'agent' AND subject_id = ?`, i.agentId);
    return {};
  }),
};
