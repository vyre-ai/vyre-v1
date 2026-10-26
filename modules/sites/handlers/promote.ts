// sites promote and rollback (spec 2.20 Pipeline; ARCH 7.6): an explicit Promote puts a staging build on production, Rollback brings an earlier build back.
// sites.promote declares the Gate act site_promote in the manifest. The host parks the call and runs this handler only after the approval, so nothing here asks for approval again.
// Promote with a pull request: checks must pass, then the pull request is merged (github.pull_request.merge) and the build that was already staged ships. Promote is refused while a check fails or the build runs.
// Rollback restarts an earlier production build from its image. It carries no Gate act: the build was approved when it was promoted.
// A new container starts and is routed before the old one stops, so a failed start leaves production as it was.
// @reads ../migrations/0001_sites_core.sql
// @reads ../migrations/0002_promote_tables.sql

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import type { DeployEnv, SiteDrivers, SiteState } from "./deploy.ts";
import { defaultBranchOf, fail, flag, hexOf, isNull, many, mustSite, nid, num, one, optStr, rec, reqStr, siteDrivers, str, NETWORK } from "./deploy.ts";
import { routeProductionDomains } from "./domains.ts";

type Row = Record<string, unknown>;

interface DeploymentOut {
  deploymentId: string;
  siteId: string;
  env: DeployEnv;
  state: SiteState;
  url?: string;
  branch?: string;
  commit?: string;
  at: number;
}

function depOut(r: Row): DeploymentOut {
  const out: DeploymentOut = {
    deploymentId: str(r.id),
    siteId: str(r.site_id),
    env: str(r.env) as DeployEnv,
    state: str(r.state) as SiteState,
    at: num(r.at),
  };
  if (!isNull(r.url)) out.url = str(r.url);
  if (!isNull(r.branch)) out.branch = str(r.branch);
  if (!isNull(r.commit_sha)) out.commit = str(r.commit_sha);
  return out;
}

/** The address of a site's production container when it has no custom domain yet (custom domains are routed by routeProductionDomains). */
export function productionHost(siteId: string, spaceDomain: string): string {
  return `${hexOf(siteId)}.${spaceDomain}`;
}

const MERGE_METHODS: readonly string[] = ["merge", "squash", "rebase"];

// ---- helpers -------------------------------------------------------------------------------------------------

function mustDeployment(ctx: Ctx, siteId: string, deploymentId: string): Row {
  const row = one(ctx, "SELECT * FROM sites_deployment WHERE id = ? AND site_id = ?", deploymentId, siteId);
  if (!row) fail(ctx, "validation.not_found", "That deployment does not exist.");
  return row;
}

/** The production deployment that is serving now: the one with a running container. */
function currentProduction(ctx: Ctx, siteId: string): Row | undefined {
  let best: Row | undefined;
  for (const r of many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ?", siteId, "production")) {
    if (!isNull(r.removed_at) || isNull(r.container_id) || isNull(r.upstream)) continue;
    if (!best || num(r.at) > num(best.at)) best = r;
  }
  return best;
}

function logWarn(ctx: Ctx, msg: string, e: unknown, extra: Record<string, unknown>): void {
  ctx.log.warn(msg, { ...extra, error: e instanceof Error ? e.message : String(e) });
}

async function stopQuietly(ctx: Ctx, d: SiteDrivers, containerId: string): Promise<void> {
  if (!containerId) return;
  try {
    await d.runtime.stop(containerId);
  } catch (e) {
    logWarn(ctx, "sites: container stop failed", e, { containerId });
  }
}

function vaultUse(ctx: Ctx, handle: string): void {
  try {
    ctx.vault.use(handle);
  } catch (e) {
    if (e instanceof VyreErr) throw e;
    fail(ctx, "permission.no_grant", "This site's owner has no grant on that Vault key.", { handle });
  }
}

/** Fill each environment name from its Vault key into a reference for the container. Values never pass through this file. */
async function fillEnv(ctx: Ctx, siteId: string, depId: string): Promise<{ name: string; ref: string }[]> {
  const rows = many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", siteId);
  const refs: { name: string; ref: string }[] = [];
  for (const e of rows) {
    const handle = str(e.vault_handle);
    vaultUse(ctx, handle);
    const ref = `${depId}:${str(e.name)}`;
    await ctx.vault.fill(handle, { kind: "container_env", ref });
    refs.push({ name: str(e.name), ref });
  }
  return refs;
}

