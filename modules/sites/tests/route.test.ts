// A site is a route: what each capability does on the module's own tables, with the host faked. The gateway and a real browser are covered by host/src/routes/public-path.test.ts, golden flow 6 and test/public-path.heavy.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../../../generated/registry.ts";
import { configureRoutes, routeBySlug, routeByTicket } from "../handlers/route.ts";
import { configureDomainEdge } from "../handlers/route-domains.ts";
import { handlers } from "../impl.ts";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { harness as base } from "../fixtures/world.ts";

/** The module's world on a real database: these handlers read their own tables with real SQL. */
function harness() {
  const w = base();
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_sites_core.sql", "0002_promote_tables.sql", "0003_routes.sql"]) db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const ctx = { ...w.ctx, db: { all: (sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])), run: (sql: string, ...a: unknown[]) => ({ changes: Number(db.prepare(sql).run(...(a as never[])).changes) }) }, call: async () => ({}) };
  return { ...w, ctx };
}

const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>;
const host = (over: Record<string, unknown> = {}) => ({ origin: () => ({ origin: "https://harbor.vyre.run", relay: true }), probe: async () => ({ answering: true }), ...over });

test("the manifest: going public is held for an agent and a person's press is their yes; reads do not write", () => {
  const cap = (n: string) => registry.capabilities.find((c) => c.name === n) as unknown as { gate?: { act: string; when?: string }; effects: string };
  assert.deepEqual(cap("sites.promote").gate, { act: "site_promote", when: "actor.kind != 'person'" });
  assert.equal(cap("sites.promote").effects, "outward");
  for (const n of ["sites.status", "sites.host", "sites.domain_check"]) assert.equal(cap(n).effects, "read", n);
});

test("what stays dormant refuses, and what ships answers", async () => {
  for (const n of ["sites.build", "sites.deploy", "sites.previews", "sites.rollback", "sites.table_create", "sites.env_set"]) await assert.rejects(async () => h[n]!({ trace: { traceId: "0" } }, {}), /Not in this version yet|unavailable/i, n);
});

test("a site: created with a free name, not live, reachable by slug once published, and stop takes it down", async () => {
  const w = harness();
  configureRoutes(host() as never);
  try {
    const made = await h["sites.create"]!(w.ctx, { name: "Acme Shop", computerId: undefined, port: 3000 });
    assert.equal(made.site.slug, "acme-shop");
    assert.equal(made.site.live, false);
    assert.equal(made.site.access, "public");
    const second = await h["sites.create"]!(w.ctx, { name: "Acme Shop", port: 3001 });
    assert.equal(second.site.slug, "acme-shop-2");
    assert.equal(routeBySlug(w.ctx, "acme-shop")?.live, false);
    const up = await h["sites.promote"]!(w.ctx, { siteId: made.site.siteId });
    assert.equal(up.site.url, "https://harbor.vyre.run/p/acme-shop");
    assert.equal(routeBySlug(w.ctx, "acme-shop")?.live, true);
    await h["sites.stop"]!(w.ctx, { siteId: made.site.siteId });
    assert.equal(routeBySlug(w.ctx, "acme-shop")?.live, false);
  } finally { configureRoutes(null); }
});

test("a live site made public comes down until it is published again; the ports Vyre itself uses are refused; forms is not a name", async () => {
  const w = harness();
  configureRoutes(host() as never);
  try {
    const made = await h["sites.create"]!(w.ctx, { name: "Team", access: "space", port: 3000 });
    await h["sites.publish"]!(w.ctx, { siteId: made.site.siteId });
    const open = await h["sites.update"]!(w.ctx, { siteId: made.site.siteId, access: "public" });
    assert.equal(open.site.live, false);
    await assert.rejects(() => h["sites.publish"]!(w.ctx, { siteId: made.site.siteId }), /held for approval/);
    await assert.rejects(() => h["sites.create"]!(w.ctx, { name: "x", port: 8420 }), /cannot be served/);
    assert.notEqual((await h["sites.create"]!(w.ctx, { name: "Forms", port: 3000 })).site.slug, "forms");
  } finally { configureRoutes(null); }
});

