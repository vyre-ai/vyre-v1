// sites core: create, build, deploy to staging behind a sealed password, previews per branch removed on merge, env names (spec 2.20, 3.6).
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/sites/migrations/0001_sites_core.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureSites, hexOf } from "../handlers/deploy.ts";
import { consumers, inline } from "../projections.ts";
import type { ProjEvent, ProjTx } from "../projections.ts";
import { handleBranchMerged, handlers } from "../impl.ts";
import { SPACE_DOMAIN } from "../fixtures/fakes.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;

const call = (cap: keyof typeof handlers): Fn => handlers[cap] as Fn;

async function run<T>(ctx: Ctx, cap: keyof typeof handlers, input: unknown): Promise<T> {
  return (await call(cap)(ctx, input)) as T;
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

interface SiteOut { siteId: string; name: string; kind: string; owner: string; repoFolderId?: string; stagingUrl?: string; productionUrl?: string; state: string }
interface DepOut { deploymentId: string; siteId: string; env: string; state: string; url?: string; branch?: string; commit?: string; at: number }

async function newSite(w: World, name = "Harbor", extra: Record<string, unknown> = {}): Promise<SiteOut> {
  const out = await run<{ site: SiteOut }>(w.ctx, "sites.create", { name, kind: "site", idempotencyKey: `k-${name}`, ...extra });
  return out.site;
}

async function readySite(w: World, extra: Record<string, unknown> = {}): Promise<SiteOut> {
  const site = await newSite(w, "Harbor", extra);
  await run(w.ctx, "sites.staging_password_set", { siteId: site.siteId, vaultHandle: "#Staging_Pass" });
  return site;
}

async function build(w: World, siteId: string, branch?: string): Promise<string> {
  const out = await run<{ runId: string; deploymentId: string }>(w.ctx, "sites.build", branch === undefined ? { siteId } : { siteId, branch });
  return out.deploymentId;
}

async function deploy(w: World, siteId: string, deploymentId?: string): Promise<DepOut> {
  const out = await run<{ deployment: DepOut }>(w.ctx, "sites.deploy", deploymentId === undefined ? { siteId } : { siteId, deploymentId });
  return out.deployment;
}

function payloadEvent(payload: unknown, at = 1): ProjEvent {
  return { at, actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify(payload)) };
}

