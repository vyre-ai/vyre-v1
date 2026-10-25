// The GitHub App (spec 2.10, 2.16; ARCH 8, 8.5): the manifest flow, installations and repositories, installation tokens and their refresh, the filler handle for git,
// the health probe and the webhook signature. Replay only: GitHub is a scripted stand-in answering recorded bodies, nothing reaches a network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  appComplete, appCreateManifest, appGet, branchesList, health, installationsList, installationToken, repoGet, reposList, signatureMatches, signatureOf, verifyWebhook,
} from "../handlers/index.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { APP_EVENTS, APP_PERMISSIONS, setGithubHost } from "../projections.ts";
import { codeOf, contractErrors, harness, HOUR, INSTALL, MIN, NOW, payloadErrors, RECORDED, WEBHOOK_SECRET } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const CODE = "abcDEF123_codeFromGithub";

// ---- the manifest flow

test("the manifest flow gives the page a manifest with this Space's addresses and a one-time state", async () => {
  const h = harness();
  const out = await appCreateManifest(h.ctx, { org: "vyre-ai" });
  assert.deepEqual(contractErrors("github.app.create_manifest", "out", out), []);
  assert.match(out.state, /^[a-f0-9]{32}$/);
  assert.equal(out.postUrl, `https://github.com/organizations/vyre-ai/settings/apps/new?state=${out.state}`);
  assert.deepEqual(out.manifest, {
    name: `Vyre ${out.state.slice(0, 6)}`, url: "https://space.vyre.test", hook_attributes: { url: "https://space.vyre.test/hooks/github", active: true },
    redirect_url: "https://space.vyre.test/integrations/github/manifest", callback_urls: ["https://space.vyre.test/auth/github/callback"], public: false, request_oauth_on_install: false,
    default_permissions: APP_PERMISSIONS, default_events: APP_EVENTS,
  });
  const named = await appCreateManifest(h.ctx, { org: "vyre-ai", name: "  Firm Bot " });
  assert.equal(named.manifest.name, "Firm Bot");
  await refused(appCreateManifest(h.ctx, { org: "not an org!" }), "validation.bad_input");
  await refused(appCreateManifest(h.ctx, { org: "vyre-ai", name: "x".repeat(35) }), "validation.bad_input");
  await refused(appCreateManifest(h.ctx, { org: "vyre-ai", name: " " }), "validation.bad_input");
});

test("finishing the flow exchanges the code, puts every secret in the Vault, remembers the App and says where to install it", async () => {
  const h = harness();
  const { state } = await appCreateManifest(h.ctx, { org: "vyre-ai" });
  h.on(`POST /app-manifests/${CODE}/conversions`, { status: 201, body: RECORDED.conversion });
  const input = { code: CODE, state, idempotencyKey: "idem_app_1" };
  assert.deepEqual(contractErrors("github.app.complete", "in", input), []);
  const out = await appComplete(h.ctx, input);
  assert.deepEqual(out, { appId: 424242, slug: "vyre-abc123", installUrl: "https://github.com/apps/vyre-abc123/installations/new" });
  assert.deepEqual(contractErrors("github.app.complete", "out", out), []);
  const [req] = h.requests;
  assert.deepEqual([req!.method, req!.headers.authorization], ["POST", undefined], "the code is the credential; no App exists yet");
  assert.deepEqual(h.stored.map((items) => items.map((i) => i.name)), [["GitHub_App_Id", "GitHub_App_Key", "GitHub_App_Webhook_Secret", "GitHub_App_Client_Id", "GitHub_App_Client_Secret"]]);
  assert.equal(h.stored[0]![0]!.value, "424242");
  assert.ok(h.stored[0]![1]!.value.includes("BEGIN RSA PRIVATE KEY"));
  const text = JSON.stringify([out, h.emitted, h.rows(`SELECT * FROM github_app`), h.rows(`SELECT * FROM github_app_state`)]);
  assert.ok(!text.includes("BEGIN RSA") && !text.includes("client_secret_not_real") && !text.includes("hook_secret_from_github"), "no secret outside the Vault");
  const app = h.rows(`SELECT * FROM github_app`)[0]!;
  assert.deepEqual([app.appId, app.slug, app.name], [424242, "vyre-abc123", "Vyre abc123"]);
  assert.deepEqual(JSON.parse(String(app.permissions)), RECORDED.conversion.permissions);
  assert.deepEqual(h.named("github.app_created").map((e) => [e.payload, e.subject]), [[{ appId: 424242, slug: "vyre-abc123" }, "entity/vyre-abc123"]]);
  assert.deepEqual(payloadErrors("github.app_created", h.emitted[0]!.payload), []);
  await refused(appComplete(h.ctx, input), "validation.precondition_failed");
  await refused(appCreateManifest(h.ctx, { org: "vyre-ai" }), "validation.precondition_failed");
});

