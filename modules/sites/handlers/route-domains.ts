// Custom domains on a site (owner, 2 Nov): an agent or a person adds a domain, the answer is the exact DNS records to set, and Caddy on the machine that runs the site gets the route, with automatic TLS.
// Three states, from what is true now: Waiting for DNS, Issuing certificate, Live. A site on a phone address (name.vyre.run) needs a server with a public address for this; sites.host says so.
// @reads ../migrations/0001_sites_core.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import { fail, many, mustSite, one, rec, reqStr, str } from "./deploy.ts";
import { routesHost } from "./route.ts";
import type { RouteTarget } from "./route.ts";

type Row = Record<string, unknown>;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export type DomainState = "waiting_dns" | "issuing" | "live";
export interface DnsRecord { type: "CNAME" | "A"; name: string; value: string }

/** Where a domain's traffic has to land, and what the machine there can say about it. The host builds this from the machine that runs the site. */
export interface DomainEdge {
  /** the machine's public names: a host name for a CNAME, an address for an apex. Null when it has no public address. */
  public(target: RouteTarget): Promise<{ hostname?: string; ip?: string } | null>;
  /** does the domain point at it? */
  dnsOk(domain: string, to: { hostname?: string; ip?: string }): Promise<boolean>;
  setRoute(target: RouteTarget, domain: string, port: number, password: string | null): Promise<void>;
  removeRoute(target: RouteTarget, domain: string): Promise<void>;
  certIssued(target: RouteTarget, domain: string): Promise<boolean>;
}

let edge: DomainEdge | null = null;
export function configureDomainEdge(e: DomainEdge | null): void { edge = e; }

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

const targetOf = (site: Row): RouteTarget => ({ ...(site.computer_id ? { computerId: str(site.computer_id) } : {}), ...(site.port ? { port: Number(site.port) } : {}) });

async function stateOf(target: RouteTarget, domain: string, to: { hostname?: string; ip?: string }): Promise<DomainState> {
  if (!edge || !(await edge.dnsOk(domain, to))) return "waiting_dns";
  return (await edge.certIssued(target, domain)) ? "live" : "issuing";
}

async function need(ctx: Ctx, site: Row): Promise<{ target: RouteTarget; to: { hostname?: string; ip?: string } }> {
  const target = targetOf(site);
  if (target.port === undefined) fail(ctx, "validation.precondition_failed", "Say which port it runs on first. A custom domain points at a running port.");
  const to = edge ? await edge.public(target) : null;
  if (!to) fail(ctx, "validation.precondition_failed", "A custom domain needs a server with a public address. Add a server in Settings, Computers.");
  return { target, to };
}

async function domainAdd(ctx: Ctx, input: unknown): Promise<{ domain: string; records: DnsRecord[]; state: DomainState }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const domain = cleanDomain(ctx, reqStr(ctx, o, "domain"));
  const { target, to } = await need(ctx, site);
  if (many(ctx, "SELECT * FROM sites_domain WHERE domain = ?", domain).some((r) => r.site_id !== siteId)) fail(ctx, "validation.duplicate", "Another site already uses that domain.", { domain });
  const now = ctx.now();
  if (!one(ctx, "SELECT * FROM sites_domain WHERE site_id = ? AND domain = ?", siteId, domain)) {
    ctx.db.run("INSERT INTO sites_domain (site_id, domain, dns_ok, certificate, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?)", siteId, domain, 0, "pending", now, now);
  }
  await (edge as DomainEdge).setRoute(target, domain, target.port as number, null);
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
  if (edge) { try { await edge.removeRoute(targetOf(site), domain); } catch (e) { ctx.log.warn("sites: route removal failed", { domain, error: e instanceof Error ? e.message : String(e) }); } }
  touchActivity(ctx.db, siteId, "site.domain_changed", ctx.now());
  ctx.emit("site.domain_changed", `site/${siteId}`, { siteId, domain });
  return { dnsOk: true };
}

export const domainRouteHandlers = {
  "sites.domain_add": (ctx: Ctx, input: unknown) => domainAdd(ctx, input),
  "sites.domain_check": (ctx: Ctx, input: unknown) => domainCheck(ctx, input),
  "sites.domains_get": (ctx: Ctx, input: unknown) => domainsGet(ctx, input),
  "sites.domain_set": (ctx: Ctx, input: unknown) => domainSet(ctx, input),
};
