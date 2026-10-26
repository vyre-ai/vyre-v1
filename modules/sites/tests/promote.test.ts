// sites promote and rollback (spec 2.20 Pipeline; ARCH 7.6): Promote is a Gate act (site_promote), rollback restores an earlier production build.
// The Gate itself sits in the host: the manifest names the act, the handler runs after the approval. These tests check the declaration and everything the handler does.
// @reads /modules/sites/migrations/0001_sites_core.sql
// @reads /modules/sites/migrations/0002_promote_tables.sql
// @reads /generated/registry.json

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { hexOf } from "../handlers/deploy.ts";
import { githubRepo, productionHost } from "../handlers/promote.ts";
import { handlers } from "../handlers/index.ts";
import { SPACE_DOMAIN } from "../fixtures/fakes.ts";
import { MemoryDb, readMigration } from "../fixtures/db.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;

const here = dirname(fileURLToPath(import.meta.url));

interface SiteOut { siteId: string; productionUrl?: string; stagingUrl?: string; state: string }
interface DepOut { deploymentId: string; siteId: string; env: string; state: string; url?: string; branch?: string; commit?: string; at: number }

interface PrScript {
  state: "open" | "merged" | "closed";
  checks: "none" | "pending" | "passing" | "failing";
  mergeOk: boolean;
}

/** a world with both migrations loaded and a scripted GitHub: calls to github.* are recorded and answered from `pr` */
function world(): World & { gh: { cap: string; input: unknown }[]; pr: PrScript; db: MemoryDb } {
  const w = harness();
  const db = new MemoryDb(`${readMigration()}\n${readFileSync(join(here, "../migrations/0002_promote_tables.sql"), "utf8")}`);
  w.ctx.db = db;
  const gh: { cap: string; input: unknown }[] = [];
  const pr: PrScript = { state: "open", checks: "passing", mergeOk: true };
  const base = w.ctx.call.bind(w.ctx);
  w.ctx.call = (async (cap: string, input: unknown) => {
    if (cap.startsWith("github.")) {
      gh.push({ cap, input });
      if (cap === "github.pull_request.get") return { pullRequest: { state: pr.state } };
      if (cap === "github.pull_request.checks") return { state: pr.checks, runs: [] };
      if (cap === "github.pull_request.merge") return { merged: pr.mergeOk, sha: "deadbeef" };
    }
    return base(cap as never, input);
  }) as Ctx["call"];
  return Object.assign(w, { gh, pr, db });
}

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

async function readySite(w: World, extra: Record<string, unknown> = {}): Promise<string> {
  const out = await run<{ site: SiteOut }>(w.ctx, "sites.create", { name: "Harbor", kind: "site", idempotencyKey: "k-harbor", ...extra });
  await run(w.ctx, "sites.staging_password_set", { siteId: out.site.siteId, vaultHandle: "#Staging_Pass" });
  return out.site.siteId;
}

/** build main and deploy it to staging; returns the staging deployment id */
async function stage(w: World, siteId: string): Promise<string> {
  w.advance(1000);
  const built = await run<{ deploymentId: string }>(w.ctx, "sites.build", { siteId });
  await run(w.ctx, "sites.deploy", { siteId, deploymentId: built.deploymentId });
  return built.deploymentId;
}

async function promote(w: World, siteId: string, deploymentId: string): Promise<DepOut> {
  w.advance(1000);
  return (await run<{ deployment: DepOut }>(w.ctx, "sites.promote", { siteId, deploymentId })).deployment;
}

async function rollback(w: World, siteId: string, toDeploymentId?: string): Promise<DepOut> {
  w.advance(1000);
  const input = toDeploymentId === undefined ? { siteId } : { siteId, toDeploymentId };
  return (await run<{ deployment: DepOut }>(w.ctx, "sites.rollback", input)).deployment;
}

function rows(w: World & { db: MemoryDb }, table: string, where: (r: Row) => boolean = () => true): Row[] {
  return w.db.rows(table).filter(where);
}

function prodRows(w: World & { db: MemoryDb }, siteId: string): Row[] {
  return rows(w, "sites_deployment", (r) => r.site_id === siteId && r.env === "production");
}