test("a state is good once, for an hour; a code GitHub does not know leaves the state to try again; bad input and a short answer store nothing", async () => {
  const h = harness();
  const { state } = await appCreateManifest(h.ctx, { org: "vyre-ai" });
  await refused(appComplete(h.ctx, { code: CODE, state: "f".repeat(32) }), "validation.precondition_failed");
  await refused(appComplete(h.ctx, { code: CODE, state: "nope" }), "validation.bad_input");
  await refused(appComplete(h.ctx, { code: "x", state }), "validation.bad_input");
  await refused(appComplete(h.ctx, { code: "../conversions", state }), "validation.bad_input");
  h.on(`POST /app-manifests/${CODE}/conversions`, { status: 404, body: { message: "Not Found" } });
  await refused(appComplete(h.ctx, { code: CODE, state }), "validation.precondition_failed");
  h.on(`POST /app-manifests/${CODE}/conversions`, { status: 401, body: {} });
  await refused(appComplete(h.ctx, { code: CODE, state }), "provider.auth_failed");
  h.on(`POST /app-manifests/${CODE}/conversions`, { status: 201, body: { ...RECORDED.conversion, pem: undefined } });
  await refused(appComplete(h.ctx, { code: CODE, state }), "provider.bad_response");
  assert.equal(h.stored.length, 0);
  assert.equal(h.rows(`SELECT * FROM github_app`).length, 0);
  h.on(`POST /app-manifests/${CODE}/conversions`, { status: 201, body: RECORDED.conversion });
  assert.equal((await appComplete(h.ctx, { code: CODE, state })).slug, "vyre-abc123", "the state survived the failures");
  const late = harness();
  const old = await appCreateManifest(late.ctx, { org: "vyre-ai" });
  late.advance(HOUR + MIN);
  await refused(appComplete(late.ctx, { code: CODE, state: old.state }), "validation.precondition_failed");
  assert.equal(late.requests.length, 0, "an expired state is refused before GitHub is asked");
});

// ---- the App and its installations

test("the App is read as itself and its installations are listed and remembered", async () => {
  const h = harness();
  h.on("GET /app", { status: 200, body: RECORDED.app });
  const app = await appGet(h.ctx);
  assert.deepEqual(contractErrors("github.app.get", "out", app), []);
  assert.deepEqual(app, { id: 424242, slug: "vyre-abc123", name: "Vyre abc123", permissions: RECORDED.app.permissions, events: ["push", "pull_request"] });
  assert.equal(h.requests[0]!.headers.authorization, "Bearer jwt_1", "the App speaks with its own JWT");
  assert.equal(h.requests[0]!.headers["x-github-api-version"], "2022-11-28");
  h.on("GET /app/installations", { status: 200, body: RECORDED.installationsTwo });
  const out = await installationsList(h.ctx);
  assert.deepEqual(contractErrors("github.installations.list", "out", out), []);
  assert.deepEqual(out.installations, [{ id: INSTALL, account: "vyre-ai", repositorySelection: "all" }, { id: 9002, account: "other-org", repositorySelection: "selected" }]);
  h.on("GET /app/installations", { status: 200, body: [{ id: INSTALL, account: { login: "vyre-ai-renamed" }, repository_selection: "selected" }] });
  await installationsList(h.ctx);
  assert.deepEqual(h.rows(`SELECT id, account, "repositorySelection" FROM github_installation`).map((r) => [r.id, r.account, r.repositorySelection]), [[INSTALL, "vyre-ai-renamed", "selected"], [9002, "other-org", "selected"]]);
  h.on("GET /app", { status: 401, body: {} });
  await refused(appGet(h.ctx), "provider.auth_failed");
});

// ---- installation tokens

