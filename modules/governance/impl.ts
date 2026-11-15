// governance (lane L7a). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L7_LIVE's (ruling 25). Governance reaches the other modules only through
// ctx.call (files, records, memory, audit, search, inbox, contacts, settings, access); it keeps holds, job state, findings and tombstones in its own tables.
import { eraseIds } from "./handlers/erase.ts";
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
  "governance.tombstones.reapply": (ctx, input) =>
    h.tombstonesReapply(ctx, input as Parameters<typeof h.tombstonesReapply>[1]),
  "governance.jobs_health": (ctx) => h.jobsHealth(ctx),
};

/**
 * The host runs this every minute (P-L7_15, P-CC_39): every retention kind gets its first daily tick, and a kind whose tick lapsed gets a new one. The host starts a periodic job after its first interval, not at
 * boot, so a short interval is what puts the first tick within a minute of boot; the check is a few indexed reads and schedules nothing when every kind already has its tick.
 */
export const periodic = {
  "governance.seed_ticks": {
    everyMs: 60_000,
    run: (ctx: unknown) => h.seedTicks(ctx as Parameters<typeof h.seedTicks>[0]),
  },
};

/** The host binds the event log behind erase (host/src/daemon): erase then reaches the append-only log, and a restore replays it. */
export const hostSeams = { setEventsCompact: h.setEventsCompact };

export const projections = { inline: {}, consumers: {} };

/**
 * Host call for the removal wizard: how many of these items (ids from the owning modules) are on hold, counting a hold on the person themselves. A legal hold stops a delete, so the wizard asks before it deletes.
 */
export const hostCalls = {
  /** Delete for good (F77): the event log and request cache lose what names the agent, its chats and its routines (handlers/erase.ts eraseIds). */
  "governance.erase_agent": async (
    _ctx: Ctx,
    i: { agentId: string; ids?: string[]; dry?: boolean },
  ): Promise<Record<string, never>> => {
    if (i.dry === true) return {};
    const out = await eraseIds([i.agentId, ...(i.ids ?? [])]);
    (_ctx as unknown as { log: { warn(m: string, a: object): void } }).log.warn(
      "governance: an agent erased from the log and request cache",
      { ...out, ids: (i.ids ?? []).length },
    );
    return {};
  },
  "governance.held_among": (ctx: Ctx, i: { person: string; ids: string[] }): number => {
    try {
      const held = new Set(
        (ctx.db.all(`SELECT "kind", "targetId" FROM governance_hold`) as { kind: string; targetId: string }[]).map(
          (r) => (r.kind === "person" ? `person:${r.targetId}` : r.targetId),
        ),
      );
      return [`person:${i.person}`, ...i.ids].filter((x) => held.has(x)).length;
    } catch {
      return 0;
    }
  },
};
