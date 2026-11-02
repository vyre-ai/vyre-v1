// Custom domains on a site (owner, 2 Nov): an agent or a person adds a domain, the answer is the exact DNS records to set, and Caddy on the machine that runs the site gets the route, with automatic TLS.
// Three states, from what is true now: Waiting for DNS, Issuing certificate, Live. A site on a phone address (name.vyre.run) needs a server with a public address for this; sites.host says so.
// @reads ../migrations/0001_sites_core.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import { fail, flag, many, mustSite, one, rec, reqStr, str } from "./deploy.ts";
import { domainEdge, routesHost, targetOfRow } from "./route.ts";
import type { DomainEdge, RouteTarget } from "./route.ts";

export { configureDomainEdge } from "./route.ts";
export type { DomainEdge } from "./route.ts";

type Row = Record<string, unknown>;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export type DomainState = "waiting_dns" | "issuing" | "live";
export interface DnsRecord { type: "CNAME" | "A"; name: string; value: string }

function cleanDomain(ctx: Ctx, raw: string): string {
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN.test(d)) fail(ctx, "validation.bad_input", "That is not a domain name, for example www.example.com.", { field: "domain" });
  const o = routesHost()?.origin();
  if (o && new URL(o.origin).hostname === d) fail(ctx, "validation.bad_input", "That is this Space's own address.", { field: "domain" });
  return d;
}

/** One label under the registered name counts as a subdomain; a bare two-label name is an apex, which takes an A record. */
const isApex = (d: string): boolean => d.split(".").length === 2;

function recordsFor(domain: string, to: { hostname?: string; ip?: string }): DnsRecord[] {
  if (isApex(domain) || !to.hostname) return to.ip ? [{ type: "A", name: domain, value: to.ip }] : [];
  return [{ type: "CNAME", name: domain, value: to.hostname }];
}

const targetOf = targetOfRow;

async function stateOf(target: RouteTarget, domain: string, to: { hostname?: string; ip?: string }): Promise<DomainState> {
  const edge = domainEdge();
  if (!edge || !(await edge.dnsOk(domain, to))) return "waiting_dns";
  return (await edge.certIssued(target, domain)) ? "live" : "issuing";
}

async function need(ctx: Ctx, site: Row): Promise<{ target: RouteTarget; to: { hostname?: string; ip?: string } }> {
  const target = targetOf(site);
  if (target.port === undefined) fail(ctx, "validation.precondition_failed", "Say which port it runs on first. A custom domain points at a running port.");
  const edge = domainEdge();
  const to = edge ? await edge.public(target) : null;
  if (!to) fail(ctx, "validation.precondition_failed", "A custom domain needs a server with a public address. Add a server in Settings, Computers.");
  return { target, to };
}

async function domainAdd(ctx: Ctx, input: unknown): Promise<{ domain: string; records: DnsRecord[]; state: DomainState }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const domain = cleanDomain(ctx, reqStr(ctx, o, "domain"));
  // a custom domain is the public internet, with no sandbox and no sign-in in front of it: only a public site has one, and its route waits for the site to be published through the Gate
  if (site.access !== "public") fail(ctx, "validation.precondition_failed", "A custom domain is public. Make the site public first.");
  const { target, to } = await need(ctx, site);
  if (many(ctx, "SELECT * FROM sites_domain WHERE domain = ?", domain).some((r) => r.site_id !== siteId)) fail(ctx, "validation.duplicate", "Another site already uses that domain.", { domain });
  const now = ctx.now();
  if (!one(ctx, "SELECT * FROM sites_domain WHERE site_id = ? AND domain = ?", siteId, domain)) {
    ctx.db.run("INSERT INTO sites_domain (site_id, domain, dns_ok, certificate, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?)", siteId, domain, 0, "pending", now, now);
  }
  if (flag(site.live)) await (domainEdge() as DomainEdge).setRoute(target, domain, target.port as number);
  touchActivity(ctx.db, siteId, "site.domain_changed", now);
  ctx.emit("site.domain_changed", `site/${siteId}`, { siteId, domain });
  return { domain, records: recordsFor(domain, to), state: await stateOf(target, domain, to) };
}

async function domainCheck(ctx: Ctx, input: unknown): Promise<{ domain: string; records: DnsRecord[]; state: DomainState }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const domain = cleanDomain(ctx, reqStr(ctx, o, "domain"));
  if (!one(ctx, "SELECT * FROM sites_domain WHERE site_id = ? AND domain = ?", site.id, domain)) fail(ctx, "validation.not_found", "That domain is not on this site.");
  const { target, to } = await need(ctx, site);
  return { domain, records: recordsFor(domain, to), state: await stateOf(target, domain, to) };
}

async function domainsGet(ctx: Ctx, input: unknown): Promise<{ domains: { domain: string; dnsOk: boolean; certificate: "pending" | "issued" | "failed" }[] }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  return { domains: many(ctx, "SELECT * FROM sites_domain WHERE site_id = ?", site.id).sort((a, b) => str(a.domain).localeCompare(str(b.domain))).map((r) => ({ domain: str(r.domain), dnsOk: r.dns_ok === 1, certificate: r.certificate === "issued" ? "issued" : r.certificate === "failed" ? "failed" : "pending" })) };
}

async function domainSet(ctx: Ctx, input: unknown): Promise<{ dnsOk: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const domain = cleanDomain(ctx, reqStr(ctx, o, "domain"));
  if (o.remove !== true) { await domainAdd(ctx, input); return { dnsOk: false }; }
  ctx.db.run("DELETE FROM sites_domain WHERE site_id = ? AND domain = ?", siteId, domain);
  const edge = domainEdge();
  if (edge) { try { await edge.removeRoute(targetOf(site), domain); } catch (e) { ctx.log.warn("sites: route removal failed", { domain, error: e instanceof Error ? e.message : String(e) }); } }
  touchActivity(ctx.db, siteId, "site.domain_changed", ctx.now());
  ctx.emit("site.domain_changed", `site/${siteId}`, { siteId, domain });
  return { dnsOk: true };
}

/** Write every live public site's domains again: a computer that restarted has a new container address. The host calls this on a timer. Host call, not a capability. */
export async function refreshDomainRoutes(ctx: Pick<Ctx, "db">, warn: (msg: string, attrs: Record<string, unknown>) => void): Promise<number> {
  const edge = domainEdge();
  if (!edge) return 0;
  let n = 0;
  for (const row of ctx.db.all("SELECT d.domain AS domain, s.computer_id AS computer_id, s.port AS port FROM sites_domain d JOIN sites_site s ON s.id = d.site_id WHERE s.deleted_at IS NULL AND s.live = 1 AND s.access = 'public' AND s.port IS NOT NULL") as Row[]) {
    try { await edge.setRoute(targetOf(row), str(row.domain), Number(row.port)); n++; } catch (e) { warn("sites: a domain route was not refreshed", { domain: str(row.domain), error: e instanceof Error ? e.message : String(e) }); }
  }
  return n;
}

export const domainRouteHandlers = {
  "sites.domain_add": (ctx: Ctx, input: unknown) => domainAdd(ctx, input),
  "sites.domain_check": (ctx: Ctx, input: unknown) => domainCheck(ctx, input),
  "sites.domains_get": (ctx: Ctx, input: unknown) => domainsGet(ctx, input),
  "sites.domain_set": (ctx: Ctx, input: unknown) => domainSet(ctx, input),
};
