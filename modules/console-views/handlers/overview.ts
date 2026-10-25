// console.overview, console.attention, console.activity, console.usage and console.nav (CONSOLE-SPEC section 4, ARCH 7.10).
// All reads, all open to console.access (the invoke pipeline checks it); they emit nothing.
import { ACTIVITY_DEFAULT, DESIGN_BETA, OVERVIEW_ACTIVITY, gather, navFor, recentActivity, usageGlance, usageRows } from "../projections.ts";
import type { ViewCtx } from "../projections.ts";

export async function overview(ctx: ViewCtx, _input: Record<string, unknown>) {
  const [g, activity, usage] = await Promise.all([gather(ctx), recentActivity(ctx, OVERVIEW_ACTIVITY), usageGlance(ctx)]);
  return { health: g.health, attention: g.attention, activity, usage };
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