test("gate: sites.promote declares the site_promote act and rollback declares none (the host holds the call, the handler runs after approval)", () => {
  const registry = JSON.parse(readFileSync(join(here, "../../../generated/registry.json"), "utf8")) as { capabilities: { name: string; gate?: { act: string; reason?: string } }[] };
  const gate = (name: string) => registry.capabilities.find((c) => c.name === name)?.gate;
  assert.deepEqual(gate("sites.promote"), { act: "site_promote" });
  assert.equal(gate("sites.rollback")?.act, "none");
  assert.ok((gate("sites.rollback")?.reason ?? "").length > 0);
});

test("promote: a staging build starts a production container, routes the production address without a password and records where it came from", async () => {
  const w = world();
  const siteId = await readySite(w);
  const staging = await stage(w, siteId);
  const stagingRow = rows(w, "sites_deployment", (r) => r.id === staging)[0] as Row;
  const prod = await promote(w, siteId, staging);

  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  assert.equal(productionHost(siteId, SPACE_DOMAIN), host);
  assert.equal(prod.env, "production");
  assert.equal(prod.state, "ready");
  assert.equal(prod.url, `https://${host}`);
  assert.equal(prod.commit, stagingRow.commit_sha);
  assert.notEqual(prod.deploymentId, staging);

  const started = w.runtime.starts[w.runtime.starts.length - 1];
  assert.equal(started?.env, "production");
  assert.equal(started?.image, stagingRow.image);
  assert.equal(started?.network, "vyre-sites");
  assert.equal(started?.servicePrincipal, `svc_site_${hexOf(siteId)}`);
  assert.equal(w.router.routes.get(host)?.auth, null);
  assert.match(w.router.routes.get(host)?.upstream ?? "", /^site-[a-z0-9]+-[a-z0-9]+:3000$/);

  // the staging address stays up behind its password
  const stagingHost = `staging-${hexOf(siteId)}.${SPACE_DOMAIN}`;
  assert.deepEqual(w.router.routes.get(stagingHost)?.auth, { handle: "#Staging_Pass" });
  assert.equal(w.runtime.running.size, 2);

  assert.deepEqual(rows(w, "sites_promotion").map((p) => [p.production_id, p.site_id, p.source_id, p.pr_number, p.promoted_by, p.rolled_back_at]), [[prod.deploymentId, siteId, staging, null, "usr_owner", null]]);
  assert.deepEqual(w.events.filter((e) => e.name === "site.promoted"), [{ name: "site.promoted", subject: `site/${siteId}`, payload: { siteId, deploymentId: prod.deploymentId } }]);
  const site = (await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId })).site;
  assert.equal(site.productionUrl, `https://${host}`);
  assert.equal(site.stagingUrl, `https://${stagingHost}`);
  assert.deepEqual(rows(w, "sites_route", (r) => r.host === host).map((r) => [r.env, r.auth_handle, r.deployment_id]), [["production", null, prod.deploymentId]]);
});

test("promote: a second promote starts the new build before it stops the old one and moves the production address and every custom domain", async () => {
  const w = world();
  const siteId = await readySite(w);
  await run(w.ctx, "sites.domain_set", { siteId, domain: "www.example.com" });
  const first = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  const upstream1 = w.router.routes.get(host)?.upstream;
  assert.equal(w.router.routes.get("www.example.com")?.upstream, upstream1);

  const second = await promote(w, siteId, await stage(w, siteId));
  const upstream2 = w.router.routes.get(host)?.upstream;
  assert.notEqual(upstream1, upstream2);
  assert.equal(w.router.routes.get("www.example.com")?.upstream, upstream2);
  assert.equal(w.router.routes.get("www.example.com")?.auth, null);

  const old = prodRows(w, siteId).find((r) => r.id === first.deploymentId) as Row;
  assert.equal(old.state, "stopped");
  assert.equal(old.container_id, null);
  assert.equal(old.url, null);
  const live = prodRows(w, siteId).filter((r) => r.container_id !== null);
  assert.deepEqual(live.map((r) => r.id), [second.deploymentId]);
  // staging container plus one production container
  assert.equal(w.runtime.running.size, 2);
  const startOrder = w.runtime.starts.filter((s) => s.env === "production").map((s) => s.deploymentId);
  assert.deepEqual(startOrder, [first.deploymentId, second.deploymentId]);
  assert.equal(w.events.filter((e) => e.name === "site.promoted").length, 2);
});

