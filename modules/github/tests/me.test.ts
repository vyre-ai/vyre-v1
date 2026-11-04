// A person's own GitHub and the token broker (lane l-ci-runners): connect with PKCE, the refresh token kept in the person's Vault and rotated, reach, policy, the broker's narrowed tokens, Ask me first through the Gate,
// agents only on the person's own turns, the session's environment, usage and disconnect. GitHub and the host are scripted stand-ins.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fail } from "../../../host/src/routes/errors.ts";
import { adoptSignIn, checkRead, meApprove, meComplete, meConnect, meDisconnect, meReach, meStatus, meUsage, policyGet, policySet, sessionEnv, token } from "../handlers/me.ts";
import { codeOf, INSTALL, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import type { GithubCtx, UserTokens } from "../projections.ts";

const HOUR = 3_600_000;
const MAYA = "usr_maya01";

async function refused(p: Promise<unknown> | unknown, code: string): Promise<void> {
  await assert.rejects(Promise.resolve(p), (e: unknown) => { assert.equal(codeOf(e), code); return true; });
}

function world() {
  const h = harness();
  const pending = new Set<string>(), kept = new Map<string, string>(), exchanges: Array<{ code: string; verifier: string; redirectUri: string }> = [], revoked: string[] = [], forgotten: string[] = [];
  let n = 1, now = () => h.ctx.now();
  const user = {
    app: async () => ({ clientId: "Iv1.vyre", source: "vyre" as const }),
    exchange: async (_c: GithubCtx, a: { code: string; verifier: string; redirectUri: string }): Promise<UserTokens> => { exchanges.push(a); return { accessToken: "ghu_1", refreshToken: "ghr_1", expiresAt: now() + 8 * HOUR, linkTicket: "vyre-gh-link.t1" }; },
    refresh: async (_c: GithubCtx, a: { refreshToken: string }): Promise<UserTokens> => {
      if (a.refreshToken === "revoked") throw fail("provider.auth_failed", "0123456789abcdef0123456789abcdef");
      n++; return { accessToken: `ghu_${n}`, refreshToken: `ghr_${n}`, expiresAt: now() + 8 * HOUR };
    },
    revoke: async (_c: GithubCtx, a: { accessToken: string }) => { revoked.push(a.accessToken); },
    adopt: async (_c: GithubCtx, a: { githubId: string }) => (pending.delete(a.githubId) ? { login: "maya-codes", accessToken: "ghu_sign", refreshToken: "ghr_sign", expiresAt: now() + 8 * HOUR } : null),
    keep: async (_c: GithubCtx, person: string, a: { refreshToken: string }) => { kept.set(person, a.refreshToken); },
    recall: async (_c: GithubCtx, person: string) => kept.get(person) ?? null,
    forget: async (_c: GithubCtx, person: string) => { forgotten.push(person); kept.delete(person); },
    redirectUri: async () => "https://space.vyre.test/hooks/github/connect",
  };
  h.host.user = user;
  ensure(h.ctx);
  h.ctx.db.run(`INSERT INTO github_app ("id", "appId", "slug", "name", "permissions", "events", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, "app", 1, "vyre-northwind", "Vyre", "{}", "[]", 0);
  h.on("GET /user", { status: 200, body: { login: "maya-codes", id: 4242 } });
  h.on("GET /user/installations", { status: 200, body: { installations: [{ id: INSTALL, account: { login: "vyre-ai" }, repository_selection: "selected" }] } });
  h.on(`GET /user/installations/${INSTALL}/repositories`, { status: 200, body: { repositories: [{ full_name: "vyre-ai/website" }, { full_name: "vyre-ai/docs" }] } });
  h.on("GET /user/orgs", { status: 200, body: [{ login: "vyre-ai", id: 9 }, { login: "other-org", id: 10 }, { login: "installed-all", id: 11 }] });
  h.tokenEndpoint();
  // the Gate: the first approve is held (needs approval); `release` is the person pressing Approve, which runs the handler
  const gate = { held: [] as Array<Record<string, unknown>>, linked: [] as string[], releaseNext: false };
  const base = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    if (cap === "github.me.approve") {
      gate.held.push(input as Record<string, unknown>);
      throw fail("permission.needs_approval", "0123456789abcdef0123456789abcdef");
    }
    if (cap === "identity.github_link") { gate.linked.push(String((input as { code: string }).code)); return { login: "maya-codes" }; }
    return base(cap, input);
  };
  const as = (who: Partial<GithubCtx>): GithubCtx => ({ ...h.ctx, ...who });
  const connect = async (): Promise<void> => { const c = await meConnect(h.ctx); await meComplete(h.ctx, { code: "code1", state: c.state }); };
  return { h, user, pending, kept, exchanges, revoked, forgotten, gate, as, connect };
}

test("connect: PKCE through the default Vyre app, the refresh token goes to the person's Vault, the same state works once", async () => {
  const w = world();
  assert.deepEqual(meStatus(w.h.ctx), { connected: false, needsReconnect: false });
  const c = await meConnect(w.h.ctx);
  const url = new URL(c.authUrl);
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Iv1.vyre");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(c.source, "vyre");
  assert.deepEqual(await meComplete(w.h.ctx, { code: "abc", state: c.state }), { login: "maya-codes", source: "vyre" });
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(w.exchanges[0]!.verifier).digest("base64url"), "the challenge is the hash of the verifier the exchange proves");
  assert.equal(w.exchanges[0]!.redirectUri, "https://space.vyre.test/hooks/github/connect");
  assert.equal(w.kept.get(MAYA), "ghr_1");
  const st = meStatus(w.h.ctx);
  assert.equal(st.connected, true);
  assert.equal(st.login, "maya-codes");
  assert.equal(w.h.named("github.me_connected").length, 1);
  assert.equal(JSON.stringify(w.h.emitted).includes("ghr_1") || JSON.stringify(w.h.emitted).includes("ghu_1"), false, "no token in an event");
  assert.equal(JSON.stringify(w.h.rows("SELECT * FROM github_me")).includes("ghr_"), false, "no token in the module's table");
  await refused(meComplete(w.h.ctx, { code: "abc", state: c.state }), "validation.bad_input");
  const other = await meConnect(w.h.ctx);
  await refused(meComplete(w.as({ principal: { kind: "person", id: "usr_other" } }), { code: "x", state: other.state }), "validation.bad_input");
  await refused(meConnect(w.as({ principal: { kind: "agent", id: "agt_1" } })), "permission.no_grant");
});

test("connect: a Space's own app is used when an admin set one up", async () => {
  const w = world();
  w.h.host.user = { ...w.user, app: async () => ({ clientId: "Iv1.northwind", source: "space" as const }) };
  const c = await meConnect(w.h.ctx);
  assert.equal(c.source, "space");
  assert.equal(new URL(c.authUrl).searchParams.get("client_id"), "Iv1.northwind");
});

test("refresh: the access token is renewed from the Vault's refresh token before it ends, GitHub's new refresh token replaces the old one, and a refused refresh asks for a new connection", async () => {
  const w = world();
  await w.connect();
  w.h.advance(7 * HOUR);
  await token(w.h.ctx, { repo: "vyre-ai/website", action: "read", consumer: "crew" });
  assert.equal(w.h.withPath("GET", "/user/installations").at(-1)!.headers.authorization, "Bearer ghu_1", "still the first token");
  w.h.advance(HOUR - 30_000);   // under a minute left
  await token(w.h.ctx, { repo: "vyre-ai/website", action: "read", consumer: "crew" });
  assert.equal(w.kept.get(MAYA), "ghr_2", "the rotated refresh token is kept");
  assert.equal(w.h.withPath("GET", "/user/installations").at(-1)!.headers.authorization, "Bearer ghu_2");
  w.kept.set(MAYA, "revoked");
  w.h.advance(9 * HOUR);
  await refused(token(w.h.ctx, { repo: "vyre-ai/website", action: "read", consumer: "crew" }), "provider.auth_failed");
  assert.equal(meStatus(w.h.ctx).needsReconnect, true);
});

test("reach: organisations with their install state and the address to install or ask, and the repositories reached", async () => {
  const w = world();
  await w.connect();
  w.h.on("GET /user/installations", { status: 200, body: { installations: [{ id: INSTALL, account: { login: "vyre-ai" }, repository_selection: "selected" }, { id: 9002, account: { login: "installed-all" }, repository_selection: "all" }] } });
  w.h.on("GET /user/installations/9002/repositories", { status: 200, body: { repositories: [{ full_name: "installed-all/a" }] } });
  const r = await meReach(w.h.ctx);
  assert.deepEqual(r.orgs, [
    { login: "vyre-ai", install: "selected", url: `https://github.com/organizations/vyre-ai/settings/installations/${INSTALL}` },
    { login: "other-org", install: "none", url: "https://github.com/apps/vyre-northwind/installations/new/permissions?target_id=10" },
    { login: "installed-all", install: "all", url: "https://github.com/organizations/installed-all/settings/installations/9002" },
  ]);
  assert.deepEqual(r.repos, [{ repo: "vyre-ai/website", installationId: INSTALL }, { repo: "vyre-ai/docs", installationId: INSTALL }, { repo: "installed-all/a", installationId: 9002 }]);
  assert.equal(r.login, "maya-codes");
});

