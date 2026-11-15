// What the Automations first page shows, decided here and read in one call (AUTOMATIONS-BUILD-RC29 round four, item 4): what needs the person (with the fix named), at most one suggestion that passed the three-part rule,
// the Today line, and the counts of the header. The page draws this and decides nothing. A failure that a later run cleared is not a need any more; a paused Automation is, with the reason it gives.
import { connectorOffers } from "./connector-offer.ts";
import { list } from "./defs.ts";
import { getAutomation } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

interface Row {
  id: string;
  name: string;
  status: string;
  updatedAt: number;
  lastRun?: { runId: string; status: string; at: number };
  failedRuns: number;
}
const DAY = 86_400_000;

export async function home(ctx: AutoCtx): Promise<unknown> {
  const rows = ((await list(ctx, { limit: 200 })) as { automations: Row[] }).automations;
  const needs = rows
    .filter(
      (a) =>
        a.status === "paused" ||
        a.lastRun?.status === "failed" ||
        (a.failedRuns > 0 && a.lastRun?.status !== "succeeded"),
    )
    .map((a) => {
      const failed = a.lastRun?.status === "failed";
      let why = "Its last run failed.";
      if (a.status === "paused") {
        const reason = getAutomation(ctx, a.id).pausedReason;
        why = reason && reason.trim() !== "" ? reason : "It is paused.";
      } else if (!failed && a.failedRuns > 1) why = `${a.failedRuns} runs failed.`;
      return {
        id: a.id,
        automation: a.name,
        why,
        at: a.lastRun?.at ?? a.updatedAt,
        ...(failed && a.status !== "paused" && a.lastRun ? { runId: a.lastRun.runId } : {}),
      };
    })
    .sort((x, y) => y.at - x.at);
  const offers = (
    await connectorOffers(ctx).catch(() => ({ offers: [] as { itemId: string; appName: string; text: string }[] }))
  ).offers;
  const since = ctx.now() - DAY;
  const today = rows.flatMap((a) => (a.lastRun && a.lastRun.at >= since ? [a.lastRun] : []));
  return {
    needs,
    ...(offers[0] ? { suggestion: offers[0] } : {}),
    today: { ran: today.length, failed: today.filter((r) => r.status === "failed").map((r) => ({ runId: r.runId })) },
    counts: { total: rows.length, on: rows.filter((a) => a.status === "on").length, needYou: needs.length },
  };
}

/** What "Connect an app" lists for this person: the Vault items they hold Use on whose app their Assistant can set up (the same three-part rule as the first page's suggestion). */
export async function connectOptions(ctx: AutoCtx): Promise<unknown> {
  const offers = (
    await connectorOffers(ctx).catch(() => ({ offers: [] as { itemId: string; appName: string; text: string }[] }))
  ).offers;
  return { vault: offers.map((o) => ({ itemId: o.itemId, appName: o.appName })) };
}