test("promote: refuses a production row, a running or failed build, a removed preview, an unknown id and a build that is already live", async () => {
  const w = world();
  const siteId = await readySite(w);
  const staging = await stage(w, siteId);
  const prod = await promote(w, siteId, staging);
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: prod.deploymentId })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: staging })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: "dpl_missing" })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId: "sit_missing", deploymentId: staging })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId })), "validation.bad_input");

  w.runtime.outcomes.set("main", { ok: false, log: ["exit 1"] });
  w.advance(1000);
  const bad = await run<{ deploymentId: string }>(w.ctx, "sites.build", { siteId });
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: bad.deploymentId })), "validation.precondition_failed");

  w.runtime.outcomes.delete("main");
  const spare = await stage(w, siteId);
  w.db.run("UPDATE sites_deployment SET state = ? WHERE id = ?", "building", spare);
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: spare })), "validation.precondition_failed");

  w.runtime.outcomes.set("feature-x", { pullRequest: 7 });
  await run(w.ctx, "sites.preview_rebuild", { siteId, branch: "feature-x" });
  await run(w.ctx, "sites.preview_remove", { siteId, branch: "feature-x" });
  const removed = rows(w, "sites_deployment", (r) => r.env === "preview")[0] as Row;
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: String(removed.id) })), "validation.precondition_failed");
  // nothing above changed production
  assert.equal(prodRows(w, siteId).length, 1);
  assert.equal(w.events.filter((e) => e.name === "site.promoted").length, 1);
});

test("promote: a failed container start leaves production exactly as it was", async () => {
  const w = world();
  const siteId = await readySite(w);
  const first = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  const before = w.router.routes.get(host)?.upstream;
  const second = await stage(w, siteId);
  w.runtime.failStart = "image pull failed";
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: second })), "internal.unavailable");
  assert.equal(w.router.routes.get(host)?.upstream, before);
  assert.deepEqual(prodRows(w, siteId).map((r) => [r.id, r.state]), [[first.deploymentId, "ready"]]);
  assert.equal(rows(w, "sites_promotion").length, 1);
  assert.equal(w.events.filter((e) => e.name === "site.promoted").length, 1);
});

test("promote: a router fault stops the new container, puts the old rows and route back and leaves no promotion", async () => {
  const w = world();
  const siteId = await readySite(w);
  const first = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  const before = w.router.routes.get(host)?.upstream;
  const oldContainer = (prodRows(w, siteId)[0] as Row).container_id;
  const second = await stage(w, siteId);
  const original = w.router.setRoute.bind(w.router);
  let failed = false;
  w.router.setRoute = async (spec) => {
    if (!failed && spec.host === host) {
      failed = true;
      throw new Error("caddy admin api refused");
    }
    return original(spec);
  };
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: second })), "internal.unavailable");
  assert.equal(w.router.routes.get(host)?.upstream, before);
  const prod = prodRows(w, siteId);
  assert.deepEqual(prod.map((r) => [r.id, r.state, r.container_id]), [[first.deploymentId, "ready", oldContainer]]);
  assert.equal(rows(w, "sites_promotion").length, 1);
  assert.equal(w.runtime.running.has(String(oldContainer)), true);
  assert.equal(w.runtime.running.size, 2);   // staging and the old production container; the new one was stopped
});

test("promote: environment names are filled from the Vault into the production container; values are never read", async () => {
  const w = world();
  const siteId = await readySite(w);
  await run(w.ctx, "sites.env_set", { siteId, entries: [{ name: "STRIPE_KEY", vaultHandle: "#Stripe.key" }] });
  const staging = await stage(w, siteId);
  const prod = await promote(w, siteId, staging);
  const fills = w.filled.filter((f) => f.kind === "container_env" && f.ref.startsWith(prod.deploymentId));
  assert.deepEqual(fills, [{ handle: "#Stripe.key", kind: "container_env", ref: `${prod.deploymentId}:STRIPE_KEY` }]);
  const started = w.runtime.starts.find((s) => s.deploymentId === prod.deploymentId);
  assert.deepEqual(started?.envRefs, [{ name: "STRIPE_KEY", ref: `${prod.deploymentId}:STRIPE_KEY` }]);
  assert.equal(JSON.stringify(started).includes("sk_"), false);

  // the owner lost the grant: no production container starts
  const next = await stage(w, siteId);
  w.granted.delete("#Stripe.key");
  const startsBefore = w.runtime.starts.length;
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: next })), "permission.no_grant");
  assert.equal(w.runtime.starts.length, startsBefore);
});

