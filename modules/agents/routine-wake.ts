// A routine's clock lives in the scheduler as one wake (P1 step 4). This file keeps the wake in step with the routine row, and nothing else: the routine row is where a person's standing lives, the wake is where
// its time lives, and no transaction spans the two modules, so every operation writes them in a fixed order (CONTRACTS-2026-11-13/P1-clock-wake.md, 9a) and a reconcile pass repairs what a crash left apart.
//   starting follows the wake  (save, resume): the wake first, then the row, so nothing fires for a routine that is not saved yet;
//   stopping leads the wake    (pause, delete, owner left): the row first, then the wake, so nothing new fires even if the wake change is lost;
// and agents.routine.fire starts nothing for a routine that is gone, off, paused or no longer agrees, so the gap between the two writes cannot make a Run.
import { ensure, nextRun, routineBy } from "./projections.ts";
import type { AgentsCtx } from "./projections.ts";
import { isSelfPaused } from "./routine-guard.ts";

type Row = Record<string, unknown>;
const MIRROR_STALE_MS = 15 * 60_000;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface WantWake {
  routineId: string;
  agentId: string;
  ownerId: string;
  /** the routine's cron (UTC); "" for a watcher, which has no clock */
  cron: string;
  /** on: the routine is enabled, has a cron and is not paused */
  active: boolean;
  /** the instant the first fire is due, carried over exactly (the backfill); only the host may say it */
  nextAt?: number | null;
}

export const wakeIdOf = (db: AgentsCtx["db"], routineId: string): string | undefined => {
  const r = (db.all("SELECT scheduleId FROM agents_routine_wake WHERE routineId = ?", routineId) as Row[])[0];
  return r ? str(r["scheduleId"]) : undefined;
};
const mapWake = (ctx: AgentsCtx, routineId: string, scheduleId: string): void => {
  ctx.db.run(
    "INSERT OR REPLACE INTO agents_routine_wake (routineId, scheduleId, createdAt) VALUES (?, ?, ?)",
    routineId,
    scheduleId,
    ctx.now(),
  );
};
const unmapWake = (ctx: AgentsCtx, routineId: string): void => {
  ctx.db.run("DELETE FROM agents_routine_wake WHERE routineId = ?", routineId);
};

interface WakeRow {
  id: string;
  when: { cron?: string; tz?: string };
  active: boolean;
  nextAt?: number;
}
async function readWake(ctx: AgentsCtx, scheduleId: string): Promise<WakeRow | undefined> {
  try {
    return ((await ctx.call!("scheduler.get", { scheduleId })) as { schedule: WakeRow }).schedule;
  } catch {
    return undefined; // not there any more
  }
}

/** Brings the routine's wake to what the routine wants. Idempotent: running it twice changes nothing the second time. */
export async function applyWake(ctx: AgentsCtx, w: WantWake): Promise<void> {
  if (!ctx.call) return;
  ensure(ctx.db);
  const mapped = wakeIdOf(ctx.db, w.routineId);
  const have = mapped ? await readWake(ctx, mapped) : undefined;
  if (mapped && !have) unmapWake(ctx, w.routineId); // its wake is gone: made again below if wanted
  if (!w.active) {
    if (have?.active) await ctx.call("scheduler.pause", { scheduleId: have.id, reason: "The routine is off" });
    return;
  }
  if (!have) {
    const made = (await ctx.call("scheduler.schedule", {
      owner: { kind: "agent_routine", id: w.routineId },
      cap: "agents.routine.fire",
      input: { routineId: w.routineId },
      when: { cron: w.cron, tz: "UTC" },
      kind: "routine",
      person: w.ownerId,
      agentId: w.agentId,
      ifMissed: "run_once",
      idempotencyKey: `routine-wake:${w.routineId}`,
      ...(w.nextAt != null ? { nextAt: w.nextAt } : {}),
    })) as { scheduleId: string };
    mapWake(ctx, w.routineId, made.scheduleId);
    return;
  }
  if (have.when.cron !== w.cron || have.when.tz !== "UTC")
    await ctx.call("scheduler.reschedule", { scheduleId: have.id, when: { cron: w.cron, tz: "UTC" } });
  if (!have.active) await ctx.call("scheduler.resume", { scheduleId: have.id });
}

