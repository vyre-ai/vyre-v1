// governance (lane L7a). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L7_LIVE's (ruling 25). Governance reaches the other modules only through
// ctx.call (files, records, memory, audit, search, inbox, contacts, settings, access); it keeps holds, job state, findings and tombstones in its own tables.
import type { Handler } from "../../host/src/invoke.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
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

/** The host binds the event log behind erase (host/src/daemon): erase then reaches the append-only log, and a restore replays it. */
export const hostSeams = { setEventsCompact: h.setEventsCompact };

export const projections = { inline: {}, consumers: {} };

/**
 * Host call for the removal wizard: how many of these items (ids from the owning modules) are on hold, counting a hold on the person themselves. A legal hold stops a delete, so the wizard asks before it deletes.
 */
export const hostCalls = {
  "governance.held_among": (ctx: Ctx, i: { person: string; ids: string[] }): number => {
    try {
      const held = new Set((ctx.db.all(`SELECT "kind", "targetId" FROM governance_hold`) as { kind: string; targetId: string }[]).map((r) => (r.kind === "person" ? `person:${r.targetId}` : r.targetId)));
      return [`person:${i.person}`, ...i.ids].filter((x) => held.has(x)).length;
    } catch { return 0; }
  },
};
