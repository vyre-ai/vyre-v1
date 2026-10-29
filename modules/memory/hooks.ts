// The nightly job of memory (spec 2.15, ARCH 6.10): memory.maintain merges accepted facts, closes old versions and rewrites each agent's MAP.md. Capture is not here: it needs a person in the chat,
// so the engine module hands chats to memory.capture when they close or go quiet (modules/engine/handlers/capture.ts).
import { rowsOf, num } from "./projections.ts";
import type { Db } from "./projections.ts";

const NIGHT_MIN_AGE = 20 * 3_600_000;
const NIGHT_MAX_AGE = 36 * 3_600_000;

interface HookCtx { now(): number; db: Db; call(cap: string, input: unknown): Promise<unknown> }

const ready = new WeakSet<object>();
function tables(db: Db): void {
  if (ready.has(db)) return;
  db.run("CREATE TABLE IF NOT EXISTS memory_job_state (name TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  ready.add(db);
}

/** Run memory.maintain about once a night: after the small hours when 20 hours have passed, or whenever 36 have (a host that was off at night). */
export async function nightly(ctx: HookCtx, hourOf: (t: number) => number = (t) => new Date(t).getHours()): Promise<string[]> {
  tables(ctx.db);
  const now = ctx.now();
  const last = num(rowsOf(ctx.db, "SELECT at FROM memory_job_state WHERE name = 'nightly'")[0]?.["at"]);
  const age = last === 0 ? Infinity : now - last;
  const hour = hourOf(now);
  if (!(age >= NIGHT_MAX_AGE || (age >= NIGHT_MIN_AGE && hour >= 1 && hour <= 5))) return [];
  await ctx.call("memory.maintain", {});
  ctx.db.run("INSERT INTO memory_job_state (name, at) VALUES ('nightly', ?) ON CONFLICT(name) DO UPDATE SET at = excluded.at", now);
  return ["nightly"];
}

export const periodic = {
  "memory.nightly": { everyMs: 3_600_000, run: (ctx: unknown): Promise<string[]> => nightly(ctx as HookCtx) },
};
