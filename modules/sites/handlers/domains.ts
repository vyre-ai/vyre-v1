// sites domains: add or remove a site domain, the DNS check and the Caddy certificate state (spec 2.20 Permissions and domains; ARCH 7.6).
// Site Settings > Domains reads domains_get: dnsOk comes from the DNS driver, the certificate state from Caddy (pending, issued, failed).
// A domain is routed to the production container once a production deployment exists (Promote, P-L8_02, calls routeProductionDomains).
// @reads ../migrations/0001_sites_core.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import type { CertState, SiteDrivers } from "./deploy.ts";
import { fail, flag, isNull, many, mustSite, num, rec, reqStr, optBool, siteDrivers, str } from "./deploy.ts";

type Row = Record<string, unknown>;

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** What a customer points the domain at: the Space edge, a CNAME target under the Space domain. */
export function edgeTarget(spaceDomain: string): string {
  return `edge.${spaceDomain}`;
}

function cleanDomain(ctx: Ctx, raw: string, spaceDomain: string): string {
  const domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN.test(domain)) fail(ctx, "validation.bad_input", "That is not a domain name, for example www.example.com.", { field: "domain" });
  if (domain === spaceDomain || domain.endsWith(`.${spaceDomain}`)) {
    fail(ctx, "validation.bad_input", "Addresses under the Space domain are managed by Vyre.", { field: "domain" });
  }
  return domain;
}

function certOf(v: unknown): CertState {
  return v === "issued" || v === "failed" ? v : "pending";
}

function productionRow(ctx: Ctx, siteId: string): Row | undefined {
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND removed_at IS NULL", siteId, "production")
    .filter((r) => !isNull(r.upstream) && !isNull(r.container_id));
  let best: Row | undefined;
  for (const r of rows) if (!best || num(r.at) > num(best.at)) best = r;
  return best;
}

async function routeDomain(ctx: Ctx, d: SiteDrivers, siteId: string, domain: string, prod: Row): Promise<void> {
  await d.router.setRoute({ host: domain, upstream: str(prod.upstream), auth: null });
  ctx.db.run("DELETE FROM sites_route WHERE host = ?", domain);
  ctx.db.run(
    "INSERT INTO sites_route (host, site_id, deployment_id, env, auth_handle, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    domain, siteId, prod.id, "production", null, ctx.now(),
  );
}

/** Point every domain of the site at its production container. Promote and rollback call this after the production deployment changes. */
export async function routeProductionDomains(ctx: Ctx, siteId: string): Promise<number> {
  const prod = productionRow(ctx, siteId);
  if (!prod) return 0;
  const d = siteDrivers(ctx);
  const domains = many(ctx, "SELECT * FROM sites_domain WHERE site_id = ?", siteId);
  for (const dom of domains) await routeDomain(ctx, d, siteId, str(dom.domain), prod);
  return domains.length;
}

async function domainsGet(ctx: Ctx, input: unknown): Promise<{ domains: { domain: string; dnsOk: boolean; certificate: CertState }[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const rows = many(ctx, "SELECT * FROM sites_domain WHERE site_id = ?", site.id).sort((a, b) => str(a.domain).localeCompare(str(b.domain)));
  if (rows.length === 0) return { domains: [] };
  const d = siteDrivers(ctx);
  const out: { domain: string; dnsOk: boolean; certificate: CertState }[] = [];
  for (const r of rows) {
    const domain = str(r.domain);
    let dnsOk = flag(r.dns_ok);
    let certificate = certOf(r.certificate);
    try {
      dnsOk = await d.dns.check(domain, edgeTarget(d.spaceDomain));
    } catch (e) {
      ctx.log.warn("sites: dns check failed", { domain, error: e instanceof Error ? e.message : String(e) });
      dnsOk = false;
    }
    try {
      certificate = await d.router.certState(domain);
    } catch (e) {
      ctx.log.warn("sites: certificate state unavailable", { domain, error: e instanceof Error ? e.message : String(e) });
    }
    ctx.db.run("UPDATE sites_domain SET dns_ok = ?, certificate = ?, checked_at = ? WHERE site_id = ? AND domain = ?", dnsOk ? 1 : 0, certificate, ctx.now(), site.id, domain);
    out.push({ domain, dnsOk, certificate });
  }
  return { domains: out };
}

async function domainSet(ctx: Ctx, input: unknown): Promise<{ dnsOk: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const d = siteDrivers(ctx);
  const domain = cleanDomain(ctx, reqStr(ctx, o, "domain"), d.spaceDomain);
  const remove = optBool(ctx, o, "remove") === true;
  const existing = many(ctx, "SELECT * FROM sites_domain WHERE domain = ?", domain);
  const mine = existing.find((r) => r.site_id === siteId);

  if (remove) {
    if (!mine) fail(ctx, "validation.not_found", "That domain is not on this site.");
    ctx.db.run("DELETE FROM sites_domain WHERE site_id = ? AND domain = ?", siteId, domain);
    try {
      await d.router.removeRoute(domain);
    } catch (e) {
      ctx.log.warn("sites: route removal failed", { domain, error: e instanceof Error ? e.message : String(e) });
    }
    ctx.db.run("DELETE FROM sites_route WHERE host = ?", domain);
    touchActivity(ctx.db, siteId, "site.domain_changed", ctx.now());
    ctx.emit("site.domain_changed", `site/${siteId}`, { siteId, domain });
    return { dnsOk: true };
  }

  if (existing.some((r) => r.site_id !== siteId)) fail(ctx, "validation.duplicate", "Another site already uses that domain.", { domain });

  let dnsOk = false;
  try {
    dnsOk = await d.dns.check(domain, edgeTarget(d.spaceDomain));
  } catch (e) {
    ctx.log.warn("sites: dns check failed", { domain, error: e instanceof Error ? e.message : String(e) });
  }
  const now = ctx.now();
  if (mine) {
    ctx.db.run("UPDATE sites_domain SET dns_ok = ?, checked_at = ? WHERE site_id = ? AND domain = ?", dnsOk ? 1 : 0, now, siteId, domain);
    return { dnsOk };
  }
  ctx.db.run(
    "INSERT INTO sites_domain (site_id, domain, dns_ok, certificate, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
    siteId, domain, dnsOk ? 1 : 0, "pending", now, now,
  );
  const prod = productionRow(ctx, siteId);
  if (prod) await routeDomain(ctx, d, siteId, domain, prod);
  touchActivity(ctx.db, siteId, "site.domain_changed", now);
  ctx.emit("site.domain_changed", `site/${siteId}`, { siteId, domain });
  return { dnsOk };
}

export const domainHandlers = {
  "sites.domains_get": (ctx: Ctx, input: unknown) => domainsGet(ctx, input),
  "sites.domain_set": (ctx: Ctx, input: unknown) => domainSet(ctx, input),
};