test("an installation token is minted once, reused while it has time, and renewed before it lapses", async () => {
  const h = harness();
  const mint = h.reach();
  h.on("GET /repos/vyre-ai/website", { status: 200, body: RECORDED.repo });
  await repoGet(h.ctx, { repo: "vyre-ai/website" });
  const bearer = (i: number) => h.requests[i]!.headers.authorization;
  assert.deepEqual(h.requests.map((r) => `${r.method} ${r.path}`), ["GET /repos/vyre-ai/website/installation", "POST /app/installations/9001/access_tokens", "GET /repos/vyre-ai/website"]);
  assert.deepEqual([bearer(0), bearer(1), bearer(2)], ["Bearer jwt_1", "Bearer jwt_2", "Bearer ghs_token_1"], "the App JWT asks; the installation token does the work");
  await repoGet(h.ctx, { repo: "vyre-ai/website" });
  assert.equal(h.withPath("POST", "/app/installations/9001/access_tokens").length, 1, "the token is reused");
  assert.equal(h.withPath("GET", "/repos/vyre-ai/website/installation").length, 1, "and so is the installation lookup");
  h.advance(54 * MIN);
  await repoGet(h.ctx, { repo: "vyre-ai/website" });
  assert.equal(h.withPath("POST", "/app/installations/9001/access_tokens").length, 1, "six minutes left is enough");
  h.advance(2 * MIN);
  mint.next();
  await repoGet(h.ctx, { repo: "vyre-ai/website" });
  assert.equal(h.withPath("POST", "/app/installations/9001/access_tokens").length, 2, "four minutes left is not");
  assert.equal(h.requests.at(-1)!.headers.authorization, "Bearer ghs_token_2");
});

test("a 401 on an installation token drops it and tries once more with a new one; a second 401 is a refused App", async () => {
  const h = harness();
  h.on("GET /repos/vyre-ai/website/installation", { status: 200, body: { id: INSTALL } });
  const tokenReply = (token: string) => ({ status: 201, body: { token, expires_at: new Date(NOW + HOUR).toISOString() } });
  h.on("POST /app/installations/9001/access_tokens", tokenReply("ghs_a"), tokenReply("ghs_b"));
  h.on("GET /repos/vyre-ai/website", { status: 401, body: { message: "Bad credentials" } }, { status: 200, body: RECORDED.repo });
  const out = await repoGet(h.ctx, { repo: "vyre-ai/website" });
  assert.equal(out.repo, "vyre-ai/website");
  const gets = h.withPath("GET", "/repos/vyre-ai/website");
  assert.deepEqual(gets.map((r) => r.headers.authorization), ["Bearer ghs_a", "Bearer ghs_b"]);
  const stuck = harness();
  stuck.reach();
  stuck.on("GET /repos/vyre-ai/website", { status: 401, body: {} });
  await refused(repoGet(stuck.ctx, { repo: "vyre-ai/website" }), "provider.auth_failed");
  assert.equal(stuck.withPath("GET", "/repos/vyre-ai/website").length, 2, "one retry and no more");
});

test("git gets a filler handle and never the token; the token can be narrowed to one repository", async () => {
  const h = harness();
  h.reach();
  const out = await installationToken(h.ctx, { repo: "vyre-ai/website" });
  assert.deepEqual(contractErrors("github.installation_token", "out", out), []);
  assert.deepEqual(out, { handle: "#GitHub_Filler_1", expiresAt: NOW + HOUR });
  assert.ok(!JSON.stringify(out).includes("ghs_token"), "the token leaves this module only through the filler");
  assert.deepEqual(h.fillers, [{ token: "ghs_token_1", expiresAt: NOW + HOUR, repo: "vyre-ai/website" }]);
  assert.deepEqual(h.withPath("POST", "/app/installations/9001/access_tokens")[0]!.body, { repositories: ["website"] });
  await installationToken(h.ctx, { repo: "vyre-ai/website" });
  assert.equal(h.withPath("POST", "/app/installations/9001/access_tokens").length, 2, "git always gets a fresh token");
  await refused(installationToken(h.ctx, { repo: "vyre-ai/.." }), "validation.bad_input");
});