function noRouteWithoutPassword(w: World): void {
  for (const [host, spec] of w.router.routes) {
    if (host.startsWith("staging-") || host.startsWith("preview-")) {
      assert.ok(spec.auth !== null, `${host} is routed without a password`);
      assert.match(spec.auth.handle, /^#/);
    }
  }
}

test("create: folder under Deployments, row, event, service identity capped by the owner", async () => {
  const w = harness();
  const site = await newSite(w, "Harbor Studio", { repoUrl: "https://github.com/acme/harbor.git" });
  assert.match(site.siteId, /^sit_[a-z0-9]+$/);
  assert.equal(site.name, "Harbor Studio");
  assert.equal(site.kind, "site");
  assert.equal(site.owner, "usr_owner");
  assert.equal(site.state, "queued");
  assert.equal(site.repoFolderId, "fld_site1");
  assert.equal(site.stagingUrl, undefined);
  assert.deepEqual(w.calls.map((c) => c.cap), ["files.tree", "files.folder.create"]);
  assert.equal((w.calls[1]?.input as { parentId: string }).parentId, "fld_deployments");
  assert.deepEqual(w.events.map((e) => [e.name, e.subject]), [["site.created", `site/${site.siteId}`]]);
  assert.deepEqual(w.events[0]?.payload, { siteId: site.siteId, name: "Harbor Studio" });

  const identity = await run<{ principal: string; grants: { resource: string; level: string }[] }>(w.ctx, "sites.service_identity", { siteId: site.siteId });
  assert.equal(identity.principal, `svc_site_${hexOf(site.siteId)}`);
  assert.deepEqual(identity.grants, [
    { resource: "folder/fld_site1", level: "edit" },
    { resource: `site/${site.siteId}`, level: "edit" },
  ]);
});

test("create: the service identity never holds more than its owner", async () => {
  const w = harness();
  w.levelFor.set("folder", "use");
  w.levelFor.set("site", "view");
  const site = await newSite(w);
  const identity = await run<{ grants: { resource: string; level: string }[] }>(w.ctx, "sites.service_identity", { siteId: site.siteId });
  assert.deepEqual(identity.grants, [
    { resource: "folder/fld_site1", level: "use" },
    { resource: `site/${site.siteId}`, level: "view" },
  ]);
});

test("create: rejects bad names, kinds and repo addresses; a taken folder name gets a suffix", async () => {
  const w = harness();
  assert.equal(await code(run(w.ctx, "sites.create", { name: "   ", kind: "site" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.create", { name: "x".repeat(81), kind: "site" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.create", { name: "ok", kind: "spaceship" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.create", { name: "ok", kind: "site", repoUrl: "ftp://x/y" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.create", { name: "ok", kind: "site", repoUrl: "https://a b" })), "validation.bad_input");
  assert.equal(w.db.rows("sites_site").length, 0);
  const a = await newSite(w, "Same");
  const b = await newSite(w, "Same");
  assert.notEqual(a.repoFolderId, b.repoFolderId);
  assert.equal(w.db.rows("sites_site").length, 2);
});

test("get, list: sections, visibility, paging and recent activity first", async () => {
  const w = harness();
  const a = await newSite(w, "Alpha");
  w.advance(1000);
  const b = await newSite(w, "Beta");
  w.advance(1000);
  const other = w.as("usr_ana");
  const c = (await run<{ site: SiteOut }>(other, "sites.create", { name: "Gamma", kind: "app", idempotencyKey: "k-g" })).site;

  const all = await run<{ sites: SiteOut[]; total: number; next?: string }>(w.ctx, "sites.list", {});
  assert.deepEqual(all.sites.map((s) => s.name), ["Gamma", "Beta", "Alpha"]);
  assert.equal(all.total, 3);
  assert.equal(all.next, undefined);

  const mine = await run<{ sites: SiteOut[] }>(w.ctx, "sites.list", { section: "personal" });
  assert.deepEqual(mine.sites.map((s) => s.name), ["Beta", "Alpha"]);
  const shared = await run<{ sites: SiteOut[] }>(w.ctx, "sites.list", { section: "shared" });
  assert.deepEqual(shared.sites.map((s) => s.name), ["Gamma"]);
  const inFolder = await run<{ sites: SiteOut[] }>(w.ctx, "sites.list", { folderId: a.repoFolderId });
  assert.deepEqual(inFolder.sites.map((s) => s.name), ["Alpha"]);

  w.advance(1000);
  await run(w.ctx, "sites.update", { siteId: a.siteId, name: "Alpha 2" });
  w.advance(1000);
  await build(w, a.siteId);
  const page1 = await run<{ sites: SiteOut[]; next?: string; total: number }>(w.ctx, "sites.list", { limit: 2 });
  assert.equal(page1.sites.length, 2);
  assert.equal(page1.next, "2");
  const page2 = await run<{ sites: SiteOut[]; next?: string }>(w.ctx, "sites.list", { limit: 2, cursor: page1.next });
  assert.equal(page2.sites.length, 1);
  assert.equal(page2.next, undefined);

  w.hidden.add(`site/${b.siteId}`);
  const visible = await run<{ sites: SiteOut[]; total: number }>(w.ctx, "sites.list", {});
  assert.ok(!visible.sites.some((s) => s.siteId === b.siteId));
  assert.equal(visible.total, 2);
  assert.equal((await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId: c.siteId })).site.name, "Gamma");
  assert.equal(await code(run(w.ctx, "sites.get", { siteId: "sit_missing" })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.list", { cursor: "abc" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.list", { section: "mine" })), "validation.bad_input");
});

test("update: rename, merge settings, reject a bad default branch", async () => {
  const w = harness();
  const site = await newSite(w);
  const renamed = await run<{ site: SiteOut }>(w.ctx, "sites.update", { siteId: site.siteId, name: "Harbor 2", settings: { defaultBranch: "trunk", note: 1 } });
  assert.equal(renamed.site.name, "Harbor 2");
  await run(w.ctx, "sites.update", { siteId: site.siteId, settings: { extra: true } });
  const row = w.db.rows("sites_site")[0] as Row;
  assert.deepEqual(JSON.parse(String(row.settings)), { defaultBranch: "trunk", note: 1, extra: true });
  assert.equal(await code(run(w.ctx, "sites.update", { siteId: site.siteId, settings: { defaultBranch: "a b" } })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.update", { siteId: site.siteId, settings: [] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.update", { siteId: site.siteId, name: "" })), "validation.bad_input");
});

test("build: a good build is ready without a url; a failed build emits build_failed and keeps its log", async () => {
  const w = harness();
  const site = await newSite(w);
  const first = await run<{ runId: string; deploymentId: string }>(w.ctx, "sites.build", { siteId: site.siteId });
  assert.match(first.runId, /^run_[a-z0-9]+$/);
  assert.match(first.deploymentId, /^dpl_[a-z0-9]+$/);
  const deps = await run<{ deployments: DepOut[] }>(w.ctx, "sites.deployments", { siteId: site.siteId });
  assert.equal(deps.deployments.length, 1);
  assert.equal(deps.deployments[0]?.env, "staging");
  assert.equal(deps.deployments[0]?.state, "ready");
  assert.equal(deps.deployments[0]?.url, undefined);
  assert.equal(deps.deployments[0]?.branch, "main");
  assert.match(deps.deployments[0]?.commit ?? "", /^c0ffee/);
  assert.equal((await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId: site.siteId })).site.state, "ready");
  assert.equal(w.runtime.builds[0]?.repoUrl, null);
  assert.equal(w.runtime.builds[0]?.folderId, "fld_site1");

  w.ctx.run = "run_fixed";
  w.runtime.outcomes.set("main", { ok: false, log: ["npm ERR! missing script: build", "exit 1"] });
  const bad = await run<{ runId: string; deploymentId: string }>(w.ctx, "sites.build", { siteId: site.siteId });
  assert.equal(bad.runId, "run_fixed");
  assert.deepEqual(w.events.filter((e) => e.name === "site.build_failed").map((e) => e.payload), [
    { siteId: site.siteId, deploymentId: bad.deploymentId, reason: "exit 1" },
  ]);
  assert.equal((await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId: site.siteId })).site.state, "failed");
  const logs = await run<{ lines: string[] }>(w.ctx, "sites.logs", { siteId: site.siteId, deploymentId: bad.deploymentId });
  assert.deepEqual(logs.lines, ["npm ERR! missing script: build", "exit 1"]);
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId: site.siteId, deploymentId: bad.deploymentId })), "validation.precondition_failed");
});

