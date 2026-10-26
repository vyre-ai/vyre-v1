// governance (lane L7a). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L7_LIVE's (ruling 25). Governance reaches the other modules only through
// ctx.call (files, records, memory, audit, search, inbox, contacts, settings, access); it keeps holds, job state, findings and tombstones in its own tables.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "governance.retention.get": (ctx) => h.retentionGet(ctx),
  "governance.retention.set": (ctx, i) => h.retentionSet(ctx, i),
  "governance.retention.reset": (ctx, i) => h.retentionReset(ctx, i),
  "governance.jobs.list": (ctx) => h.jobsList(ctx),
  "governance.jobs.run_now": (ctx, i) => h.jobsRunNow(ctx, i),
  "governance.jobs.tick": (ctx, i) => h.jobsTick(ctx, i),
  "governance.holds.list": (ctx, i) => h.holdsList(ctx, i),
  "governance.holds.place": (ctx, i) => h.holdsPlace(ctx, i),
  "governance.holds.release": (ctx, i) => h.holdsRelease(ctx, i),
  "governance.erase.find": (ctx, i) => h.eraseFind(ctx, i),
  "governance.erase.apply": (ctx, i) => h.eraseApply(ctx, i),
  "governance.erase.list": (ctx, i) => h.eraseList(ctx, i),
  "governance.tombstones.list": (ctx, i) => h.tombstonesList(ctx, i),
  "governance.tombstones.reapply": (ctx) => h.tombstonesReapply(ctx),
  "governance.jobs_health": (ctx) => h.jobsHealth(ctx),
};

/**
 * The host runs this at boot and every six hours (P-L7_15, P-CC_39): every retention kind gets its first daily tick, and a kind whose tick lapsed gets a new one. It is idempotent, so a second boot
 * schedules nothing new. Without it a Space that never pressed Run now would never have retention running.
 */
export const periodic = {
  "governance.seed_ticks": { everyMs: 6 * 3_600_000, run: (ctx: unknown) => h.seedTicks(ctx as Parameters<typeof h.seedTicks>[0]) },
};

export const projections = { inline: {}, consumers: {} };
