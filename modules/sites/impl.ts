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
import {
  acceptWebhook,
  hookHandlers,
  markPushDone,
  markPushFailed,
  pendingPushes,
  recordDeployFailure,
} from "./handlers/hook.ts";
export { refreshDomainRoutes } from "./handlers/route-domains.ts";

// A site is a route (owner, 2 Nov): handlers/route.ts is what ships. The build pipeline below it (deploy, previews, staging, promote, site tables) is dormant and deferred: each of its capabilities stays registered and
// refuses with "Not in this version yet" (ruling 60, docs/deferred.md). Nothing wires configureSites or dockerRuntime.
// Sites Vyre builds and runs (owner, 3 Nov): deploy, rollback, env from the Vault, Postgres and Redis, password and Space sign-in at a site's own address (handlers/release.ts).
const live = { ...routeHandlers, ...domainRouteHandlers, ...releaseHandlers, ...hookHandlers };
const dormant = registry.capabilities.filter((c) => c.module === "sites" && !(c.name in live)).map((c) => c.name);
export const handlers = { ...deferredHandlers(dormant), ...live };
export const consumers = {};
export { markPushDone, markPushFailed, pendingPushes, recordDeployFailure };
type Src = {
  repo?: string;
  folderId?: string;
  fileId?: string;
  path?: string;
  branch?: string;
  root?: string;
  fp?: string;
};
type Reader = { db: { all(sql: string, ...a: unknown[]): unknown[] } };
function parseSource(raw: unknown): Src | null {
  if (typeof raw !== "string") return null;
  try {
    const s = JSON.parse(raw) as Record<string, unknown>;
    const out: Src = {};
    for (const k of ["repo", "folderId", "fileId", "path", "branch", "root", "fp"] as const)
      if (typeof s[k] === "string") out[k] = s[k] as string;
    return out;
  } catch {
    return null;
  }
}
/**
 * What the Gate needs to know about a site: where its code comes from now, the Vault keys in its stored env (with their scope), and, for a branch, where its newest preview was built from. A key that is a plain value is no key.
 * Null when the site is not there.
 */
export function siteFacts(
  ctx: Reader,
  siteId: string,
  branch?: string,
): {
  source: Src | null;
  env: { name: string; handle: string; scope: string }[];
  builtFrom: Src | null;
  deployedFp: string | null;
  protection: { state: string; branch?: string; at?: number } | null;
} | null {
  const site = ctx.db.all(
    "SELECT source, current_deployment, protection FROM sites_site WHERE id = ? AND deleted_at IS NULL",
    siteId,
  )[0] as { source?: unknown; current_deployment?: unknown; protection?: unknown } | undefined;
  if (!site) return null;
  // what the uploaded files were when the live deploy was built
  const live =
    typeof site.current_deployment === "string"
      ? (ctx.db.all("SELECT built_from FROM sites_deployment WHERE id = ?", site.current_deployment)[0] as
          | { built_from?: unknown }
          | undefined)
      : undefined;
  const deployedFp = parseSource(live?.built_from)?.fp ?? null;
  const env = (
    ctx.db.all("SELECT name, vault_handle, scope FROM sites_env WHERE site_id = ? AND plain IS NULL", siteId) as {
      name: string;
      vault_handle: string;
      scope: string | null;
    }[]
  )
    .filter((r) => r.vault_handle !== "")
    .map((r) => ({ name: r.name, handle: r.vault_handle, scope: r.scope ?? "production" }));
  let builtFrom: Src | null = null;
  if (branch !== undefined) {
    const d = ctx.db.all(
      "SELECT built_from FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND branch = ? AND state = 'ready' AND removed_at IS NULL ORDER BY at DESC",
      siteId,
      branch,
    )[0] as { built_from?: unknown } | undefined;
    builtFrom = parseSource(d?.built_from);
  }
  let protection: { state: string; branch?: string; at?: number } | null = null;
  try {
    const p = typeof site.protection === "string" ? (JSON.parse(site.protection) as Record<string, unknown>) : null;
    if (p && typeof p["state"] === "string")
      protection = {
        state: p["state"],
        ...(typeof p["branch"] === "string" ? { branch: p["branch"] } : {}),
        ...(typeof p["at"] === "number" ? { at: p["at"] } : {}),
      };
  } catch {
    /* unreadable is unknown */
  }
  return { source: parseSource(site.source), env, builtFrom, deployedFp, protection };
}
/** /hooks/sites: GitHub's webhook for a site, checked with the site's own secret (handlers/hook.ts). */
export const hostCalls = { "sites.accept_webhook": acceptWebhook };
export const hostSeams = { configureRoutes, configureDomainEdge };
