// The rest of Machines (lane l-machines): a machine's own findings with the Fix to press, recent moves, the alerts told once, and the busy markers that tell placement caches. Pure over ctx.db.
import { DAY, ensure, isOnline, roomOf, allMachines } from "./projections.ts";
import type { MachinesCtx, Rec } from "./projections.ts";

export interface Finding { key: string; state: "healthy" | "degraded" | "down"; detail: string; next: string; fix: "clear_caches" | "stop_idle" | "update" | null }
const OK = "No action needed.";

/** What a machine's own report says is wrong, with the Fix a person can press. The Space server also gets the host's Doctor, added by the caller. */
export function findingsOf(r: Rec, latest: string | null): Finding[] {
  const s = r.specs, l = r.load;
  if (!s || !l) return [{ key: "report", state: "degraded", detail: "This machine has not reported yet.", next: "Check that Vyre is running on it.", fix: null }];
  const used = s.diskBytes > 0 ? 100 - (l.diskFreeBytes / s.diskBytes) * 100 : 0, mem = s.memBytes > 0 ? (l.memUsedBytes / s.memBytes) * 100 : 0;
  const out: Finding[] = [];
  out.push(used > 85 ? { key: "disk", state: used > 90 ? "down" : "degraded", detail: `Disk is ${Math.round(used)}% full`, next: "Clear old turn caches and logs.", fix: "clear_caches" } : { key: "disk", state: "healthy", detail: `Disk is ${Math.round(used)}% full`, next: OK, fix: null });
  out.push(mem > 85 ? { key: "memory", state: "degraded", detail: `Memory is at ${Math.round(mem)}%`, next: "Stop idle engine sessions.", fix: "stop_idle" } : { key: "memory", state: "healthy", detail: `Memory is at ${Math.round(mem)}%`, next: OK, fix: null });
  if (latest && r.version && r.version !== latest) out.push({ key: "version", state: "degraded", detail: `Vyre ${r.version} is behind ${latest}`, next: r.kind === "computer" ? "The person updates it in Settings." : "Update it from this page.", fix: r.kind === "computer" ? null : "update" });
  out.push(r.can.includes("docker") ? { key: "docker", state: "healthy", detail: "Docker answers", next: OK, fix: null } : { key: "docker", state: "healthy", detail: "No Docker here: agent computers cannot start on this machine", next: "Install Docker to run agent computers here.", fix: null });
  return out;
}

// ---- recent moves

export interface Move { id: number; at: number; turnId: string | null; asker: string | null; agentId: string | null; threadId: string | null; from: string; to: string; why: string }
export const MOVES_MS = 30 * DAY;
const cut = (v: string, n: number): string => v.replace(/[\u0000-\u001f]/g, " ").slice(0, n);

export function recordMove(ctx: MachinesCtx, m: { turnId?: string; asker?: string; agentId?: string; threadId?: string; from: string; to: string; why: string }): void {
  ensure(ctx.db);
  ctx.db.run("INSERT INTO machines_move (at, turn_id, asker, agent_id, thread_id, from_name, to_name, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ctx.now(), m.turnId ?? null, m.asker ?? null, m.agentId ?? null, m.threadId ?? null, cut(m.from, 80), cut(m.to, 80), cut(m.why, 160));
  ctx.db.run("DELETE FROM machines_move WHERE at < ?", ctx.now() - MOVES_MS);
  const kept = ctx.db.all("SELECT id FROM machines_move ORDER BY id DESC LIMIT 200") as { id: number }[];
  if (kept.length === 200) ctx.db.run("DELETE FROM machines_move WHERE id < ?", kept[199]!.id);
}

/** Newest first; `asker` limits the list to one person's turns. */
export function readMoves(ctx: MachinesCtx, limit: number, asker?: string): Move[] {
  ensure(ctx.db);
  const rows = (asker === undefined
    ? ctx.db.all("SELECT id, at, turn_id, asker, agent_id, thread_id, from_name, to_name, why FROM machines_move ORDER BY id DESC LIMIT ?", limit)
    : ctx.db.all("SELECT id, at, turn_id, asker, agent_id, thread_id, from_name, to_name, why FROM machines_move WHERE asker = ? ORDER BY id DESC LIMIT ?", asker, limit)) as Record<string, unknown>[];
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return rows.map((r) => ({ id: Number(r["id"]), at: Number(r["at"]), turnId: s(r["turn_id"]), asker: s(r["asker"]), agentId: s(r["agent_id"]), threadId: s(r["thread_id"]), from: String(r["from_name"]), to: String(r["to_name"]), why: String(r["why"]) }));
}

// ---- busy markers: running out of room and having room again, each told once

/** The ids of the machines that are online and have no room now (room left under the busy line). */
export function busyNow(ctx: MachinesCtx, turnsOf: (r: Rec) => number | undefined, below: number): string[] {
  return allMachines(ctx).filter((r) => isOnline(r, ctx.now()) && roomOf(r, ctx.now(), turnsOf(r)).score < below).map((r) => r.machineId);
}

export function syncBusy(ctx: MachinesCtx, now: string[]): { filled: string[]; freed: string[] } {
  ensure(ctx.db);
  const was = new Set((ctx.db.all("SELECT machine_id FROM machines_busy") as { machine_id: string }[]).map((r) => r.machine_id)), is = new Set(now);
  const filled = [...is].filter((id) => !was.has(id)), freed = [...was].filter((id) => !is.has(id));
  for (const id of filled) ctx.db.run("INSERT OR REPLACE INTO machines_busy (machine_id, since) VALUES (?, ?)", id, ctx.now());
  for (const id of freed) ctx.db.run("DELETE FROM machines_busy WHERE machine_id = ?", id);
  return { filled, freed };
}
