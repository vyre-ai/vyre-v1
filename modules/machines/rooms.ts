// Room left per machine (lane l-machines): the score and the words for why, from the machine's last report and the turns the host counts live. One function for the Machines page, the alerts and placement.
import { allMachines, ensure, maxTurnsOf, roomOf } from "./projections.ts";
import type { MachinesCtx } from "./projections.ts";
import { hostSeams } from "./seams.ts";

export interface MachineRoom { score: number; why: string; name: string; turns: number; maxTurns: number; draining: boolean }

/** What placement needs of each machine: how much room it has, and the words for why not. Keyed by machine id. The caller names live turn counts for the machines it holds sockets to. */
export function roomsFor(ctx: MachinesCtx): Record<string, MachineRoom> {
  ensure(ctx.db);
  const now = ctx.now(), out: Record<string, MachineRoom> = {};
  for (const r of allMachines(ctx)) {
    const turns = hostSeams.turns(r.machineId) ?? r.runs?.turns ?? 0;
    const room = roomOf(r, now, turns);
    out[r.machineId] = { score: room.score, why: room.why, name: r.nickname ?? r.name, turns, maxTurns: maxTurnsOf(r), draining: r.drain };
  }
  return out;
}

