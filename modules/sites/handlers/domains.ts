// Site domains: DNS check and Caddy certificate state (spec 2.20). The production host
// stays on the same sealed Vault key as staging until promote ships it.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { CertificateState } from "./deploy.ts";
import { deleteRows, insert, platformOf, raise, republish, requireSite, select, TABLES, update } from "./deploy.ts";

function str(raw: Record<string, string | number | null>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string") throw new Error(`sites column ${key} is not text`);
  return value;
}

function normalize(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

function isDomain(domain: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

async function observe(ctx: Ctx, domain: string): Promise<{ dnsOk: boolean; certificate: CertificateState }> {
  const platform = platformOf(ctx);
  const dnsOk = await platform.dnsCheck(domain);
  let certificate = await platform.certificate(domain);
  if (!dnsOk) certificate = "failed";
  if (certificate !== "pending" && certificate !== "issued" && certificate !== "failed") certificate = "failed";
  return { dnsOk, certificate };
}

async function domainSet(ctx: Ctx, input: { siteId: string; domain: string; remove?: boolean }): Promise<{ dnsOk: boolean }> {
  const site = requireSite(ctx, input.siteId);
  const domain = normalize(input.domain ?? "");
  if (!isDomain(domain)) raise("validation.bad_input", ctx.trace.traceId, "That domain is not a hostname.");
  const cols = ["site_id", "domain", "dns_ok", "certificate"] as const;
  if (input.remove === true) {
    const existing = select(ctx.db, TABLES.domain, cols, { site_id: site.site_id, domain })[0];
    if (!existing) raise("validation.not_found", ctx.trace.traceId, "That domain is not on the site.");
    const dnsOk = existing.dns_ok === 1;
    deleteRows(ctx.db, TABLES.domain, { site_id: site.site_id, domain });
    const rest = select(ctx.db, TABLES.domain, cols, { site_id: site.site_id });
    const first = rest[0];
    update(ctx.db, TABLES.site, { production_url: first ? `https://${str(first, "domain")}` : null }, { site_id: site.site_id, deleted: 0 });
    await republish(ctx, site.site_id, [domain]);
    ctx.emit("site.domain_changed", `site/${site.site_id}`, { siteId: site.site_id, domain });
    return { dnsOk };
  }
  const seen = await observe(ctx, domain);
  deleteRows(ctx.db, TABLES.domain, { site_id: site.site_id, domain });
  insert(ctx.db, TABLES.domain, { site_id: site.site_id, domain, dns_ok: seen.dnsOk ? 1 : 0, certificate: seen.certificate });
  if (!site.production_url) update(ctx.db, TABLES.site, { production_url: `https://${domain}` }, { site_id: site.site_id, deleted: 0 });
  await republish(ctx, site.site_id);
  ctx.emit("site.domain_changed", `site/${site.site_id}`, { siteId: site.site_id, domain });
  return { dnsOk: seen.dnsOk };
}

async function domainsGet(ctx: Ctx, input: { siteId: string }): Promise<{ domains: { domain: string; dnsOk: boolean; certificate: CertificateState }[] }> {
  const site = requireSite(ctx, input.siteId);
  const rows = select(ctx.db, TABLES.domain, ["site_id", "domain", "dns_ok", "certificate"], { site_id: site.site_id });
  const domains: { domain: string; dnsOk: boolean; certificate: CertificateState }[] = [];
  for (const row of rows) {
    const domain = str(row, "domain");
    const seen = await observe(ctx, domain);
    update(ctx.db, TABLES.domain, { dns_ok: seen.dnsOk ? 1 : 0, certificate: seen.certificate }, { site_id: site.site_id, domain });
    domains.push({ domain, dnsOk: seen.dnsOk, certificate: seen.certificate });
  }
  return { domains };
}

export const domainHandlers = {
  "sites.domain_set": domainSet,
  "sites.domains_get": domainsGet,
};