test("the installation is the one named, the one that holds the repository, or the Space's only one", async () => {
  const h = harness();
  h.tokenEndpoint();
  h.on("GET /app/installations", { status: 200, body: RECORDED.installations });
  const only = await installationToken(h.ctx, {});
  assert.equal(only.handle, "#GitHub_Filler_1");
  assert.equal(h.withPath("POST", "/app/installations/9001/access_tokens")[0]!.body, null, "no repository, no narrowing");
  h.on("GET /app/installations", { status: 200, body: RECORDED.installationsTwo });
  await refused(installationToken(h.ctx, {}), "validation.precondition_failed");
  h.on("GET /app/installations", { status: 200, body: [] });
  await refused(installationToken(h.ctx, {}), "validation.precondition_failed");
  const named = harness();
  named.tokenEndpoint(9002);
  await installationToken(named.ctx, { installationId: 9002 });
  assert.deepEqual(named.requests.map((r) => `${r.method} ${r.path}`), ["POST /app/installations/9002/access_tokens"], "a named installation needs no lookup");
  await refused(installationToken(named.ctx, { installationId: 0 }), "validation.bad_input");
});

// ---- repositories and branches

test("repositories are listed a page at a time with a total, and searched across pages", async () => {
  const h = harness();
  h.on("GET /app/installations", { status: 200, body: RECORDED.installations });
  h.tokenEndpoint();
  const all = RECORDED.repos.repositories;
  h.on("GET /installation/repositories", { status: 200, body: { total_count: 3, repositories: all.slice(0, 2) } }, { status: 200, body: { total_count: 3, repositories: all.slice(2) } });
  const one = await reposList(h.ctx, { limit: 2 });
  assert.deepEqual(contractErrors("github.repos.list", "out", one), []);
  assert.deepEqual(one.repos.map((r) => r.repo), ["vyre-ai/website", "vyre-ai/vyre"]);
  assert.deepEqual([one.next, one.total], ["2", 3]);
  assert.deepEqual(h.withPath("GET", "/installation/repositories")[0]!.query, { per_page: "2", page: "1" });
  assert.equal(one.repos[1]!.private, true);
  assert.equal(one.repos[1]!.defaultBranch, "trunk");
  const two = await reposList(h.ctx, { limit: 2, cursor: one.next! });
  assert.deepEqual([two.repos.map((r) => r.repo), two.next], [["vyre-ai/docs"], undefined]);
  h.on("GET /installation/repositories", { status: 200, body: RECORDED.repos });
  const found = await reposList(h.ctx, { query: "DOCS" });
  assert.deepEqual(found.repos.map((r) => r.repo), ["vyre-ai/docs"]);
  const some = await reposList(h.ctx, { query: "vyre-ai/", limit: 2 });
  assert.deepEqual([some.repos.length, some.next, some.total], [2, "2", 3]);
  const rest = await reposList(h.ctx, { query: "vyre-ai/", limit: 2, cursor: some.next! });
  assert.deepEqual([rest.repos.length, rest.next], [1, undefined]);
  await refused(reposList(h.ctx, { cursor: "0" }), "validation.bad_input");
  await refused(reposList(h.ctx, { limit: 0 }), "validation.bad_input");
});