/** The routine is deleted: its wake goes. */
export async function dropWake(ctx: AgentsCtx, routineId: string): Promise<void> {
  const mapped = wakeIdOf(ctx.db, routineId);
  if (mapped && ctx.call) await ctx.call("scheduler.cancel", { scheduleId: mapped }).catch(() => undefined);
  unmapWake(ctx, routineId);
}

/** What a routine row wants of its wake, read from the row (the truth for standing). */
export function wantOf(ctx: AgentsCtx, routineId: string): WantWake | undefined {
  const r = routineBy(ctx.db, routineId);
  if (!r) return undefined;
  const watcher =
    (ctx.db.all("SELECT 1 AS x FROM agents_routine_watch WHERE routineId = ?", routineId) as Row[]).length > 0;
  const paused = isSelfPaused(ctx.db, routineId);
  const active = r.enabled && !watcher && !paused && r.cron !== "" && nextRun(r.cron, ctx.now()) !== null;
  return {
    routineId: r.id,
    agentId: r.agentId,
    ownerId: r.ownerId,
    cron: r.cron,
    active,
    ...(r.nextRunAt !== undefined ? { nextAt: r.nextRunAt } : {}),
  };
}

/**
 * The reconcile (the net for a crash between the two writes, and the backfill: a routine saved before the wake table has no wake and gets one at its stored next time, exactly). For every routine the wake
 * is brought to what the row wants; a wake whose routine is gone is cancelled; a routine whose next time the wake does not share gets its mirror repaired from the wake. Returns how many it touched.
 */
export async function reconcileWakes(ctx: AgentsCtx): Promise<string[]> {
  if (!ctx.call) return [];
  ensure(ctx.db);
  const touched: string[] = [];
  for (const row of ctx.db.all("SELECT id FROM agents_routine ORDER BY createdAt, id LIMIT 2000") as Row[]) {
    const want = wantOf(ctx, str(row["id"]));
    if (!want) continue;
    const before = wakeIdOf(ctx.db, want.routineId);
    const had = before ? await readWake(ctx, before) : undefined;
    // a routine whose wake is missing is made at its stored next time (the backfill); the host may say it
    await applyWake(ctx, want);
    const now = wakeIdOf(ctx.db, want.routineId);
    const wake = now ? await readWake(ctx, now) : undefined;
    if (!before || !had || had.active !== want.active || had.when.cron !== want.cron) touched.push(want.routineId);
    // the mirror follows the wake: an active wake's next time is the routine's next time
    if (wake?.active && wake.nextAt !== undefined && want.active) {
      const r = routineBy(ctx.db, want.routineId);
      // not while a fire may still be tried: the wake goes on the moment it makes a fire, so a mirror that is at or behind now is the time an open fire is for, and the fire moves it when it starts the Run.
      // A fire's three tries end within three leases (six minutes), so a mirror left behind for longer than the quarter of an hour has no fire waiting for it.
      const waiting =
        r?.nextRunAt !== undefined && r.nextRunAt <= ctx.now() && ctx.now() - r.nextRunAt < MIRROR_STALE_MS;
      if (r && r.nextRunAt !== wake.nextAt && !waiting) {
        ctx.db.run(
          "UPDATE agents_routine SET nextRunAt = ?, updatedAt = ? WHERE id = ?",
          wake.nextAt,
          ctx.now(),
          want.routineId,
        );
        touched.push(want.routineId);
      }
    }
  }
  // a mapping whose routine is gone: its wake is cancelled
  for (const m of ctx.db.all("SELECT routineId FROM agents_routine_wake") as Row[]) {
    const id = str(m["routineId"]);
    if (!routineBy(ctx.db, id)) {
      await dropWake(ctx, id);
      touched.push(id);
    }
  }
  return touched;
}