function markInjected(ctx: Ctx, siteId: string): void {
  for (const e of many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", siteId)) {
    ctx.db.run("UPDATE sites_env SET injected = ? WHERE site_id = ? AND name = ?", 1, siteId, e.name);
  }
}

function saveRoute(ctx: Ctx, host: string, siteId: string, deploymentId: string): void {
  ctx.db.run("DELETE FROM sites_route WHERE host = ?", host);
  ctx.db.run(
    "INSERT INTO sites_route (host, site_id, deployment_id, env, auth_handle, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    host, siteId, deploymentId, "production", null, ctx.now(),
  );
}

/** `owner/name` from an https, ssh or git@ address of a GitHub repo; null for anything else. */
export function githubRepo(repoUrl: string): string | null {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  return m && m[1] && m[2] ? `${m[1]}/${m[2]}` : null;
}

function unavailable(ctx: Ctx, e: unknown, what: string): never {
  if (e instanceof VyreErr) throw e;
  const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  fail(ctx, "internal.unavailable", `${what} Production was not changed.`, { reason });
}

// ---- promote -------------------------------------------------------------------------------------------------

/** Check the pull request of a build and merge it. Returns what was merged, or null when the build has no pull request. */
async function mergePullRequest(ctx: Ctx, site: Row, dep: Row): Promise<{ number: number; sha: string | null } | null> {
  if (isNull(dep.pr_number) || isNull(site.repo_url)) return null;
  const repo = githubRepo(str(site.repo_url));
  if (!repo) return null;
  const number = num(dep.pr_number);
  const pr = (await ctx.call("github.pull_request.get", { repo, number })) as { pullRequest?: { state?: string } };
  if (pr.pullRequest?.state === "merged") return { number, sha: null };
  if (pr.pullRequest?.state === "closed") fail(ctx, "validation.precondition_failed", "The pull request was closed without merging. Rebuild the preview from a branch that is open.", { number });
  const checks = (await ctx.call("github.pull_request.checks", { repo, number })) as { state?: string };
  if (checks.state === "failing") fail(ctx, "validation.precondition_failed", "A check is failing on the pull request. Fix it before promoting.", { number });
  if (checks.state === "pending") fail(ctx, "validation.precondition_failed", "Checks are still running on the pull request. Promote when they finish.", { number });
  const settings = parseSettings(site.settings);
  const method = typeof settings.mergeMethod === "string" && MERGE_METHODS.includes(settings.mergeMethod) ? settings.mergeMethod : "squash";
  const merged = (await ctx.call("github.pull_request.merge", { idempotencyKey: `sites.promote:${repo}#${number}:merge`, repo, number, method })) as { merged?: boolean; sha?: string };
  if (merged.merged !== true) fail(ctx, "validation.precondition_failed", "The pull request could not be merged.", { number });
  return { number, sha: typeof merged.sha === "string" ? merged.sha : null };
}

