// The last explicit account pick for this person. Ids only. No secrets and no Vault last-used time.
import { lastPicks } from "../accounts.ts";
import { me } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

export async function accountPicks(ctx: AutoCtx): Promise<{ picks: { app: string; accountId: string }[] }> {
  const rows = lastPicks(ctx.db, me(ctx));
  return { picks: Object.entries(rows).map(([app, accountId]) => ({ app, accountId })) };
}
