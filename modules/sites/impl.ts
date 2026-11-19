// sites (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every capability of the manifest has a handler (promote, rollback and site tables came with P-L8_02).

import { deferredHandlers } from "../../host/src/routes/deferred.ts";

export { inline } from "./projections.ts";
export {
  exchangeArtifactCode,
  routeByArtifactSession,
  routeById,
  routeBySlug,
  routeByTicket,
  routeByHost,
  deployedHosts,
  containerAddress,
} from "./handlers/route.ts";
export {
  autoDeploySites,
  checkPassword,
  newTicket,
  servingContainers,
  siteSubnets,
  SESSION_MS,
} from "./handlers/release.ts";
import { registry } from "../../generated/registry.ts";
import { configureDomainEdge, configureRoutes, routeHandlers } from "./handlers/route.ts";
import { domainRouteHandlers } from "./handlers/route-domains.ts";
import { releaseHandlers } from "./handlers/release.ts";
import { acceptWebhook, hookHandlers, markPushDone, markPushFailed, pendingPushes } from "./handlers/hook.ts";
export { refreshDomainRoutes } from "./handlers/route-domains.ts";

// A site is a route (owner, 2 Nov): handlers/route.ts is what ships. The build pipeline below it (deploy, previews, staging, promote, site tables) is dormant and deferred: each of its capabilities stays registered and
// refuses with "Not in this version yet" (ruling 60, docs/deferred.md). Nothing wires configureSites or dockerRuntime.
// Sites Vyre builds and runs (owner, 3 Nov): deploy, rollback, env from the Vault, Postgres and Redis, password and Space sign-in at a site's own address (handlers/release.ts).
const live = { ...routeHandlers, ...domainRouteHandlers, ...releaseHandlers, ...hookHandlers };
const dormant = registry.capabilities.filter((c) => c.module === "sites" && !(c.name in live)).map((c) => c.name);
export const handlers = { ...deferredHandlers(dormant), ...live };
export const consumers = {};
export { markPushDone, markPushFailed, pendingPushes };
/** A site's stored source (repo, folder, file or path), for the Gate: the place a Vault key given to the site would go. Null when there is none. */
export function siteSource(
  ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } },
  siteId: string,
): { repo?: string; folderId?: string; fileId?: string; path?: string } | null {
  const row = ctx.db.all("SELECT source FROM sites_site WHERE id = ? AND deleted_at IS NULL", siteId)[0] as
    | { source?: unknown }
    | undefined;
  if (!row || typeof row.source !== "string") return null;
  try {
    const s = JSON.parse(row.source) as Record<string, unknown>;
    const out: { repo?: string; folderId?: string; fileId?: string; path?: string } = {};
    for (const k of ["repo", "folderId", "fileId", "path"] as const)
      if (typeof s[k] === "string") out[k] = s[k] as string;
    return out;
  } catch {
    return null;
  }
}
/** /hooks/sites: GitHub's webhook for a site, checked with the site's own secret (handlers/hook.ts). */
export const hostCalls = { "sites.accept_webhook": acceptWebhook };
export const hostSeams = { configureRoutes, configureDomainEdge };
