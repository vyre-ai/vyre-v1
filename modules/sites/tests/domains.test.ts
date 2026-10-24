// sites domains: the DNS check and the Caddy certificate state (spec 2.20, Site Settings > Domains).
// @reads /modules/sites/migrations/0001_sites_core.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureSites } from "../handlers/deploy.ts";
import { edgeTarget } from "../handlers/domains.ts";
import { handlers, routeProductionDomains } from "../impl.ts";
import { SPACE_DOMAIN } from "../fixtures/fakes.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
type Row = Record<string, unknown>;

async function run<T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> {
  return (await (handlers[cap] as Fn)(ctx, input)) as T;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

async function newSite(w: World, name = "Harbor"): Promise<string> {
  const out = await run<{ site: { siteId: string } }>(w.ctx, "sites.create", { name, kind: "site", idempotencyKey: `k-${name}` });
  return out.site.siteId;
}

function setDomain(w: World, siteId: string, domain: string, remove?: boolean): Promise<{ dnsOk: boolean }> {
  return run(w.ctx, "sites.domain_set", remove === undefined ? { siteId, domain } : { siteId, domain, remove });
}

function addProduction(w: World, siteId: string, id: string, upstream: string, at: number): void {
  w.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, siteId, "production", "ready", null, "main", "abc123", "img", `ctr_${id}`, null, upstream, null, "[]", "usr_owner", at, at, null, 0,
  );
}

test("domain_set: adds a domain, checks DNS against the Space edge, emits site.domain_changed once", async () => {
  const w = harness();
  const siteId = await newSite(w);
  assert.deepEqual(await setDomain(w, siteId, "www.example.com"), { dnsOk: false });
  assert.deepEqual(w.dns.checks, [{ domain: "www.example.com", target: `edge.${SPACE_DOMAIN}` }]);
  assert.equal(edgeTarget(SPACE_DOMAIN), `edge.${SPACE_DOMAIN}`);
  assert.deepEqual(w.db.rows("sites_domain").map((r) => [r.site_id, r.domain, r.dns_ok, r.certificate]), [[siteId, "www.example.com", 0, "pending"]]);
  assert.deepEqual(w.events.filter((e) => e.name === "site.domain_changed"), [{ name: "site.domain_changed", subject: `site/${siteId}`, payload: { siteId, domain: "www.example.com" } }]);
  assert.equal(w.router.routes.size, 0);   // nothing is in production yet

  // DNS arrives; adding the same domain again refreshes the check and adds nothing
  w.dns.good.add("www.example.com");
  assert.deepEqual(await setDomain(w, siteId, "www.example.com"), { dnsOk: true });
  assert.equal(w.db.rows("sites_domain").length, 1);
  assert.equal(w.db.rows("sites_domain")[0]?.dns_ok, 1);
  assert.equal(w.events.filter((e) => e.name === "site.domain_changed").length, 1);
});

test("domain_set: normalizes the name and refuses names that are not domains or belong to the Space", async () => {
  const w = harness();
  const siteId = await newSite(w);
  await setDomain(w, siteId, "  WWW.Example.COM.  ");
  assert.equal(w.db.rows("sites_domain")[0]?.domain, "www.example.com");
  for (const bad of ["localhost", "a_b.example.com", "http://example.com", "no spaces.example.com", "-x.example.com", "example", "", "1.2.3.4", SPACE_DOMAIN, `shop.${SPACE_DOMAIN}`]) {
    assert.equal(await code(setDomain(w, siteId, bad)), "validation.bad_input", `domain "${bad}"`);
  }
  assert.equal(w.db.rows("sites_domain").length, 1);
});

test("domain_set: a domain belongs to one site", async () => {
  const w = harness();
  const a = await newSite(w, "A");
  const b = await newSite(w, "B");
  await setDomain(w, a, "shop.example.com");
  assert.equal(await code(setDomain(w, b, "shop.example.com")), "validation.duplicate");
  assert.equal(await code(setDomain(w, b, "SHOP.example.com")), "validation.duplicate");
  await setDomain(w, b, "other.example.com");
  assert.equal(w.db.rows("sites_domain").length, 2);
  assert.equal(await code(run(w.ctx, "sites.domain_set", { siteId: "sit_missing", domain: "x.example.com" })), "validation.not_found");
});

test("domains_get: DNS check and certificate state per domain, persisted", async () => {
  const w = harness();
  const siteId = await newSite(w);
  await setDomain(w, siteId, "b.example.com");
  await setDomain(w, siteId, "a.example.com");
  await setDomain(w, siteId, "c.example.com");
  w.dns.good.add("a.example.com");
  w.router.certs.set("a.example.com", "issued");
  w.router.certs.set("b.example.com", "failed");
  const got = await run<{ domains: { domain: string; dnsOk: boolean; certificate: string }[] }>(w.ctx, "sites.domains_get", { siteId });
  assert.deepEqual(got.domains, [
    { domain: "a.example.com", dnsOk: true, certificate: "issued" },
    { domain: "b.example.com", dnsOk: false, certificate: "failed" },
    { domain: "c.example.com", dnsOk: false, certificate: "pending" },
  ]);
  const stored = Object.fromEntries(w.db.rows("sites_domain").map((r) => [String(r.domain), [r.dns_ok, r.certificate]]));
  assert.deepEqual(stored, { "a.example.com": [1, "issued"], "b.example.com": [0, "failed"], "c.example.com": [0, "pending"] });

  // the state moves: c gets DNS and a certificate, a loses DNS
  w.dns.good.delete("a.example.com");
  w.dns.good.add("c.example.com");
  w.router.certs.set("c.example.com", "issued");
  const next = await run<{ domains: { domain: string; dnsOk: boolean; certificate: string }[] }>(w.ctx, "sites.domains_get", { siteId });
  assert.deepEqual(next.domains.map((d) => [d.domain, d.dnsOk, d.certificate]), [["a.example.com", false, "issued"], ["b.example.com", false, "failed"], ["c.example.com", true, "issued"]]);
});

