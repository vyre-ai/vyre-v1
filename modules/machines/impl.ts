// Machines module (lane l-machines). The handlers, the Space server's own 30-second report, the ingest the host calls for every other machine, and the thinning of old points.
import { parseReport } from "../../host/src/machines/report.ts";
import type { Report } from "../../host/src/machines/report.ts";
import { alerts, get, list, set } from "./handlers/index.ts";
import { compact, ensure, ingest, isOnline, machineById, allMachines, maxTurnsOf, pinsOf, roomOf } from "./projections.ts";
import type { Kind, MachinesCtx } from "./projections.ts";
import { bindMachines, hostSeams } from "./seams.ts";

export const handlers = { "machines.alerts": alerts, "machines.get": get, "machines.list": list, "machines.set": set };
export { bindMachines };

/** What placement needs of each machine: how much room it has, and the words for why not. Keyed by machine id. The caller names live turn counts for the machines it holds sockets to. */
export function roomsFor(ctx: MachinesCtx): Record<string, { score: number; why: string; name: string; turns: number; maxTurns: number; draining: boolean }> {
  ensure(ctx.db);
  const now = ctx.now(), out: Record<string, { score: number; why: string; name: string; turns: number; maxTurns: number; draining: boolean }> = {};
  for (const r of allMachines(ctx)) {
    const turns = hostSeams.turns(r.machineId) ?? r.runs?.turns ?? 0;
    const room = roomOf(r, now, turns);
    out[r.machineId] = { score: room.score, why: room.why, name: r.nickname ?? r.name, turns, maxTurns: maxTurnsOf(r), draining: r.drain };
  }
  return out;
}

/** Every 30 seconds: the Space server reads itself. Every 10 minutes: raw points older than a day fold into ten-minute points. */
export const periodic = {
  "machines.sample": {
    everyMs: 30_000, immediate: true,
    run: async (ctx: MachinesCtx): Promise<string[]> => {
      ensure(ctx.db);
      const own = await hostSeams.own();
      if (!own) return [];
      ingest(ctx, { machineId: "space", kind: "space", name: own.name, report: own.report });
      return [];
    },
  },
  "machines.compact": { everyMs: 10 * 60_000, immediate: true, run: (ctx: MachinesCtx): string[] => { compact(ctx); return []; } },
};

/** Ingest from the host: one machine's report, as it came over its socket. Never a capability: a session cannot reach it, and a report that does not parse is dropped. */
export const hostCalls = {
  "machines.ingest": (ctx: MachinesCtx, input: { machineId: string; kind: Kind; name: string; ownerId?: string; latencyMs?: number; report: unknown }): { ok: boolean } => {
    if (!/^(space|srv_[a-z0-9]{1,64}|device:[A-Za-z0-9_]{1,64})$/.test(input.machineId) || !["server", "computer", "space"].includes(input.kind)) return { ok: false };
    const report: Report | null = parseReport(input.report);
    if (!report) return { ok: false };
    ingest(ctx, { machineId: input.machineId, kind: input.kind, name: String(input.name).slice(0, 60) || "Computer", ...(input.ownerId ? { ownerId: input.ownerId } : {}), ...(input.latencyMs !== undefined ? { latencyMs: Math.max(0, Math.round(input.latencyMs)) } : {}), report });
    return { ok: true };
  },
  /** For placement: room per machine. */
  "machines.rooms": (ctx: MachinesCtx): ReturnType<typeof roomsFor> => roomsFor(ctx),
};
export { isOnline, machineById, pinsOf };