test("promote with a pull request: failing or running checks block it, passing checks merge first, then the staged build ships", async () => {
  const w = world();
  const siteId = await readySite(w, { repoUrl: "https://github.com/acme/harbor.git" });
  w.runtime.outcomes.set("feature-x", { pullRequest: 7 });
  const preview = (await run<{ deployment: DepOut }>(w.ctx, "sites.preview_rebuild", { siteId, branch: "feature-x" })).deployment;
  assert.equal(preview.state, "ready");

  w.pr.checks = "failing";
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: preview.deploymentId })), "validation.precondition_failed");
  w.pr.checks = "pending";
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: preview.deploymentId })), "validation.precondition_failed");
  assert.equal(w.gh.some((g) => g.cap === "github.pull_request.merge"), false);
  assert.equal(prodRows(w, siteId).length, 0);

  w.pr.checks = "passing";
  w.pr.mergeOk = false;
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: preview.deploymentId })), "validation.precondition_failed");
  assert.equal(prodRows(w, siteId).length, 0);

  w.pr.mergeOk = true;
  const prod = await promote(w, siteId, preview.deploymentId);
  const merge = w.gh.filter((g) => g.cap === "github.pull_request.merge");
  assert.deepEqual(merge[merge.length - 1]?.input, { repo: "acme/harbor", number: 7, method: "squash" });
  assert.equal(prod.branch, "feature-x");
  assert.deepEqual(rows(w, "sites_promotion").map((p) => [p.source_id, p.pr_number, p.merge_sha]), [[preview.deploymentId, 7, "deadbeef"]]);
  const production = prodRows(w, siteId)[0] as Row;
  assert.equal(production.pr_number, 7);
  assert.equal(production.image, (rows(w, "sites_deployment", (r) => r.id === preview.deploymentId)[0] as Row).image);
});

test("promote with a pull request: an already merged one is not merged twice, a closed one is refused, the merge method follows the site settings", async () => {
  const w = world();
  const siteId = await readySite(w, { repoUrl: "git@github.com:acme/harbor.git" });
  w.runtime.outcomes.set("feature-y", { pullRequest: 9 });
  const preview = (await run<{ deployment: DepOut }>(w.ctx, "sites.preview_rebuild", { siteId, branch: "feature-y" })).deployment;

  w.pr.state = "closed";
  assert.equal(await code(run(w.ctx, "sites.promote", { siteId, deploymentId: preview.deploymentId })), "validation.precondition_failed");

  w.pr.state = "merged";
  w.pr.checks = "failing";   // checks no longer matter once it is merged
  await promote(w, siteId, preview.deploymentId);
  assert.equal(w.gh.some((g) => g.cap === "github.pull_request.merge"), false);

  const w2 = world();
  const site2 = await readySite(w2, { repoUrl: "ssh://git@github.com/acme/harbor" });
  await run(w2.ctx, "sites.update", { siteId: site2, settings: { mergeMethod: "rebase" } });
  w2.runtime.outcomes.set("feature-z", { pullRequest: 3 });
  const p2 = (await run<{ deployment: DepOut }>(w2.ctx, "sites.preview_rebuild", { siteId: site2, branch: "feature-z" })).deployment;
  await promote(w2, site2, p2.deploymentId);
  assert.deepEqual(w2.gh.filter((g) => g.cap === "github.pull_request.merge").map((g) => g.input), [{ repo: "acme/harbor", number: 3, method: "rebase" }]);
});