test("build: a driver that throws is a failed build, not a crash; no driver is a plain precondition", async () => {
  const w = harness();
  const site = await newSite(w);
  w.runtime.build = async () => { throw new Error("docker daemon unreachable"); };
  const id = await build(w, site.siteId);
  const dep = w.db.rows("sites_deployment").find((r) => r.id === id) as Row;
  assert.equal(dep.state, "failed");
  assert.deepEqual(JSON.parse(String(dep.log)), ["docker daemon unreachable"]);
  configureSites(null);
  assert.equal(await code(run(w.ctx, "sites.build", { siteId: site.siteId })), "validation.precondition_failed");
});

test("deploy: staging is always behind a sealed password; no password means no container and no route", async (t) => {
  const w = harness();
  const site = await newSite(w);
  await build(w, site.siteId);
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId: site.siteId })), "validation.precondition_failed");
  assert.equal(w.runtime.starts.length, 0);
  assert.equal(w.router.routes.size, 0);
  assert.equal(w.db.rows("sites_route").length, 0);
  assert.equal(w.names().includes("site.deployed"), false);

  await run(w.ctx, "sites.staging_password_set", { siteId: site.siteId, vaultHandle: "#Staging_Pass" });
  const t0 = performance.now();
  const dep = await deploy(w, site.siteId);
  const ms = performance.now() - t0;
  const host = `staging-${hexOf(site.siteId)}.${SPACE_DOMAIN}`;
  assert.equal(dep.env, "staging");
  assert.equal(dep.state, "ready");
  assert.equal(dep.url, `https://${host}`);
  assert.deepEqual(w.router.routes.get(host)?.auth, { handle: "#Staging_Pass" });
  assert.match(w.router.routes.get(host)?.upstream ?? "", /^site-[a-z0-9]+-[a-z0-9]+:3000$/);
  assert.deepEqual(w.filled.filter((f) => f.kind === "route_auth"), [{ handle: "#Staging_Pass", kind: "route_auth", ref: host }]);
  const started = w.runtime.starts[0];
  assert.equal(started?.network, "vyre-sites");
  assert.equal(started?.env, "staging");
  assert.equal(started?.servicePrincipal, `svc_site_${hexOf(site.siteId)}`);
  assert.equal(w.events.filter((e) => e.name === "site.deployed").length, 1);
  assert.deepEqual(w.events.find((e) => e.name === "site.deployed")?.payload, { siteId: site.siteId, deploymentId: dep.deploymentId, env: "staging" });
  const got = await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId: site.siteId });
  assert.equal(got.site.stagingUrl, `https://${host}`);
  assert.equal(got.site.productionUrl, undefined);
  noRouteWithoutPassword(w);
  t.diagnostic(`deploy took ${ms.toFixed(2)} ms`);
});

