// Room left (lane l-machines; lib so the machines module and agent placement share one function): what is free of the tightest of CPU, memory, the turn limit and disk, 0 to 100. Offline or draining is 0. Pure: the Machines page, the alerts and placement all call it,
// so the number a person reads is the number the next turn was placed by.
export type RoomWhy = "cpu" | "memory" | "turns" | "disk" | "offline" | "draining";

export interface RoomInput {
  online: boolean;
  draining: boolean;
  /** 0 to 100 each; absent means not known, which counts as free. */
  cpuPct?: number;
  memPct?: number;
  diskFreePct?: number;
  /** Turns running now and the most this machine takes at once (0 or absent: no limit). */
  turns: number;
  maxTurns?: number;
}

export interface Room {
  score: number;
  tightest: RoomWhy;
  /** The plain words for why there is little room: "4 of 4 turns", "CPU at 97%", "draining". */
  why: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

export function roomLeft(i: RoomInput): Room {
  if (!i.online) return { score: 0, tightest: "offline", why: "offline" };
  if (i.draining) return { score: 0, tightest: "draining", why: "draining" };
  const parts: Array<{ k: RoomWhy; free: number; why: string }> = [];
  if (i.cpuPct !== undefined) parts.push({ k: "cpu", free: 100 - i.cpuPct, why: `CPU at ${Math.round(i.cpuPct)}%` });
  // memory below 92% in use is not pressure; the score falls to 0 at 100% used the way the Machines page draws it
  if (i.memPct !== undefined) parts.push({ k: "memory", free: 100 - i.memPct * 0.92, why: `memory at ${Math.round(i.memPct)}%` });
  if (i.maxTurns !== undefined && i.maxTurns > 0) parts.push({ k: "turns", free: 100 - (i.turns / i.maxTurns) * 100, why: `${i.turns} of ${i.maxTurns} turns` });
  // disk only counts when it is nearly full (under 10% free)
  if (i.diskFreePct !== undefined) parts.push({ k: "disk", free: i.diskFreePct < 10 ? i.diskFreePct : 100, why: `${Math.round(i.diskFreePct)}% disk left` });
  let t = { k: "cpu" as RoomWhy, free: 100, why: "" };
  for (const p of parts) if (p.free < t.free) t = p;
  return { score: Math.round(clamp(t.free)), tightest: t.k, why: t.why };
}

/** A machine whose room left is under this is busy: the next turn goes to the next machine with room. */
export const BUSY_BELOW = 20;