test("one repository is read and its branches listed with their commit and protection", async () => {
  const h = harness();
  h.reach();
  h.on("GET /repos/vyre-ai/website", { status: 200, body: RECORDED.repo });
  const repo = await repoGet(h.ctx, { repo: "vyre-ai/website" });
  assert.deepEqual(contractErrors("github.repo.get", "out", repo), []);
  assert.deepEqual(repo, { repo: "vyre-ai/website", private: false, defaultBranch: "main", url: "https://github.com/vyre-ai/website", description: "The firm site" });
  h.on("GET /repos/vyre-ai/website/branches", { status: 200, body: RECORDED.branches });
  const branches = await branchesList(h.ctx, { repo: "vyre-ai/website", limit: 2 });
  assert.deepEqual(contractErrors("github.branches.list", "out", branches), []);
  assert.deepEqual(branches.branches, [{ name: "main", sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", protected: true }, { name: "fix/intake", sha: "ffffffffffffffffffffffffffffffffffffffff", protected: false }]);
  assert.equal(branches.next, "2", "a full page may have another behind it");
  const last = await branchesList(h.ctx, { repo: "vyre-ai/website", limit: 3 });
  assert.equal(last.next, undefined);
  h.on("GET /repos/vyre-ai/website", { status: 404, body: { message: "Not Found" } });
  await refused(repoGet(h.ctx, { repo: "vyre-ai/website" }), "validation.not_found");
  await refused(repoGet(h.ctx, { repo: "vyre-ai/a b" }), "validation.bad_input");
  await refused(repoGet(h.ctx, { repo: "../website" }), "validation.bad_input");
});

test("GitHub's refusals map to the catalogue: rate limits, a missing permission, a missing item, a server error", async () => {
  const cases: [number, unknown, string][] = [
    [403, RECORDED.rateLimited, "provider.rate_limited"], [429, {}, "provider.rate_limited"], [403, RECORDED.forbidden, "provider.auth_failed"],
    [404, { message: "Not Found" }, "validation.not_found"], [422, { message: "Validation Failed" }, "validation.bad_input"], [502, {}, "provider.unavailable"], [418, {}, "provider.bad_response"],
  ];
  for (const [status, body, code] of cases) {
    const h = harness();
    h.reach();
    h.on("GET /repos/vyre-ai/website", { status, body });
    await assert.rejects(repoGet(h.ctx, { repo: "vyre-ai/website" }), (e: unknown) => {
      assert.equal(codeOf(e), code, String(status));
      assert.ok(!JSON.stringify(e).includes("Resource not accessible"), "GitHub's words are not passed on");
      return true;
    });
  }
  const net = harness();
  net.reach();
  net.on("GET /repos/vyre-ai/website", { status: 200, throws: true });
  await refused(repoGet(net.ctx, { repo: "vyre-ai/website" }), "provider.network");
});

// ---- health

test("health asks GitHub for the App: healthy with a latency, down on a refused key, degraded when slow or limited", async () => {
  const h = harness();
  h.on("GET /app", { status: 200, body: RECORDED.app });
  const ok = await health(h.ctx);
  assert.deepEqual(contractErrors("github.health", "out", ok), []);
  assert.equal(ok.state, "healthy");
  h.on("GET /app", { status: 401, body: {} });
  assert.equal((await health(h.ctx)).state, "down");
  h.on("GET /app", { status: 429, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET /app", { status: 502, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET /app", { status: 200, throws: true });
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "GitHub could not be reached." });
  setGithubHost({ ...h.host, appJwt: async (ctx) => { throw fail("provider.auth_failed", ctx.trace.traceId); } });
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "The GitHub App is not set up. Create it in Settings, Integrations." });
  setGithubHost(null);
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "GitHub is not set up on this server." });
});

// ---- the webhook signature

// HMAC-SHA256 of the body under whsec_gh_not_real, computed outside this code base.
const BODY = '{"zen":"Keep it logically awesome."}';
const KNOWN = "sha256=41e8142ee97d3de7f2340b512a15e3a95ff8c74b85ae40b7627aface7d90313d";

test("the signature is sha256= and the hex HMAC-SHA256 of the body under the webhook secret", async () => {
  assert.equal(await signatureOf(WEBHOOK_SECRET, BODY), KNOWN);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, KNOWN, BODY), true);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, KNOWN, `${BODY} `), false);
  assert.equal(await signatureMatches("whsec_other", KNOWN, BODY), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, KNOWN.replace(/.$/, "0"), BODY), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, KNOWN.slice("sha256=".length), BODY), false, "the prefix is part of the header");
  assert.equal(await signatureMatches(WEBHOOK_SECRET, KNOWN.toUpperCase(), BODY), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, KNOWN.slice(0, 30), BODY), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, "", BODY), false);
});

test("the route verifies the signature first: unsigned or forged is refused, a signed ping or event is handed on, a signed event Vyre does not follow is dropped", async () => {
  const h = harness();
  const ok = { signature: KNOWN, event: "ping", deliveryId: "d-1", body: BODY };
  await refused(verifyWebhook(h.ctx, { ...ok, signature: undefined }), "auth.bad_credentials");
  await refused(verifyWebhook(h.ctx, { ...ok, signature: "sha256=00" }), "auth.bad_credentials");
  await refused(verifyWebhook(h.ctx, { ...ok, body: `${BODY} ` }), "auth.bad_credentials");
  assert.deepEqual(await verifyWebhook(h.ctx, ok), { deliveryId: "d-1", event: "ping" });
  assert.equal(await verifyWebhook(h.ctx, { ...ok, event: "star" }), null);
  await refused(verifyWebhook(h.ctx, { ...ok, event: undefined }), "validation.bad_input");
  await refused(verifyWebhook(h.ctx, { ...ok, deliveryId: undefined }), "validation.bad_input");
  const junk = "not json";
  await refused(verifyWebhook(h.ctx, { signature: await signatureOf(WEBHOOK_SECRET, junk), event: "ping", deliveryId: "d-2", body: junk }), "validation.bad_input");
});
