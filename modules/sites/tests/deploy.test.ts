// @reads /modules/sites/migrations/0001_init.sql
// Staging stays behind a sealed Vault handle. A preview is one per branch and leaves on merge.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { testCtx } from "../fixtures/ctx.ts";
import { memoryDb } from "../fixtures/memory-db.ts";
import { seed } from "../fixtures/seed.ts";
import {
  deployHandlers,
  hostFromUrl,
  NETWORK,
  previewContainer,
  previewHost,
  republish,
  select,
  stagingHost,
  TABLES,
  update as writeRow,
} from "../handlers/deploy.ts";
import { coreHandlers } from "../handlers/index.ts";
import { handlers } from "../impl.ts";
import { applySiteEvent, consumers, emptyView } from "../projections.ts";

const {
  "sites.create": createSite,
  "sites.build": buildSite,
  "sites.deploy": deploySite,
  "sites.env_set": envSet,
  "sites.env_list": envList,
  "sites.staging_password_set": sealStaging,
  "sites.service_identity": serviceIdentity,
  "sites.preview_rebuild": previewRebuild,
  "sites.previews": listPreviews,
  "sites.update": updateSite,
} = deployHandlers;

type World = ReturnType<typeof testCtx>;

let seq = 0;

function bind(world: World): void {
  world.dispatch.fn = async (cap, input) => {
    const table = handlers as Record<string, (ctx: World["ctx"], input: unknown) => Promise<unknown>>;
    const fn = table[cap];
    if (!fn) throw new Error(`missing ${cap}`);
    return fn(world.ctx, input);
  };
}

async function makeSite(world: World, name = "Harbor"): Promise<{ siteId: string }> {
  seq += 1;
  const created = await createSite(world.ctx, { name, kind: "site", idempotencyKey: `idem-${seq}` });
  return created.site;
}

async function rejects(run: () => Promise<unknown>, code: string): Promise<VyreErr> {
  let caught: VyreErr | null = null;
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof VyreErr);
    assert.equal(err.error.code, code);
    caught = err;
    return true;
  });
  if (!caught) throw new Error("expected a rejection");
  return caught;
}

function routeSealed(world: World, host: string): boolean {
  const route = world.platform.routes.find((row) => row.host === host);
  if (!route || route.auth.sealed !== true) return false;
  return route.auth.vaultHandle === "#Staging" && route.network === NETWORK;
}

test("memory db rejects sql outside the handler shape", () => {
  const db = memoryDb();
  assert.throws(() => db.run("DROP TABLE sites_site"), /unsupported sql/);
});

test("the module seed points at sites_site and the migration is sealed storage", () => {
  assert.equal(seed.table, "sites_site");
  assert.deepEqual(seed.rows, []);
  const migration = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS sites_site"), true);
  assert.equal(migration.includes("staging_seal"), true);
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS sites_domain"), true);
  assert.equal(migration.includes("certificate"), true);
});

test("the handler barrel is the impl the host loads", () => {
  assert.equal(coreHandlers["sites.deploy"], deployHandlers["sites.deploy"]);
  assert.equal(handlers["sites.deploy"], deployHandlers["sites.deploy"]);
  assert.equal(handlers["sites.domain_set"], coreHandlers["sites.domain_set"]);
});

test("a site container joins vyre-sites and the service identity stays at the owner cap", async () => {
  const world = testCtx({ maxLevel: "use" });
  const site = await makeSite(world, "Harbor");
  const built = await buildSite(world.ctx, { siteId: site.siteId });
  assert.equal(built.deploymentId.startsWith("dpl_"), true);
  assert.equal(world.platform.networks.includes(NETWORK), true);
  const box = world.platform.containers.find((row) => row.name === `vyre-site-${site.siteId}`);
  assert.ok(box);
  assert.equal(box.network, NETWORK);
  assert.equal(box.running, true);
  assert.equal(box.image, "vyre/site-builders:node");
  const row = select(world.db, TABLES.site, ["root_folder", "service_principal", "owner_level"], { site_id: site.siteId, deleted: 0 })[0];
  assert.equal(row?.root_folder, "Deployments/Harbor");
  assert.equal(row?.service_principal, `svc_site_${site.siteId}`);
  assert.equal(row?.owner_level, "use");
  const ident = await serviceIdentity(world.ctx, { siteId: site.siteId });
  assert.equal(ident.principal, `svc_site_${site.siteId}`);
  assert.equal(ident.grants.length > 0, true);
  assert.equal(ident.grants.every((grant) => grant.level === "use"), true);
});