test("deploy: nothing built is a precondition; a vault key the owner cannot use is permission.no_grant", async () => {
  const w = harness();
  const site = await readySite(w);
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId: site.siteId })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId: site.siteId, deploymentId: "dpl_nope" })), "validation.not_found");
  await build(w, site.siteId);
  w.granted.delete("#Staging_Pass");
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId: site.siteId })), "permission.no_grant");
  assert.equal(w.runtime.starts.length, 0);
  assert.equal(w.router.routes.size, 0);
});

test("deploy: a new deploy replaces the previous container on the same address and keeps one running", async () => {
  const w = harness();
  const site = await readySite(w);
  const first = await build(w, site.siteId);
  const d1 = await deploy(w, site.siteId, first);
  w.advance(1000);
  const second = await build(w, site.siteId);
  const d2 = await deploy(w, site.siteId, second);
  assert.equal(d1.url, d2.url);
  assert.equal(w.runtime.stops.length, 1);
  assert.equal(w.runtime.running.size, 1);
  const rows = w.db.rows("sites_deployment");
  assert.equal(rows.find((r) => r.id === first)?.state, "stopped");
  assert.equal(rows.find((r) => r.id === first)?.container_id, null);
  assert.equal(rows.find((r) => r.id === second)?.state, "ready");
  assert.equal(w.router.routes.size, 1);
  // redeploying the live build restarts it and does not leak the old container
  await deploy(w, site.siteId, second);
  assert.equal(w.runtime.running.size, 1);
  // an older build can be brought back
  const back = await deploy(w, site.siteId, first);
  assert.equal(back.state, "ready");
  assert.equal(w.runtime.running.size, 1);
  noRouteWithoutPassword(w);
});

test("deploy: a runtime fault marks the deployment failed, emits build_failed and leaves no route or container", async () => {
  const w = harness();
  const site = await readySite(w);
  await build(w, site.siteId);
  w.runtime.failStart = "port 3000 is not open";
  const dep = await deploy(w, site.siteId);
  assert.equal(dep.state, "failed");
  assert.equal(dep.url, undefined);
  assert.equal(w.router.routes.size, 0);
  assert.equal(w.runtime.running.size, 0);
  const failed = w.events.filter((e) => e.name === "site.build_failed");
  assert.equal(failed.length, 1);
  assert.equal((failed[0]?.payload as { reason: string }).reason, "port 3000 is not open");
  assert.equal((await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId: site.siteId })).site.state, "failed");
});

test("deploy: a router fault stops the container it started", async () => {
  const w = harness();
  const site = await readySite(w);
  await build(w, site.siteId);
  w.router.setRoute = async () => { throw new Error("caddy admin api refused"); };
  const dep = await deploy(w, site.siteId);
  assert.equal(dep.state, "failed");
  assert.equal(w.runtime.running.size, 0);
  assert.equal(w.runtime.stops.length, 1);
});