test("status: a target that does not answer says why; a folder needs no port; a site with no target cannot go live", async () => {
  const w = harness();
  configureRoutes(host({ probe: async () => ({ answering: false, detail: "Nothing is listening on port 3000." }) }) as never);
  try {
    const made = await h["sites.create"]!(w.ctx, { name: "Down", port: 3000 });
    const s = await h["sites.status"]!(w.ctx, { siteId: made.site.siteId });
    assert.equal(s.answering, false);
    assert.match(s.detail, /Nothing is listening/);
    const none = await h["sites.create"]!(w.ctx, { name: "Empty" });
    await assert.rejects(() => h["sites.promote"]!(w.ctx, { siteId: none.site.siteId }), /Say where it runs/);
  } finally { configureRoutes(null); }
});

test("custom domains: the records are exact, an apex takes an A, the three states follow what is true, and no public address says what is needed", async () => {
  const w = harness();
  configureRoutes(host() as never);
  let dns = false, cert = false;
  const routes: string[] = [];
  configureDomainEdge({
    public: async () => ({ hostname: "team.example.com", ip: "203.0.113.5" }), dnsOk: async () => dns, certIssued: async () => cert,
    setRoute: async (_t, d, p) => { routes.push(`${d}:${p}`); }, removeRoute: async () => undefined,
  });
  try {
    const made = await h["sites.create"]!(w.ctx, { name: "Shop", port: 3000 });
    const siteId = made.site.siteId;
    const a = await h["sites.domain_add"]!(w.ctx, { siteId, domain: "shop.example.org" });
    assert.deepEqual(a.records, [{ type: "CNAME", name: "shop.example.org", value: "team.example.com" }]);
    assert.equal(a.state, "waiting_dns");
    assert.deepEqual(routes, ["shop.example.org:3000"]);
    assert.deepEqual((await h["sites.domain_add"]!(w.ctx, { siteId, domain: "example.org" })).records, [{ type: "A", name: "example.org", value: "203.0.113.5" }]);
    dns = true;
    assert.equal((await h["sites.domain_check"]!(w.ctx, { siteId, domain: "shop.example.org" })).state, "issuing");
    cert = true;
    assert.equal((await h["sites.domain_check"]!(w.ctx, { siteId, domain: "shop.example.org" })).state, "live");
    configureDomainEdge({ public: async () => null, dnsOk: async () => false, certIssued: async () => false, setRoute: async () => undefined, removeRoute: async () => undefined });
    await assert.rejects(() => h["sites.domain_add"]!(w.ctx, { siteId, domain: "other.example.org" }), /needs a server with a public address/);
  } finally { configureRoutes(null); configureDomainEdge(null); }
});

test("a ticket opens one artifact, for its person, until it ends", async () => {
  const w = harness();
  configureRoutes(host() as never);
  try {
    const made = await h["sites.create"]!(w.ctx, { name: "Numbers", kind: "artifact", port: 3000 });
    await h["sites.publish"]!(w.ctx, { siteId: made.site.siteId });
    const open = await h["sites.artifact_open"]!(w.ctx, { artifactId: made.site.siteId });
    const token = /\/k\/([0-9a-f]{48})\//.exec(open.path)?.[1] as string;
    const now = w.ctx.now();
    assert.equal((await routeByTicket(w.ctx, made.site.siteId, token, now))?.principal, w.ctx.principal.id);
    assert.equal(await routeByTicket(w.ctx, "sit_other", token, now), null, "for this artifact only");
    assert.equal(await routeByTicket(w.ctx, made.site.siteId, "0".repeat(48), now), null);
    assert.equal(await routeByTicket(w.ctx, made.site.siteId, token, open.expiresAt + 1), null, "until it ends");
    await assert.rejects(() => h["sites.artifact_open"]!({ ...w.ctx, principal: { kind: "agent", id: "agt_x" } }, { artifactId: made.site.siteId }), /Only a person/);
  } finally { configureRoutes(null); }
});