test("domains_get: a driver that fails reports DNS as not ok and keeps the last certificate state", async () => {
  const w = harness();
  const siteId = await newSite(w);
  await setDomain(w, siteId, "a.example.com");
  w.router.certs.set("a.example.com", "issued");
  await run(w.ctx, "sites.domains_get", { siteId });
  w.dns.check = async () => { throw new Error("resolver timeout"); };
  w.router.certState = async () => { throw new Error("caddy admin api refused"); };
  const got = await run<{ domains: { domain: string; dnsOk: boolean; certificate: string }[] }>(w.ctx, "sites.domains_get", { siteId });
  assert.deepEqual(got.domains, [{ domain: "a.example.com", dnsOk: false, certificate: "issued" }]);
  assert.equal(w.warnings.length >= 2, true);
});

test("domains_get: a site without domains needs no drivers; domain_set without drivers is a precondition", async () => {
  const w = harness();
  const siteId = await newSite(w);
  configureSites(null);
  assert.deepEqual(await run(w.ctx, "sites.domains_get", { siteId }), { domains: [] });
  assert.equal(await code(setDomain(w, siteId, "a.example.com")), "validation.precondition_failed");
});

test("production: a domain added after promote is routed to the production container without a password", async () => {
  const w = harness();
  const siteId = await newSite(w);
  addProduction(w, siteId, "dpl_old", "site-x-old:3000", 100);
  addProduction(w, siteId, "dpl_new", "site-x-new:3000", 200);
  await setDomain(w, siteId, "www.example.com");
  assert.deepEqual(w.router.routes.get("www.example.com"), { host: "www.example.com", upstream: "site-x-new:3000", auth: null });
  assert.deepEqual(w.db.rows("sites_route").map((r) => [r.host, r.deployment_id, r.env, r.auth_handle]), [["www.example.com", "dpl_new", "production", null]]);
});

test("production: routeProductionDomains re-points every domain after the production build changes", async () => {
  const w = harness();
  const siteId = await newSite(w);
  assert.equal(await routeProductionDomains(w.ctx, siteId), 0);   // no production yet
  await setDomain(w, siteId, "a.example.com");
  await setDomain(w, siteId, "b.example.com");
  assert.equal(await routeProductionDomains(w.ctx, siteId), 0);
  addProduction(w, siteId, "dpl_p1", "site-x-p1:3000", 100);
  assert.equal(await routeProductionDomains(w.ctx, siteId), 2);
  assert.deepEqual([...w.router.routes.values()].map((r) => r.upstream), ["site-x-p1:3000", "site-x-p1:3000"]);
  addProduction(w, siteId, "dpl_p2", "site-x-p2:3000", 300);
  assert.equal(await routeProductionDomains(w.ctx, siteId), 2);
  assert.deepEqual([...w.router.routes.values()].map((r) => r.upstream), ["site-x-p2:3000", "site-x-p2:3000"]);
  assert.equal(w.db.rows("sites_route").length, 2);
  assert.equal(w.db.rows("sites_route").every((r) => r.deployment_id === "dpl_p2" && r.auth_handle === null), true);
});

test("domain_set remove: drops the row and the route, emits the event; an unknown domain is not_found", async () => {
  const w = harness();
  const siteId = await newSite(w);
  addProduction(w, siteId, "dpl_p1", "site-x-p1:3000", 100);
  await setDomain(w, siteId, "www.example.com");
  assert.equal(w.router.routes.has("www.example.com"), true);
  assert.deepEqual(await setDomain(w, siteId, "www.example.com", true), { dnsOk: true });
  assert.equal(w.router.routes.has("www.example.com"), false);
  assert.equal(w.db.rows("sites_domain").length, 0);
  assert.equal(w.db.rows("sites_route").length, 0);
  assert.equal(w.events.filter((e) => e.name === "site.domain_changed").length, 2);
  assert.equal(await code(setDomain(w, siteId, "www.example.com", true)), "validation.not_found");
  const other = await newSite(w, "Other");
  await setDomain(w, other, "x.example.com");
  assert.equal(await code(setDomain(w, siteId, "x.example.com", true)), "validation.not_found");
  assert.equal(w.db.rows("sites_domain").length, 1);
  const row = w.db.rows("sites_domain")[0] as Row;
  assert.equal(row.site_id, other);
});