function parseSettings(text: unknown): Record<string, unknown> {
  if (typeof text !== "string" || text === "") return {};
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Start the container of a build and route the production host and every custom domain to it. The caller stops the old container afterwards.
 * `apply` writes the new rows once the container runs (before the router is told, so the domains pick the right upstream); `undo` puts the old rows back if routing fails.
 */
async function serve(ctx: Ctx, d: SiteDrivers, site: Row, old: Row | undefined, image: string, rowId: string, apply: (c: { containerId: string; upstream: string }) => void, undo: () => void): Promise<{ containerId: string; upstream: string; host: string }> {
  const siteId = str(site.id);
  const refs = await fillEnv(ctx, siteId, rowId);
  const host = productionHost(siteId, d.spaceDomain);
  let containerId = "";
  let upstream = "";
  try {
    const started = await d.runtime.start({
      siteId, deploymentId: rowId, env: "production", image, network: NETWORK, name: `site-${hexOf(siteId)}-${hexOf(rowId).slice(0, 12)}`,
      envRefs: refs, servicePrincipal: str(site.service_principal),
    });
    containerId = started.containerId;
    upstream = started.upstream;
  } catch (e) {
    return unavailable(ctx, e, "The production container did not start.");
  }
  // the database says the new build serves before the router is told, so the domains pick the right upstream
  apply({ containerId, upstream });
  try {
    await d.router.setRoute({ host, upstream, auth: null });
    saveRoute(ctx, host, siteId, rowId);
    await routeProductionDomains(ctx, siteId);
  } catch (e) {
    undo();
    if (old && !isNull(old.upstream)) {
      try {
        await d.router.setRoute({ host, upstream: str(old.upstream), auth: null });
        saveRoute(ctx, host, siteId, str(old.id));
        await routeProductionDomains(ctx, siteId);
      } catch (e2) {
        logWarn(ctx, "sites: could not restore the old production route", e2, { siteId });
      }
    }
    await stopQuietly(ctx, d, containerId);
    return unavailable(ctx, e, "The production address could not be routed.");
  }
  markInjected(ctx, siteId);
  return { containerId, upstream, host };
}

async function sitesPromote(ctx: Ctx, input: unknown): Promise<{ deployment: DeploymentOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const source = mustDeployment(ctx, siteId, reqStr(ctx, o, "deploymentId"));
  if (source.env === "production") fail(ctx, "validation.precondition_failed", "That build is already on production. Use Roll back to change what production runs.");
  if (!isNull(source.removed_at) && !flag(source.merge_pending)) fail(ctx, "validation.precondition_failed", "That preview was removed. Rebuild it first.");
  if (source.state === "queued" || source.state === "building") fail(ctx, "validation.precondition_failed", "The build is still running. Promote when it finishes.");
  if (source.state === "failed" || isNull(source.image) || str(source.image) === "") fail(ctx, "validation.precondition_failed", "That deployment has no good build to promote.");

  const d = siteDrivers(ctx);
  const old = currentProduction(ctx, siteId);
  if (old) {
    const promo = one(ctx, "SELECT * FROM sites_promotion WHERE production_id = ?", old.id);
    if (promo && promo.source_id === source.id) fail(ctx, "validation.precondition_failed", "That build is already on production.");
  }

  const merged = await mergePullRequest(ctx, site, source);

  const now = ctx.now();
  const prodId = nid(ctx, "dpl");
  const host = productionHost(siteId, d.spaceDomain);
  const oldContainer = old && !isNull(old.container_id) ? str(old.container_id) : "";
  const oldSnapshot: Row | undefined = old ? { ...old } : undefined;
  await serve(ctx, d, site, oldSnapshot, str(source.image), prodId,
    (c) => {
      if (old) ctx.db.run("UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, updated_at = ? WHERE id = ?", "stopped", null, null, null, now, old.id);
      ctx.db.run(
        "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        prodId, siteId, "production", "ready", `https://${host}`, isNull(source.branch) ? defaultBranchOf(site) : str(source.branch), isNull(source.commit_sha) ? null : str(source.commit_sha),
        str(source.image), c.containerId, host, c.upstream, isNull(source.pr_number) ? null : num(source.pr_number), "[]", ctx.principal.id, now, now, null, 0,
      );
      ctx.db.run(
        "INSERT INTO sites_promotion (production_id, site_id, source_id, pr_number, merge_sha, promoted_by, at, rolled_back_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        prodId, siteId, str(source.id), merged ? merged.number : null, merged ? merged.sha : null, ctx.principal.id, now, null,
      );
    },
    () => {
      ctx.db.run("DELETE FROM sites_promotion WHERE production_id = ?", prodId);
      ctx.db.run("DELETE FROM sites_deployment WHERE id = ?", prodId);
      if (oldSnapshot) {
        ctx.db.run(
          "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, updated_at = ? WHERE id = ?",
          oldSnapshot.state ?? "ready", oldSnapshot.url ?? null, oldSnapshot.container_id ?? null, oldSnapshot.upstream ?? null, num(oldSnapshot.updated_at), oldSnapshot.id,
        );
      }
    },
  );
  if (oldContainer) await stopQuietly(ctx, d, oldContainer);
  ctx.db.run("UPDATE sites_site SET state = ?, updated_at = ? WHERE id = ?", "ready", now, siteId);
  touchActivity(ctx.db, siteId, "site.promoted", now);
  ctx.emit("site.promoted", `site/${siteId}`, { siteId, deploymentId: prodId });
  return { deployment: depOut(mustDeployment(ctx, siteId, prodId)) };
}

// ---- rollback ------------------------------------------------------------------------------------------------

async function sitesRollback(ctx: Ctx, input: unknown): Promise<{ deployment: DeploymentOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const wanted = optStr(ctx, o, "toDeploymentId");
  const current = currentProduction(ctx, siteId);
  const history = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ?", siteId, "production")
    .filter((r) => !isNull(r.image) && str(r.image) !== "" && r.state !== "failed");
  if (history.length === 0) fail(ctx, "validation.precondition_failed", "Nothing has been promoted to production yet.");

  let target: Row | undefined;
  if (wanted !== undefined) {
    target = mustDeployment(ctx, siteId, wanted);
    if (target.env !== "production") fail(ctx, "validation.precondition_failed", "Roll back to an earlier production build, not to staging. Promote a staging build instead.");
    if (isNull(target.image) || str(target.image) === "" || target.state === "failed") fail(ctx, "validation.precondition_failed", "That deployment has no good build to restore.");
    if (current && current.id === target.id) fail(ctx, "validation.precondition_failed", "That build is already on production.");
  } else {
    const rolledBack = new Set(many(ctx, "SELECT * FROM sites_promotion WHERE site_id = ?", siteId).filter((p) => !isNull(p.rolled_back_at)).map((p) => str(p.production_id)));
    const candidates = history.filter((r) => (!current || r.id !== current.id) && !rolledBack.has(str(r.id)));
    for (const r of candidates) if (!target || num(r.at) > num(target.at) || (num(r.at) === num(target.at) && str(r.id) > str(target.id))) target = r;
    if (!target) fail(ctx, "validation.precondition_failed", "There is no earlier build to go back to.");
  }

  const d = siteDrivers(ctx);
  const now = ctx.now();
  const targetId = str(target.id);
  const host = productionHost(siteId, d.spaceDomain);
  const targetBefore: Row = { ...target };
  const currentBefore: Row | undefined = current ? { ...current } : undefined;
  const oldContainer = current && !isNull(current.container_id) ? str(current.container_id) : "";
  // the restored build gets a new container; its row keeps its id so Promote history stays true
  await serve(ctx, d, site, currentBefore, str(target.image), targetId,
    (c) => {
      if (current) ctx.db.run("UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, updated_at = ? WHERE id = ?", "stopped", null, null, null, now, current.id);
      ctx.db.run(
        "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, host = ?, upstream = ?, at = ?, updated_at = ? WHERE id = ?",
        "ready", `https://${host}`, c.containerId, host, c.upstream, now, now, targetId,
      );
      if (current) ctx.db.run("UPDATE sites_promotion SET rolled_back_at = ? WHERE production_id = ?", now, current.id);
      ctx.db.run("UPDATE sites_promotion SET rolled_back_at = ? WHERE production_id = ?", null, targetId);
    },
    () => {
      ctx.db.run(
        "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, host = ?, upstream = ?, at = ?, updated_at = ? WHERE id = ?",
        targetBefore.state ?? "stopped", targetBefore.url ?? null, targetBefore.container_id ?? null, targetBefore.host ?? null, targetBefore.upstream ?? null, num(targetBefore.at), num(targetBefore.updated_at), targetId,
      );
      if (currentBefore) {
        ctx.db.run(
          "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, updated_at = ? WHERE id = ?",
          currentBefore.state ?? "ready", currentBefore.url ?? null, currentBefore.container_id ?? null, currentBefore.upstream ?? null, num(currentBefore.updated_at), currentBefore.id,
        );
        ctx.db.run("UPDATE sites_promotion SET rolled_back_at = ? WHERE production_id = ?", null, currentBefore.id);
      }
    },
  );
  if (oldContainer) await stopQuietly(ctx, d, oldContainer);
  ctx.db.run("UPDATE sites_site SET state = ?, updated_at = ? WHERE id = ?", "ready", now, siteId);
  touchActivity(ctx.db, siteId, "site.rolled_back", now);
  ctx.emit("site.rolled_back", `site/${siteId}`, { siteId, toDeploymentId: targetId });
  return { deployment: depOut(mustDeployment(ctx, siteId, targetId)) };
}

export const promoteHandlers = {
  "sites.promote": (ctx: Ctx, input: unknown) => sitesPromote(ctx, input),
  "sites.rollback": (ctx: Ctx, input: unknown) => sitesRollback(ctx, input),
};
