// Room left per machine (lane l-machines): the score and the words for why, from the machine's last report and the turns the host counts live. One function for the Machines page, the alerts and placement.
import { allMachines, ensure, maxTurnsOf, roomOf } from "./projections.ts";
import type { MachinesCtx, Rec } from "./projections.ts";
import { hostSeams } from "./seams.ts";

export interface MachineRoom { score: number; why: string; name: string; turns: number; maxTurns: number; draining: boolean }

/**
 * Turns running on each machine now, counted from the engine's own running turns (each turn is recorded against the machine it was placed on before its engine starts, so two turns started back to
 * back see each other). A warm engine process waiting for the next message is not a turn. When the engine cannot say, the host's count of processes, then the machine's last report, stand in.
 */
export async function turnCounter(ctx: MachinesCtx): Promise<(r: Rec) => number> {
  let rows: Array<{ where: { kind: string; nodeId?: string } }> | null = null;
  if (typeof ctx.call === "function") { try { rows = ((await ctx.call("engine.turns.running", {})) as { turns?: typeof rows }).turns ?? []; } catch { rows = null; } }
  const by = new Map<string, number>();
  let onSpace = 0;
  for (const t of rows ?? []) { if (t.where.nodeId) by.set(t.where.nodeId, (by.get(t.where.nodeId) ?? 0) + 1); else if (t.where.kind === "space") onSpace++; }
  return (r) => (r.kind === "space" ? (hostSeams.turns("space") ?? (rows ? onSpace : r.runs?.turns ?? 0)) : rows ? (by.get(r.machineId) ?? 0) : (hostSeams.turns(r.machineId) ?? r.runs?.turns ?? 0));
}

/** What placement needs of each machine: how much room it has, and the words for why not. Keyed by machine id. */
export async function roomsFor(ctx: MachinesCtx): Promise<Record<string, MachineRoom>> {
  ensure(ctx.db);
  const now = ctx.now(), out: Record<string, MachineRoom> = {}, turnsOf = await turnCounter(ctx);
  for (const r of allMachines(ctx)) {
    const turns = turnsOf(r);
    const room = roomOf(r, now, turns);
    out[r.machineId] = { score: room.score, why: room.why, name: r.nickname ?? r.name, turns, maxTurns: maxTurnsOf(r), draining: r.drain };
  }
  return out;
}
