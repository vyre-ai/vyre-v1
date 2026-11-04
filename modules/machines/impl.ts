// Machines module (lane l-machines). The handlers, the Space server's own 30-second report, the ingest the host calls for every other machine, and the thinning of old points.
import { parseReport } from "../../host/src/machines/report.ts";
import type { Report } from "../../host/src/machines/report.ts";
import { alerts, alertsNotify, fix, tellRoom, get, list, moveRecord, moves, rooms, set } from "./handlers/index.ts";
import { roomsFor } from "./rooms.ts";
import { compact, ensure, ingest, isOnline, machineById, pinsOf } from "./projections.ts";
import type { Kind, MachinesCtx } from "./projections.ts";
import { bindMachines, hostSeams } from "./seams.ts";

export const handlers = { "machines.alerts": alerts, "machines.alerts_notify": alertsNotify, "machines.fix": fix, "machines.get": get, "machines.list": list, "machines.move_record": moveRecord, "machines.moves": moves, "machines.rooms": rooms, "machines.set": set };
export { bindMachines, roomsFor };

/** Every 30 seconds: the Space server reads itself. Every 10 minutes: raw points older than a day fold into ten-minute points. */
export const periodic = {
  "machines.sample": {
    everyMs: 30_000, immediate: true,
    run: async (ctx: MachinesCtx): Promise<string[]> => {
      ensure(ctx.db);
      const own = await hostSeams.own();
      if (!own) return [];
      // the Space server's sites and automations: counted from their modules, which the machine itself cannot see
      let sites = 0, automations = 0, agentComputers = 0;
      if (typeof ctx.call === "function") {
        try { sites = ((await ctx.call("sites.list", { section: "space" })) as { sites?: Array<{ live?: boolean; computerId?: string }> }).sites?.filter((x) => x.live === true && !x.computerId).length ?? 0; } catch { /* no sites module */ }
        try { automations = ((await ctx.call("automations.list", { section: "space", status: "on" })) as { automations?: unknown[] }).automations?.length ?? 0; } catch { /* no automations module */ }
        try { agentComputers = ((await ctx.call("computers.list", {})) as { computers?: Array<{ nodeId?: string }> }).computers?.filter((c) => c.nodeId === undefined).length ?? 0; } catch { /* no computers module */ }
      }
      ingest(ctx, { machineId: "space", kind: "space", name: own.name, report: { ...own.report, runs: { ...own.report.runs, sites, automations, agentComputers } } });
      return [];
    },
  },
  /** About once a minute: new alerts to the Inbox, once; a machine that ran out of room or has room again tells the placement caches. */
  "machines.notify": { everyMs: 60_000, run: async (ctx: MachinesCtx): Promise<string[]> => { await alertsNotify(ctx, {}); return []; } },
  "machines.compact": { everyMs: 10 * 60_000, immediate: true, run: (ctx: MachinesCtx): string[] => { compact(ctx); return []; } },
};

/** Ingest from the host: one machine's report, as it came over its socket. Never a capability: a session cannot reach it, and a report that does not parse is dropped. */
export const hostCalls = {
  /** A turn started or ended on a machine: who has room may have changed. */
  "machines.sync": (ctx: MachinesCtx): Promise<{ filled: string[]; freed: string[] }> => tellRoom(ctx),
  "machines.ingest": (ctx: MachinesCtx, input: { machineId: string; kind: Kind; name: string; ownerId?: string; latencyMs?: number; report: unknown }): { ok: boolean } => {
    if (!/^(space|srv_[a-z0-9]{1,64}|device:[A-Za-z0-9_]{1,64})$/.test(input.machineId) || !["server", "computer", "space"].includes(input.kind)) return { ok: false };
    const report: Report | null = parseReport(input.report);
    if (!report) return { ok: false };
    ingest(ctx, { machineId: input.machineId, kind: input.kind, name: String(input.name).slice(0, 60) || "Computer", ...(input.ownerId ? { ownerId: input.ownerId } : {}), ...(input.latencyMs !== undefined ? { latencyMs: Math.max(0, Math.round(input.latencyMs)) } : {}), report });
    return { ok: true };
  },
};
export { isOnline, machineById, pinsOf };