test("staging deploy publishes only while the sealed Vault handle still unseals", async () => {
  const world = testCtx();
  const site = await makeSite(world, "Staging");
  const built = await buildSite(world.ctx, { siteId: site.siteId });
  const refused = await rejects(
    () => deploySite(world.ctx, { siteId: site.siteId, deploymentId: built.deploymentId }),
    "validation.bad_input",
  );
  assert.equal(refused.error.message.includes("sealed"), true);
  assert.equal(world.platform.routes.length, 0);

  const set = await envSet(world.ctx, { siteId: site.siteId, entries: [{ name: "PUBLIC_URL", vaultHandle: "#Staging" }] });
  assert.equal(set.ok, true);
  const listed = await envList(world.ctx, { siteId: site.siteId });
  assert.deepEqual(listed.entries, [{ name: "PUBLIC_URL", vaultName: "#Staging", injected: true }]);

  await sealStaging(world.ctx, { siteId: site.siteId, vaultHandle: "#Staging" });
  const deployed = await deploySite(world.ctx, { siteId: site.siteId, deploymentId: built.deploymentId });
  assert.equal(deployed.deployment.env, "staging");
  assert.equal(deployed.deployment.state, "ready");
  const host = hostFromUrl(deployed.deployment.url ?? "");
  assert.equal(host, stagingHost(site.siteId, world.ctx.space));
  assert.equal(routeSealed(world, host), true);
  assert.equal(world.platform.routes.length > 0, true);
  assert.equal(world.platform.routes.every((row) => row.auth.sealed === true), true);
  const live = world.platform.containers.find((row) => row.name === `vyre-site-${site.siteId}`);
  assert.deepEqual(live?.envNames, ["PUBLIC_URL"]);
  assert.equal(world.filled.some((row) => row.handle === "#Staging" && row.into.kind === "caddy-basicauth"), true);
  assert.equal(world.filled.some((row) => row.handle === "#Staging" && row.into.kind === "deployment"), true);
  const stored = select(world.db, TABLES.deployment, ["sealed", "vault_handle"], { deployment_id: built.deploymentId })[0];
  assert.equal(stored?.sealed, 1);
  assert.equal(stored?.vault_handle, "#Staging");
  const happened = world.events.find((event) => event.name === "site.deployed");
  assert.equal((happened?.payload as { env?: string } | undefined)?.env, "staging");

  writeRow(world.db, TABLES.site, { staging_seal: "not-json" }, { site_id: site.siteId, deleted: 0 });
  await republish(world.ctx, site.siteId);
  assert.equal(world.platform.routes.length, 0);
  await rejects(() => deploySite(world.ctx, { siteId: site.siteId, deploymentId: built.deploymentId }), "validation.bad_input");
});

test("env_set rejects a Vault handle the caller cannot use", async () => {
  const world = testCtx();
  const site = await makeSite(world, "Env");
  await rejects(
    () => envSet(world.ctx, { siteId: site.siteId, entries: [{ name: "TOKEN", vaultHandle: "#Missing" }] }),
    "permission.no_grant",
  );
});

test("one preview per branch, removed when that branch merges, brought back by rebuild", async () => {
  const world = testCtx();
  bind(world);
  const site = await makeSite(world, "Previews");
  await sealStaging(world.ctx, { siteId: site.siteId, vaultHandle: "#Staging" });
  const feature = await previewRebuild(world.ctx, { siteId: site.siteId, branch: "feature" });
  const again = await previewRebuild(world.ctx, { siteId: site.siteId, branch: "feature" });
  assert.equal(again.deployment.deploymentId, feature.deployment.deploymentId);
  await previewRebuild(world.ctx, { siteId: site.siteId, branch: "bugfix" });
  const featureHost = previewHost(site.siteId, "feature", world.ctx.space);
  const bugHost = previewHost(site.siteId, "bugfix", world.ctx.space);
  assert.equal(feature.deployment.url, `https://${featureHost}`);
  assert.equal(feature.deployment.env, "preview");
  const open = await listPreviews(world.ctx, { siteId: site.siteId });
  assert.deepEqual(open.previews.map((row) => row.branch).sort(), ["bugfix", "feature"]);
  assert.equal(routeSealed(world, featureHost), true);
  assert.equal(routeSealed(world, bugHost), true);

  await updateSite(world.ctx, { siteId: site.siteId, settings: { mergedBranch: "feature" } });
  const left = await listPreviews(world.ctx, { siteId: site.siteId });
  assert.deepEqual(left.previews.map((row) => row.branch), ["bugfix"]);
  assert.equal(world.platform.routes.some((row) => row.host === featureHost), false);
  assert.equal(routeSealed(world, bugHost), true);
  const stopped = world.platform.containers.find((row) => row.name === previewContainer(site.siteId, "feature"));
  assert.equal(stopped?.running, false);
  assert.equal(world.events.some((event) => event.name === "site.preview_removed"), true);

  const brought = await previewRebuild(world.ctx, { siteId: site.siteId, branch: "feature" });
  assert.equal(brought.deployment.deploymentId, feature.deployment.deploymentId);
  assert.equal(routeSealed(world, featureHost), true);
});

test("projection drops a preview when the branch merges", () => {
  const created = applySiteEvent(emptyView(), "site.preview_created", {
    siteId: "sit_1",
    branch: "feature",
    url: "https://preview-feature.example",
  });
  const removed = applySiteEvent(created, "site.preview_removed", { siteId: "sit_1", branch: "feature" });
  assert.equal(removed.previews.length, 0);
  assert.deepEqual(removed.removed, [{ siteId: "sit_1", branch: "feature" }]);
  assert.equal(consumers["sites.deployer"].events.includes("site.preview_removed"), true);
});

test("promote is the next sites packet", async () => {
  const world = testCtx();
  await rejects(() => handlers["sites.promote"](world.ctx, {}), "internal.not_implemented");
});