test("githubRepo: reads owner/name from https, ssh and git@ addresses and nothing else", () => {
  assert.equal(githubRepo("https://github.com/acme/harbor.git"), "acme/harbor");
  assert.equal(githubRepo("https://github.com/acme/harbor"), "acme/harbor");
  assert.equal(githubRepo("https://x-access-token@github.com/acme/harbor.git"), "acme/harbor");
  assert.equal(githubRepo("git@github.com:acme/harbor.git"), "acme/harbor");
  assert.equal(githubRepo("ssh://git@github.com/acme/harbor.git"), "acme/harbor");
  assert.equal(githubRepo("https://gitlab.com/acme/harbor.git"), null);
  assert.equal(githubRepo("https://github.com/acme"), null);
});

test("rollback: restarts the previous production build from its image, moves the address back and marks the rolled-back build", async () => {
  const w = world();
  const siteId = await readySite(w);
  const first = await promote(w, siteId, await stage(w, siteId));
  const firstImage = (prodRows(w, siteId)[0] as Row).image;
  const second = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  assert.notEqual(first.deploymentId, second.deploymentId);

  const back = await rollback(w, siteId);
  assert.equal(back.deploymentId, first.deploymentId);
  assert.equal(back.state, "ready");
  assert.equal(back.url, `https://${host}`);
  const restart = w.runtime.starts[w.runtime.starts.length - 1];
  assert.equal(restart?.env, "production");
  assert.equal(restart?.image, firstImage);
  assert.equal(restart?.deploymentId, first.deploymentId);
  assert.equal(w.router.routes.get(host)?.upstream, restart ? `${restart.name}:3000` : "");
  const live = prodRows(w, siteId).filter((r) => r.container_id !== null);
  assert.deepEqual(live.map((r) => r.id), [first.deploymentId]);
  assert.equal((prodRows(w, siteId).find((r) => r.id === second.deploymentId) as Row).state, "stopped");
  assert.equal(w.runtime.running.size, 2);   // staging and the restored production container
  assert.deepEqual(rows(w, "sites_promotion", (p) => p.rolled_back_at !== null).map((p) => p.production_id), [second.deploymentId]);
  assert.deepEqual(w.events.filter((e) => e.name === "site.rolled_back"), [{ name: "site.rolled_back", subject: `site/${siteId}`, payload: { siteId, toDeploymentId: first.deploymentId } }]);
  assert.equal((await run<{ site: SiteOut }>(w.ctx, "sites.get", { siteId })).site.productionUrl, `https://${host}`);
});

test("rollback: custom domains follow, the default skips builds that were rolled back, an explicit target can roll forward again", async () => {
  const w = world();
  const siteId = await readySite(w);
  await run(w.ctx, "sites.domain_set", { siteId, domain: "www.example.com" });
  const a = await promote(w, siteId, await stage(w, siteId));
  const b = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;

  await rollback(w, siteId);   // b to a
  assert.equal(w.router.routes.get("www.example.com")?.upstream, w.router.routes.get(host)?.upstream);
  // a is the oldest build and b was rolled back: there is nothing earlier to go back to
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId, toDeploymentId: a.deploymentId })), "validation.precondition_failed");

  const forward = await rollback(w, siteId, b.deploymentId);
  assert.equal(forward.deploymentId, b.deploymentId);
  assert.equal(w.router.routes.get("www.example.com")?.upstream, w.router.routes.get(host)?.upstream);
  assert.deepEqual(rows(w, "sites_promotion", (p) => p.rolled_back_at !== null).map((p) => p.production_id), [a.deploymentId]);
  assert.equal(w.events.filter((e) => e.name === "site.rolled_back").length, 2);

  await promote(w, siteId, await stage(w, siteId));
  // a was rolled back and stays skipped; b is the newest earlier build that is not live
  assert.equal((await rollback(w, siteId)).deploymentId, b.deploymentId);
});

test("rollback: refuses when nothing was promoted, to a staging build, to an unknown build or to a failed one", async () => {
  const w = world();
  const siteId = await readySite(w);
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId })), "validation.precondition_failed");
  const staging = await stage(w, siteId);
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId })), "validation.precondition_failed");
  const first = await promote(w, siteId, staging);
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId })), "validation.precondition_failed");   // only one build exists
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId, toDeploymentId: staging })), "validation.precondition_failed");
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId, toDeploymentId: "dpl_missing" })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId: "sit_missing" })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId, toDeploymentId: first.deploymentId })), "validation.precondition_failed");
  assert.equal(w.events.filter((e) => e.name === "site.rolled_back").length, 0);
});

