// When a site is deleted, what it left running goes with it (r42-sites-run): its workers' containers, its job runs in progress, its backups' files, and every log line, sample, job, run and backup row.
// Called by stopDeployed (release.ts) before the site's network is removed, since a container still on it would keep the network alive.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { siteRunner } from "./route.ts";
import * as st from "../ops/store.ts";

export async function cleanupOps(ctx: Ctx, siteId: string): Promise<void> {
  const r = siteRunner();
  const gone: string[] = [];
  for (const v of st.listServices(ctx.db, siteId)) if (v.containerId) gone.push(v.containerId);
  for (const run of st.openRuns(ctx.db, siteId)) if (run.containerId) gone.push(run.containerId);
  for (const c of gone) await r?.remove(c).catch(() => undefined);
  for (const b of st.listBackups(ctx.db, siteId)) if (b.fileId) await ctx.blobs?.delete(b.fileId).catch(() => false);
  st.dropSiteOps(ctx.db, siteId);
}