test("policy: sensible defaults, changed per kind of use, and a bad value refused", async () => {
  const w = world();
  await w.connect();
  assert.deepEqual(policyGet(w.h.ctx).policy, { read: "always", push_branch: "always", open_pr: "always", comment: "always", merge: "ask", push_default: "ask" });
  assert.equal(policySet(w.h.ctx, { policy: { comment: "always" } }).policy.comment, "always");
  await refused(Promise.resolve().then(() => policySet(w.h.ctx, { policy: { merge: "maybe" as never } })), "validation.bad_input");
  await refused(Promise.resolve().then(() => policySet(w.h.ctx, { policy: { delete_repo: "always" } as never })), "validation.bad_input");
});

test("broker: a token is short-lived, narrowed to one repository and to what the kind of use needs, handed out as a handle, and noted for the Used by list", async () => {
  const w = world();
  await w.connect();
  const t = await token(w.h.ctx, { repo: "vyre-ai/website", action: "read", consumer: "linked.prs" });
  assert.match(t.handle, /^#GitHub_Filler_/);
  const mint = w.h.withPath("POST", `/app/installations/${INSTALL}/access_tokens`).at(-1)!;
  assert.deepEqual(mint.body, { repositories: ["website"], permissions: { contents: "read", pull_requests: "read", issues: "read", checks: "read", metadata: "read" } });
  assert.equal(JSON.stringify(t).includes("ghs_"), false, "the token itself never leaves");
  assert.equal(w.h.fillers.length, 1);
  assert.equal(w.h.fillers[0]!.repo, "vyre-ai/website");
  w.h.advance(5 * 60_000);
  await token(w.h.ctx, { repo: "vyre-ai/docs", action: "read", consumer: "crew" });
  const uses = meUsage(w.h.ctx).uses;
  assert.deepEqual(uses.map((u) => [u.consumer, u.repo, u.action]), [["crew", "vyre-ai/docs", "read"], ["linked.prs", "vyre-ai/website", "read"]]);
  await refused(token(w.h.ctx, { repo: "vyre-ai/secret", action: "read", consumer: "crew" }), "validation.not_found");
  await refused(token(w.h.ctx, { repo: "elsewhere/x", action: "read", consumer: "crew" }), "validation.not_found");
  await refused(token(w.h.ctx, { repo: "vyre-ai/website", action: "delete" as never, consumer: "crew" }), "validation.bad_input");
});

test("policy: Never refuses with the person's own words; Ask me first goes to the Gate and a token follows once approved, for ten minutes", async () => {
  const w = world();
  await w.connect();
  policySet(w.h.ctx, { policy: { push_default: "never" } });
  await assert.rejects(token(w.h.ctx, { repo: "vyre-ai/website", action: "push_default", consumer: "crew" }), (e: unknown) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.match((e as Error & { error: { message: string } }).error.message, /never let anything push to the default branch/); return true; });
  policySet(w.h.ctx, { policy: { open_pr: "ask" } });
  await refused(token(w.h.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" }), "permission.needs_approval");
  assert.deepEqual(w.gate.held, [{ repo: "vyre-ai/website", action: "open_pr", consumer: "crew" }]);
  assert.equal(w.h.withPath("POST", `/app/installations/${INSTALL}/access_tokens`).length, 0, "nothing minted while held");
  assert.deepEqual(meApprove(w.h.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" }), { approved: true });   // the person pressed Approve: the Gate released the call
  const t = await token(w.h.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" });
  assert.deepEqual(t.permissions, { pull_requests: "write", contents: "read", metadata: "read" });
  assert.equal(w.gate.held.length, 1, "no second question inside the ten minutes");
  await refused(token(w.h.ctx, { repo: "vyre-ai/docs", action: "open_pr", consumer: "crew" }), "permission.needs_approval");   // another repository asks again
  w.h.advance(11 * 60_000);
  await refused(token(w.h.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" }), "permission.needs_approval");
  policySet(w.h.ctx, { policy: { open_pr: "always" } });
  assert.ok((await token(w.h.ctx, { repo: "vyre-ai/docs", action: "open_pr", consumer: "crew" })).handle);
});

test("agents: an agent uses a person's GitHub only on that person's own turn", async () => {
  const w = world();
  await w.connect();
  const agent = w.as({ principal: { kind: "agent", id: "agt_scout" }, actingFor: MAYA });
  assert.ok((await token(agent, { repo: "vyre-ai/website", action: "read", consumer: "agent.github" })).handle);
  assert.equal(meUsage(w.h.ctx).uses.some((u) => u.consumer === "agent.github"), true);
  await refused(token(w.as({ principal: { kind: "agent", id: "agt_scout" } }), { repo: "vyre-ai/website", action: "read", consumer: "agent.github" }), "permission.no_grant");   // no one's turn
  await refused(token(agent, { person: "usr_other", repo: "vyre-ai/website", action: "read", consumer: "agent.github" }), "permission.no_grant");           // someone else's GitHub
  await refused(token(w.as({ principal: { kind: "service", id: "svc_host" } }), { person: MAYA, repo: "vyre-ai/website", action: "read", consumer: "crew" }), "permission.no_grant");   // the host alone is not a turn
  await refused(token(w.as({ principal: { kind: "person", id: "usr_other" } }), { person: MAYA, repo: "vyre-ai/website", action: "read", consumer: "crew" }), "permission.no_grant");
});

test("session: Claude Code, Codex and Grok get GH_TOKEN as a handle and a credential helper, only for what the person lets run without asking", async () => {
  const w = world();
  await w.connect();
  const agent = w.as({ principal: { kind: "agent", id: "agt_scout" }, actingFor: MAYA });
  const s = await sessionEnv(agent, { repos: ["vyre-ai/website", "vyre-ai/docs", "other-org/x", "vyre-ai/hidden"], consumer: "session.claude_code" });
  assert.deepEqual(s.repos, ["vyre-ai/website", "vyre-ai/docs"]);
  assert.deepEqual(s.skipped, ["other-org/x", "vyre-ai/hidden"]);
  assert.match(s.env["GH_TOKEN"]!, /^#GitHub_Filler_/);
  assert.equal(s.env["GH_TOKEN"], s.env["GITHUB_TOKEN"]);
  assert.match(s.gitConfig.join("\n"), /password=\$GH_TOKEN/);
  const mint = w.h.withPath("POST", `/app/installations/${INSTALL}/access_tokens`).at(-1)!;
  assert.deepEqual(mint.body, { repositories: ["website", "docs"], permissions: { contents: "read", pull_requests: "read", issues: "read", checks: "read", metadata: "read" } }, "only read: everything else asks");
  policySet(w.h.ctx, { policy: { read: "ask" } });
  await refused(sessionEnv(agent, { repos: ["vyre-ai/website"], consumer: "session.codex" }), "validation.precondition_failed");
  await refused(sessionEnv(w.as({ principal: { kind: "agent", id: "agt_scout" } }), { repos: ["vyre-ai/website"], consumer: "session.grok" }), "permission.no_grant");
});

test("disconnect: the grant is revoked, the Vault item and approvals are gone, and the status says disconnected", async () => {
  const w = world();
  await w.connect();
  meApprove(w.h.ctx, { repo: "vyre-ai/website", action: "merge", consumer: "crew" });
  assert.deepEqual(await meDisconnect(w.h.ctx), { disconnected: true });
  assert.deepEqual(w.revoked, ["ghu_1"]);
  assert.deepEqual(w.forgotten, [MAYA]);
  assert.equal(w.kept.has(MAYA), false);
  assert.equal(meStatus(w.h.ctx).connected, false);
  assert.equal(w.h.rows("SELECT * FROM github_grant").length, 0);
  assert.equal(w.h.named("github.me_disconnected").length, 1);
  assert.deepEqual(await meDisconnect(w.h.ctx), { disconnected: false });
  await refused(token(w.h.ctx, { repo: "vyre-ai/website", action: "read", consumer: "crew" }), "validation.precondition_failed");
});

test("a server without the personal connection says so plainly", async () => {
  const h = harness();
  await refused(meConnect(h.ctx), "internal.unavailable");
});

test("a read for a linked pull request follows the person's rules and shows in Used by; a caller with no connected GitHub reads as before", async () => {
  const w = world();
  await checkRead(w.h.ctx, "vyre-ai/website", "linked.prs");   // not connected yet: nothing changes
  assert.equal(meUsage(w.as({})).uses.length, 0);
  await w.connect();
  await checkRead(w.as({ principal: { kind: "agent", id: "agt_scout" }, actingFor: MAYA }), "vyre-ai/website", "linked.prs");
  assert.deepEqual(meUsage(w.h.ctx).uses.map((u) => [u.consumer, u.action]), [["linked.prs", "read"]]);
  await refused(checkRead(w.h.ctx, "vyre-ai/secret", "linked.prs"), "validation.not_found");
  policySet(w.h.ctx, { policy: { read: "never" } });
  await refused(checkRead(w.h.ctx, "vyre-ai/website", "linked.prs"), "validation.precondition_failed");
  await checkRead(w.as({ principal: { kind: "service", id: "svc_host" } }), "vyre-ai/website", "linked.prs");   // the host with no person: the Space app's read
});

test("one flow: connecting also links the sign-in with the host's ticket (never returned), and signing in with GitHub connects when it left tokens", async () => {
  const w = world();
  await w.connect();
  assert.deepEqual(w.gate.linked, ["vyre-gh-link.t1"]);
  const state = (await meConnect(w.h.ctx)).state;
  assert.match(state, /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]+$/, "the state carries where to return to, for the callback");
  const w2 = world();
  const other = w2.as({ principal: { kind: "person", id: "usr_new0001" } });
  w2.pending.add("4242");
  assert.deepEqual(await adoptSignIn(other, { githubId: "4242", person: "usr_new0001" }), { adopted: true });
  assert.equal(w2.kept.get("usr_new0001"), "ghr_sign");
  assert.equal(meStatus(other).login, "maya-codes");
  assert.equal(policyGet(other).policy.read, "always");
  assert.deepEqual(await adoptSignIn(other, { githubId: "4242", person: "usr_new0001" }), { adopted: false }, "already connected: left as is");
  assert.deepEqual(await adoptSignIn(w2.as({}), { githubId: "9", person: "usr_none0001" }), { adopted: false }, "a sign-in that left no tokens connects nothing");
});

test("a return address rides in the state and a custom one is kept", async () => {
  const w = world();
  const c = await meConnect(w.h.ctx, { return: "https://space.vyre.test/settings" });
  assert.equal(Buffer.from(c.state.split(".")[1]!, "base64url").toString(), "https://space.vyre.test/settings");
});
