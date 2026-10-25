// console.overview, console.attention, console.activity, console.usage and console.nav (CONSOLE-SPEC section 4, ARCH 7.10).
// All reads, all open to console.access (the invoke pipeline checks it); they emit nothing.
import { ACTIVITY_DEFAULT, DESIGN_BETA, OVERVIEW_ACTIVITY, gather, navFor, recentActivity, usageGlance, usageRows } from "../projections.ts";
import { ask, asList, asRow, num } from "../projections.ts";
import type { ViewCtx } from "../projections.ts";

/** CPU, memory and disk as the host last reported them (health.machine); absent when nothing was reported or the caller may not read it. */
async function machineOf(ctx: ViewCtx): Promise<Record<string, number> | undefined> {
  const m = asRow((await ask(ctx, "health.machine", {}))?.["machine"]);
  if (!m) return undefined;
  const out: Record<string, number> = {};
  for (const k of ["cpuPercent", "memoryUsedBytes", "memoryTotalBytes", "diskFreeBytes", "diskTotalBytes"]) {
    const n = num(m[k]);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The newest backup in the backup log: when it ran and whether a restore into a scratch directory checked it. Absent for a caller without server.backups or a Space with no backup. */
async function lastBackupOf(ctx: ViewCtx): Promise<{ at: number; result: "verified" | "unverified" } | undefined> {
  const rows = asList((await ask(ctx, "backup.list", { limit: 50 }))?.["backups"]);
  let best: Record<string, unknown> | undefined;
  for (const r of rows) if ((num(r["at"]) ?? 0) > (num(best?.["at"]) ?? -1)) best = r;
  const at = num(best?.["at"]);
  return best && at !== undefined ? { at, result: best["verified"] === true ? "verified" : "unverified" } : undefined;
}

export async function overview(ctx: ViewCtx, _input: Record<string, unknown>) {
  const [g, activity, usage] = await Promise.all([gather(ctx), recentActivity(ctx, OVERVIEW_ACTIVITY), usageGlance(ctx)]);
  const [machine, lastBackup] = await Promise.all([machineOf(ctx), lastBackupOf(ctx)]);
  return { health: g.health, attention: g.attention, activity, usage, ...(machine ? { machine } : {}), ...(lastBackup ? { lastBackup } : {}) };
}

export async function attention(ctx: ViewCtx, _input: Record<string, unknown>) {
  return { items: (await gather(ctx)).attention };
}

export async function activity(ctx: ViewCtx, input: { limit?: number }) {
  return { rows: await recentActivity(ctx, input.limit ?? ACTIVITY_DEFAULT) };
}

export async function usage(ctx: ViewCtx, input: { period: "day" | "week" | "month"; by: "agent" | "person" | "model" }) {
  return { rows: await usageRows(ctx, input.period, input.by), note: DESIGN_BETA };
}

export async function nav(ctx: ViewCtx, _input: Record<string, unknown>) {
  return { groups: navFor(ctx) };
}
