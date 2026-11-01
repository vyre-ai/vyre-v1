// Scheduler module (lane L6). The host loads these handlers once the module is live (host/modules.json, ARCH 12.4).
// `tick` is what the host scheduler glue calls on every pass: it fires every schedule that is due. `catch_up`, `waits.match` and `waits.expire` are capabilities the glue calls too.
import { handlers } from "./handlers/index.ts";
import { syncPolicy } from "./projections.ts";
import type { SchedCtx } from "./projections.ts";

export { handlers };

/** Async consumers by name. */
export const consumers = {
  /** The Space's scheduler.* settings, copied here from settings.changed: a module reads only its own tables. */
  "scheduler.settings_sync": {
    on: ["settings.changed"],
    async run(ctx: SchedCtx, event: { payload: Record<string, unknown> }): Promise<string[]> { return syncPolicy(ctx.db, event.payload) ? [String(event.payload["key"])] : []; },
  },
};
export { tick } from "./handlers/schedule.ts";
export { dueSchedules, nextCron, parseCron } from "./projections.ts";