test("env: names map to Vault handles, values are filled into the container and never stored", async () => {
  const w = harness();
  const site = await readySite(w);
  assert.deepEqual(await run(w.ctx, "sites.env_list", { siteId: site.siteId }), { entries: [] });
  await run(w.ctx, "sites.env_set", { siteId: site.siteId, entries: [{ name: "STRIPE_KEY", vaultHandle: "#Stripe.key" }, { name: "DATABASE_URL", vaultHandle: "#Db_Url" }] });
  const listed = await run<{ entries: { name: string; vaultName: string; injected: boolean }[] }>(w.ctx, "sites.env_list", { siteId: site.siteId });
  assert.deepEqual(listed.entries, [
    { name: "DATABASE_URL", vaultName: "#Db_Url", injected: false },
    { name: "STRIPE_KEY", vaultName: "#Stripe.key", injected: false },
  ]);

  const id = await build(w, site.siteId);
  const dep = await deploy(w, site.siteId, id);
  const refs = w.runtime.starts[0]?.envRefs ?? [];
  assert.deepEqual(refs.map((r) => r.name).sort(), ["DATABASE_URL", "STRIPE_KEY"]);
  for (const r of refs) assert.equal(r.ref.startsWith(`${dep.deploymentId}:`), true);
  assert.deepEqual(w.filled.filter((f) => f.kind === "container_env").map((f) => f.handle).sort(), ["#Db_Url", "#Stripe.key"]);
  const after = await run<{ entries: { name: string; injected: boolean }[] }>(w.ctx, "sites.env_list", { siteId: site.siteId });
  assert.deepEqual(after.entries.map((e) => e.injected), [true, true]);

  // replacing keeps injected for an unchanged entry, resets it for a changed handle, drops removed names
  await run(w.ctx, "sites.env_set", { siteId: site.siteId, entries: [{ name: "STRIPE_KEY", vaultHandle: "#Stripe.key" }, { name: "DATABASE_URL", vaultHandle: "#Staging_Pass" }] });
  const replaced = await run<{ entries: { name: string; vaultName: string; injected: boolean }[] }>(w.ctx, "sites.env_list", { siteId: site.siteId });
  assert.deepEqual(replaced.entries, [
    { name: "DATABASE_URL", vaultName: "#Staging_Pass", injected: false },
    { name: "STRIPE_KEY", vaultName: "#Stripe.key", injected: true },
  ]);
  await run(w.ctx, "sites.env_set", { siteId: site.siteId, entries: [] });
  assert.deepEqual((await run<{ entries: unknown[] }>(w.ctx, "sites.env_list", { siteId: site.siteId })).entries, []);
});

test("env: bad names, duplicates, bad handles and keys without a grant are refused and change nothing", async () => {
  const w = harness();
  const site = await readySite(w);
  await run(w.ctx, "sites.env_set", { siteId: site.siteId, entries: [{ name: "KEEP", vaultHandle: "#Db_Url" }] });
  const bad = async (entries: unknown): Promise<string> => code(run(w.ctx, "sites.env_set", { siteId: site.siteId, entries }));
  assert.equal(await bad([{ name: "1BAD", vaultHandle: "#Db_Url" }]), "validation.bad_input");
  assert.equal(await bad([{ name: "A-B", vaultHandle: "#Db_Url" }]), "validation.bad_input");
  assert.equal(await bad([{ name: "OK", vaultHandle: "Db_Url" }]), "validation.bad_input");
  assert.equal(await bad([{ name: "OK", vaultHandle: "#Db_Url" }, { name: "OK", vaultHandle: "#Stripe.key" }]), "validation.duplicate");
  assert.equal(await bad([{ name: "OK", vaultHandle: "#Not_Granted" }]), "permission.no_grant");
  assert.equal(await bad("nope"), "validation.bad_input");
  assert.equal(await bad(Array.from({ length: 201 }, (_, i) => ({ name: `N${i}`, vaultHandle: "#Db_Url" }))), "validation.too_large");
  const left = await run<{ entries: { name: string }[] }>(w.ctx, "sites.env_list", { siteId: site.siteId });
  assert.deepEqual(left.entries.map((e) => e.name), ["KEEP"]);
});

