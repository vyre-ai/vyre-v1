// Scheduler module (lane L6). The host loads these handlers once the module is live (host/modules.json, ARCH 12.4).
// `tick` is what the host scheduler glue calls on every pass: it fires every schedule that is due. `catch_up`, `waits.match` and `waits.expire` are capabilities the glue calls too.
import { handlers } from "./handlers/index.ts";
import { sweepFires, tickWakes } from "./handlers/schedule.ts";
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
      const swept = await sweepFires(ctx);
      return r.made + r.pruned + swept.closed > 0 ? [`${r.made} made, ${r.pruned} pruned, ${swept.closed} closed`] : [];
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
export { prune, sweepFires, tick, tickWakes } from "./handlers/schedule.ts";
export { dueSchedules, nextCron, parseCron } from "./projections.ts";