test("rollback: a failed start keeps the current production build serving", async () => {
  const w = world();
  const siteId = await readySite(w);
  const a = await promote(w, siteId, await stage(w, siteId));
  const b = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  const before = w.router.routes.get(host)?.upstream;
  w.runtime.failStart = "out of memory";
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId, toDeploymentId: a.deploymentId })), "internal.unavailable");
  assert.equal(w.router.routes.get(host)?.upstream, before);
  assert.deepEqual(prodRows(w, siteId).filter((r) => r.container_id !== null).map((r) => r.id), [b.deploymentId]);
  assert.equal(rows(w, "sites_promotion", (p) => p.rolled_back_at !== null).length, 0);
  assert.equal(w.events.filter((e) => e.name === "site.rolled_back").length, 0);
});

test("rollback: a router fault stops the restored container and puts the current build back", async () => {
  const w = world();
  const siteId = await readySite(w);
  const a = await promote(w, siteId, await stage(w, siteId));
  const b = await promote(w, siteId, await stage(w, siteId));
  const host = `${hexOf(siteId)}.${SPACE_DOMAIN}`;
  const before = w.router.routes.get(host)?.upstream;
  const original = w.router.setRoute.bind(w.router);
  let failed = false;
  w.router.setRoute = async (spec) => {
    if (!failed && spec.host === host) {
      failed = true;
      throw new Error("caddy admin api refused");
    }
    return original(spec);
  };
  assert.equal(await code(run(w.ctx, "sites.rollback", { siteId, toDeploymentId: a.deploymentId })), "internal.unavailable");
  assert.equal(w.router.routes.get(host)?.upstream, before);
  assert.deepEqual(prodRows(w, siteId).filter((r) => r.container_id !== null).map((r) => r.id), [b.deploymentId]);
  assert.equal((prodRows(w, siteId).find((r) => r.id === a.deploymentId) as Row).container_id, null);
  assert.equal(w.runtime.running.size, 2);
});

test("golden 6 trace: deploy to staging behind the password, Promote, roll back (staging password refused first)", async (t) => {
  const w = world();
  const trace: string[] = [];
  const site = await run<{ site: SiteOut }>(w.ctx, "sites.create", { name: "Harbor", kind: "site", idempotencyKey: "k-g6" });
  const siteId = site.site.siteId;
  trace.push("1 create site");
  w.advance(1000);
  const built = await run<{ deploymentId: string }>(w.ctx, "sites.build", { siteId });
  trace.push("2 build main");
  assert.equal(await code(run(w.ctx, "sites.deploy", { siteId })), "validation.precondition_failed");
  trace.push("3 deploy refused: staging has no password");
  await run(w.ctx, "sites.staging_password_set", { siteId, vaultHandle: "#Staging_Pass" });
  await run(w.ctx, "sites.deploy", { siteId, deploymentId: built.deploymentId });
  trace.push("4 deploy to staging behind #Staging_Pass");
  const stagingHost = `staging-${hexOf(siteId)}.${SPACE_DOMAIN}`;
  assert.deepEqual(w.router.routes.get(stagingHost)?.auth, { handle: "#Staging_Pass" });
  const v1 = await promote(w, siteId, built.deploymentId);
  trace.push("5 Promote v1 (Gate act site_promote held by the host, handler runs after approval)");
  const v2 = await promote(w, siteId, await stage(w, siteId));
  trace.push("6 Promote v2");
  const back = await rollback(w, siteId);
  trace.push("7 roll back to v1");
  assert.equal(back.deploymentId, v1.deploymentId);
  assert.notEqual(back.deploymentId, v2.deploymentId);
  assert.deepEqual(w.names().filter((n) => n === "site.deployed" || n === "site.promoted" || n === "site.rolled_back"), ["site.deployed", "site.promoted", "site.deployed", "site.promoted", "site.rolled_back"]);
  t.diagnostic(`golden 6 trace: ${trace.join(" | ")}`);
  for (const line of trace) console.log(`TRACE golden6 ${line}`);
});