test("previews: one per branch on its own address, built on push, rebuilt in place, removed on request and brought back", async () => {
  const w = harness();
  const site = await readySite(w);
  const mainId = await build(w, site.siteId);
  await deploy(w, site.siteId, mainId);

  const featId = await build(w, site.siteId, "feat/login");
  const other = await build(w, site.siteId, "fix/typo");
  assert.notEqual(featId, other);
  let previews = (await run<{ previews: DepOut[] }>(w.ctx, "sites.previews", { siteId: site.siteId })).previews;
  assert.equal(previews.length, 2);
  const feat = previews.find((p) => p.branch === "feat/login");
  assert.equal(feat?.env, "preview");
  assert.equal(feat?.state, "ready");
  assert.match(feat?.url ?? "", new RegExp(`^https://preview-${hexOf(site.siteId).slice(0, 12)}-feat-login-[0-9a-f]{4}\\.${SPACE_DOMAIN.replaceAll(".", "\\.")}$`));
  assert.notEqual(feat?.url, previews.find((p) => p.branch === "fix/typo")?.url);
  assert.equal(w.events.filter((e) => e.name === "site.preview_created").length, 2);
  assert.deepEqual(w.router.routes.get(new URL(feat?.url ?? "").host)?.auth, { handle: "#Staging_Pass" });
  // staging and two previews share the one sealed key
  assert.equal(new Set([...w.router.routes.values()].map((r) => r.auth?.handle)).size, 1);
  noRouteWithoutPassword(w);

  // a new push to the same branch rebuilds the same preview row
  w.advance(1000);
  const again = await build(w, site.siteId, "feat/login");
  assert.equal(again, featId);
  previews = (await run<{ previews: DepOut[] }>(w.ctx, "sites.previews", { siteId: site.siteId })).previews;
  assert.equal(previews.length, 2);
  assert.equal(w.runtime.running.size, 3);   // staging + 2 previews, the old preview container was stopped

  // the default branch cannot be a preview
  assert.equal(await code(run(w.ctx, "sites.preview_rebuild", { siteId: site.siteId, branch: "main" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.build", { siteId: site.siteId, branch: "../etc" })), "validation.bad_input");

  const host = new URL(feat?.url ?? "").host;
  assert.deepEqual(await run(w.ctx, "sites.preview_remove", { siteId: site.siteId, branch: "feat/login" }), { removed: true });
  assert.equal(w.router.routes.has(host), false);
  assert.equal(w.runtime.running.size, 2);
  assert.deepEqual(w.events.filter((e) => e.name === "site.preview_removed").map((e) => e.payload), [{ siteId: site.siteId, branch: "feat/login" }]);
  previews = (await run<{ previews: DepOut[] }>(w.ctx, "sites.previews", { siteId: site.siteId })).previews;
  assert.deepEqual(previews.map((p) => p.branch), ["fix/typo"]);
  assert.deepEqual(await run(w.ctx, "sites.preview_remove", { siteId: site.siteId, branch: "feat/login" }), { removed: false });

  w.advance(1000);
  const back = await run<{ deployment: DepOut }>(w.ctx, "sites.preview_rebuild", { siteId: site.siteId, branch: "feat/login" });
  assert.equal(back.deployment.deploymentId, featId);
  assert.equal(back.deployment.state, "ready");
  assert.equal(back.deployment.url, feat?.url);
  assert.equal(w.router.routes.has(host), true);
  assert.equal(w.events.filter((e) => e.name === "site.preview_created").length, 4);
});

test("previews: a failed preview build is reported and serves nothing; no password builds but does not serve", async () => {
  const w = harness();
  const site = await readySite(w);
  w.runtime.outcomes.set("feat/bad", { ok: false, log: ["compile error"] });
  const bad = await build(w, site.siteId, "feat/bad");
  const row = w.db.rows("sites_deployment").find((r) => r.id === bad) as Row;
  assert.equal(row.state, "failed");
  assert.equal(w.router.routes.size, 0);
  assert.equal(w.events.filter((e) => e.name === "site.preview_created").length, 0);

  const w2 = harness();
  const bare = await newSite(w2);
  const id = await build(w2, bare.siteId, "feat/x");
  const dep = w2.db.rows("sites_deployment").find((r) => r.id === id) as Row;
  assert.equal(dep.state, "ready");
  assert.equal(dep.url, null);
  assert.equal(w2.router.routes.size, 0);
  assert.match(String(dep.log), /staging password/);
});

test("previews: removed when the pull request merges (marked by the event, removed by the next write)", async () => {
  const w = harness();
  const site = await readySite(w, { repoUrl: "https://github.com/acme/harbor.git" });
  w.runtime.outcomes.set("feat/login", { pullRequest: 42 });
  await build(w, site.siteId, "feat/login");
  w.runtime.outcomes.set("fix/typo", { pullRequest: 43 });
  await build(w, site.siteId, "fix/typo");
  const feat = w.db.rows("sites_deployment").find((r) => r.branch === "feat/login") as Row;
  const featHost = String(feat.host);
  assert.equal(w.router.routes.has(featHost), true);

  const consumer = consumers["sites.merged_previews"];
  const tx = w.db as unknown as ProjTx;
  const on = consumer.on["pull_request.merged"];
  assert.ok(on);
  on(tx, payloadEvent({ repo: "someone/else", number: 42 }));
  assert.equal((w.db.rows("sites_deployment").find((r) => r.branch === "feat/login") as Row).merge_pending, 0);
  on(tx, payloadEvent({ repo: "acme/harbor", number: 42 }));
  on(tx, payloadEvent({ repo: "acme/harbor", number: 42 }));   // at-least-once delivery
  assert.equal((w.db.rows("sites_deployment").find((r) => r.branch === "feat/login") as Row).merge_pending, 1);
  assert.equal((w.db.rows("sites_deployment").find((r) => r.branch === "fix/typo") as Row).merge_pending, 0);

  // marked previews no longer show
  const shown = (await run<{ previews: DepOut[] }>(w.ctx, "sites.previews", { siteId: site.siteId })).previews;
  assert.deepEqual(shown.map((p) => p.branch), ["fix/typo"]);
  const listed = (await run<{ deployments: DepOut[] }>(w.ctx, "sites.deployments", { siteId: site.siteId })).deployments;
  assert.equal(listed.some((d) => d.branch === "feat/login"), false);
  // the container is still up until the next write sweeps it
  assert.equal(w.router.routes.has(featHost), true);
  await build(w, site.siteId);
  assert.equal(w.router.routes.has(featHost), false);
  assert.equal(w.runtime.running.size, 1);   // only fix/typo
  assert.deepEqual(w.events.filter((e) => e.name === "site.preview_removed").map((e) => e.payload), [{ siteId: site.siteId, branch: "feat/login" }]);
  const gone = w.db.rows("sites_deployment").find((r) => r.branch === "feat/login") as Row;
  assert.equal(gone.state, "stopped");
  assert.notEqual(gone.removed_at, null);

  // a rebuild brings it back
  const back = await run<{ deployment: DepOut }>(w.ctx, "sites.preview_rebuild", { siteId: site.siteId, branch: "feat/login" });
  assert.equal(back.deployment.state, "ready");
  assert.equal(w.router.routes.has(featHost), true);
});

test("previews: a push to a closed branch is also removed by handleBranchMerged", async () => {
  const w = harness();
  const site = await readySite(w);
  await build(w, site.siteId, "feat/login");
  assert.equal(await handleBranchMerged(w.ctx, site.siteId, "feat/login"), 1);
  assert.equal(await handleBranchMerged(w.ctx, site.siteId, "feat/login"), 0);
  assert.equal(w.router.routes.size, 0);
  assert.equal(w.runtime.running.size, 0);
});

test("staging password: changing the key re-secures every live staging and preview address", async () => {
  const w = harness();
  const site = await readySite(w);
  await deploy(w, site.siteId, await build(w, site.siteId));
  await build(w, site.siteId, "feat/login");
  assert.equal(w.router.routes.size, 2);
  w.granted.add("#New_Pass");
  await run(w.ctx, "sites.staging_password_set", { siteId: site.siteId, vaultHandle: "#New_Pass" });
  assert.deepEqual([...w.router.routes.values()].map((r) => r.auth?.handle), ["#New_Pass", "#New_Pass"]);
  assert.equal(w.db.rows("sites_route").every((r) => r.auth_handle === "#New_Pass"), true);
  assert.equal(await code(run(w.ctx, "sites.staging_password_set", { siteId: site.siteId, vaultHandle: "#Not_Granted" })), "permission.no_grant");
  assert.equal(await code(run(w.ctx, "sites.staging_password_set", { siteId: site.siteId, vaultHandle: "plain" })), "validation.bad_input");
  assert.equal((w.db.rows("sites_site")[0] as Row).staging_secret, "#New_Pass");
  noRouteWithoutPassword(w);
});

test("logs: build lines then container lines, tail applies, bad tail refused", async () => {
  const w = harness();
  const site = await readySite(w);
  assert.deepEqual((await run<{ lines: string[] }>(w.ctx, "sites.logs", { siteId: site.siteId })).lines, []);
  w.runtime.outcomes.set("main", { log: ["step 1", "step 2"] });
  const id = await build(w, site.siteId);
  await deploy(w, site.siteId, id);
  assert.deepEqual((await run<{ lines: string[] }>(w.ctx, "sites.logs", { siteId: site.siteId })).lines, ["step 1", "step 2", "container: listening on 3000"]);
  assert.deepEqual((await run<{ lines: string[] }>(w.ctx, "sites.logs", { siteId: site.siteId, deploymentId: id, tail: 1 })).lines, ["container: listening on 3000"]);
  assert.equal(await code(run(w.ctx, "sites.logs", { siteId: site.siteId, tail: 0 })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "sites.logs", { siteId: site.siteId, tail: 1001 })), "validation.bad_input");
});

test("delete: stops containers, removes routes and domains, and the site disappears", async () => {
  const w = harness();
  const site = await readySite(w);
  await deploy(w, site.siteId, await build(w, site.siteId));
  await build(w, site.siteId, "feat/login");
  await run(w.ctx, "sites.env_set", { siteId: site.siteId, entries: [{ name: "K", vaultHandle: "#Db_Url" }] });
  assert.equal(w.runtime.running.size, 2);
  assert.deepEqual(await run(w.ctx, "sites.delete", { siteId: site.siteId }), { deleted: true });
  assert.equal(w.runtime.running.size, 0);
  assert.equal(w.router.routes.size, 0);
  assert.equal(w.db.rows("sites_route").length, 0);
  assert.equal(w.db.rows("sites_env").length, 0);
  assert.equal(await code(run(w.ctx, "sites.get", { siteId: site.siteId })), "validation.not_found");
  assert.equal((await run<{ sites: SiteOut[] }>(w.ctx, "sites.list", {})).sites.length, 0);
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId: site.siteId })), "validation.not_found");
});

test("activity projection: the last site event per site, idempotent on replay", () => {
  const w = harness();
  const tx = w.db as unknown as ProjTx;
  const p = inline["sites.activity"];
  const on = p.on["site.deployed"];
  const created = p.on["site.created"];
  assert.ok(on && created);
  created(tx, payloadEvent({ siteId: "sit_a", name: "A" }, 10));
  on(tx, payloadEvent({ siteId: "sit_a", deploymentId: "dpl_x", env: "staging" }, 30));
  on(tx, payloadEvent({ siteId: "sit_a", deploymentId: "dpl_x", env: "staging" }, 30));
  created(tx, payloadEvent({ siteId: "sit_a", name: "A" }, 10));   // an older event replayed later does not win
  on(tx, payloadEvent({ nothing: true }, 40));
  assert.deepEqual(w.db.rows("sites_activity"), [{ site_id: "sit_a", last_event: "site.deployed", at: 30 }]);
  p.reset(tx);
  assert.deepEqual(w.db.rows("sites_activity"), []);
});
