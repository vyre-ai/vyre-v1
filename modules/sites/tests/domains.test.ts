// @reads /modules/sites/migrations/0001_init.sql
// Site Settings > Domains: the DNS check and the Caddy certificate state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { testCtx } from "../fixtures/ctx.ts";
import { seed } from "../fixtures/seed.ts";
import { deployHandlers, NETWORK, siteContainer } from "../handlers/deploy.ts";
import { domainHandlers } from "../handlers/domains.ts";

const { "sites.create": createSite, "sites.staging_password_set": sealStaging } = deployHandlers;
const { "sites.domain_set": domainSet, "sites.domains_get": domainsGet } = domainHandlers;

type World = ReturnType<typeof testCtx>;

let seq = 0;

async function makeSite(world: World): Promise<{ siteId: string }> {
  seq += 1;
  const created = await createSite(world.ctx, { name: "Domains", kind: "site", idempotencyKey: `dom-${seq}` });
  await sealStaging(world.ctx, { siteId: created.site.siteId, vaultHandle: "#Staging" });
  return created.site;
}

async function rejects(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof VyreErr);
    assert.equal(err.error.code, code);
    return true;
  });
}

test("the migration records certificate state for each domain", () => {
  assert.equal(seed.table, "sites_site");
  const migration = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS sites_domain"), true);
  assert.equal(migration.includes("certificate"), true);
  assert.equal(migration.includes("dns_ok"), true);
});

test("domains get reports an issued certificate when DNS answers", async () => {
  const world = testCtx();
  const site = await makeSite(world);
  world.platform.dns.set("app.example.com", true);
  world.platform.certs.set("app.example.com", "issued");
  const set = await domainSet(world.ctx, { siteId: site.siteId, domain: "App.Example.com." });
  assert.equal(set.dnsOk, true);
  const got = await domainsGet(world.ctx, { siteId: site.siteId });
  assert.deepEqual(got.domains, [{ domain: "app.example.com", dnsOk: true, certificate: "issued" }]);
  const route = world.platform.routes.find((row) => row.host === "app.example.com");
  assert.ok(route);
  assert.equal(route.network, NETWORK);
  assert.equal(route.upstream, siteContainer(site.siteId));
  assert.deepEqual(route.auth, { sealed: true, vaultHandle: "#Staging" });
  assert.equal(world.events.some((event) => event.name === "site.domain_changed"), true);

  world.platform.certs.set("app.example.com", "failed");
  const again = await domainsGet(world.ctx, { siteId: site.siteId });
  assert.deepEqual(again.domains, [{ domain: "app.example.com", dnsOk: true, certificate: "failed" }]);
});

test("a domain with DNS and no certificate yet stays pending", async () => {
  const world = testCtx();
  const site = await makeSite(world);
  world.platform.dns.set("wait.example.com", true);
  const set = await domainSet(world.ctx, { siteId: site.siteId, domain: "wait.example.com" });
  assert.equal(set.dnsOk, true);
  const got = await domainsGet(world.ctx, { siteId: site.siteId });
  assert.deepEqual(got.domains, [{ domain: "wait.example.com", dnsOk: true, certificate: "pending" }]);
});

test("a failing DNS check forces the certificate to failed", async () => {
  const world = testCtx();
  const site = await makeSite(world);
  world.platform.dns.set("bad.example.com", false);
  world.platform.certs.set("bad.example.com", "issued");
  const set = await domainSet(world.ctx, { siteId: site.siteId, domain: "bad.example.com" });
  assert.equal(set.dnsOk, false);
  const got = await domainsGet(world.ctx, { siteId: site.siteId });
  assert.deepEqual(got.domains, [{ domain: "bad.example.com", dnsOk: false, certificate: "failed" }]);
});

test("removing a domain drops its route and keeps the last DNS result", async () => {
  const world = testCtx();
  const site = await makeSite(world);
  world.platform.dns.set("app.example.com", true);
  world.platform.certs.set("app.example.com", "issued");
  await domainSet(world.ctx, { siteId: site.siteId, domain: "app.example.com" });
  const removed = await domainSet(world.ctx, { siteId: site.siteId, domain: "app.example.com", remove: true });
  assert.equal(removed.dnsOk, true);
  const got = await domainsGet(world.ctx, { siteId: site.siteId });
  assert.deepEqual(got.domains, []);
  assert.equal(world.platform.routes.some((row) => row.host === "app.example.com"), false);
});

test("a value that is not a hostname is rejected", async () => {
  const world = testCtx();
  const site = await makeSite(world);
  await rejects(() => domainSet(world.ctx, { siteId: site.siteId, domain: "not a host" }), "validation.bad_input");
  assert.equal(world.events.some((event) => event.name === "site.domain_changed"), false);
});
