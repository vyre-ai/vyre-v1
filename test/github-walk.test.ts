// A walk of "my GitHub" as a real person, end to end on the real pieces and a fake GitHub (lane l-ci-runners): connect through the callback route and the PKCE state, the refresh token sealed in the
// person's own Vault and read back by its handle, a repository the person does not reach refused, Ask me first holding a card until it is approved, the policy, and a CLI session getting GH_TOKEN and the
// git helper in its environment from the real filler. Real: the github handlers, the host seam, the vault module (Mine sealing), the tickets, the connect route, the filler, the engine's github-session.
// Fake: GitHub (OAuth and API) and the Gate's hold.
// @reads /modules/github/handlers/me.ts
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fail } from "../host/src/routes/errors.ts";
import { createGithubConnectRoute } from "../host/src/routes/github-connect.ts";
import { createGithubHost } from "../host/src/seams/comms.ts";
import { createGithub } from "../host/src/seams/people.ts";
import { createFiller } from "../host/src/seams/filler.ts";
import { createGithubTickets } from "../host/src/seams/github-tickets.ts";
import { harness as githubWorld, INSTALL } from "../modules/github/fixtures/harness.ts";
import { ensure } from "../modules/github/projections.ts";
import * as me from "../modules/github/handlers/me.ts";
import { harness as vaultWorld, keyOfPerson } from "../modules/vault/fixtures/harness.ts";
import { mineSet, mineRemove } from "../modules/vault/handlers/mine-host.ts";
import * as u from "../modules/vault/handlers/use.ts";
import { setKeyPort } from "../modules/vault/handlers/crypto.ts";
import { githubEnv } from "../modules/engine/github-session.ts";

const PERSON = "usr_maya01";
const TRACE = "0123456789abcdef0123456789abcdef";

test("walk: connect, reach, a refused repository, Ask me first, the policy and a CLI session", async () => {
  const g = githubWorld(), v = vaultWorld();
  try {
    ensure(g.ctx);
    g.ctx.db.run(`INSERT INTO github_app ("id", "appId", "slug", "name", "permissions", "events", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, "app", 1, "vyre-northwind", "Vyre", "{}", "[]", 0);
    setKeyPort({ async personKey(id) { return keyOfPerson(id); } });
    v.actAs("service", "svc_host");

    // ---- the host: a fake GitHub for OAuth, the real tickets, filler and the person's Vault
    const sent: string[] = [];
    const tickets = createGithubTickets(), processEnv = new Map<string, string>();
    const filler = createFiller({ process_env: (ref, value) => { processEnv.set(ref, value); } }, () => g.ctx.now());
    const fakeGithub = async (url: string, init?: { method?: string; body?: string | Uint8Array }) => {
      sent.push(`${init?.method ?? "GET"} ${url}`);
      const body = url.includes("/login/oauth/access_token") ? { access_token: "ghu_walk_1", refresh_token: "ghr_walk_1", expires_in: 28800 } : url.endsWith("/user") ? { id: 4242, login: "maya-codes" } : {};
      return { status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const seam = createGithubHost({
      vault: u.secretPort(v.ctx.db) as never, fetch: fakeGithub as never, blobs: {} as never, filler, tickets, publicUrl: async () => "https://space.vyre.test",
      hostCall: async (name, input) => (name === "vault.mine_set" ? mineSet(v.ctx, input as never) : name === "vault.mine_remove" ? mineRemove(v.ctx, input as never) : {}),
      defaultApp: () => ({ clientId: "Iv1.vyre", clientSecret: "vyre_secret" }),
    });
    g.host.user = seam.user as never;
    g.host.fillerHandle = async (_c, a) => filler.hold(a.token, a.expiresAt);
    // GitHub's API for the person's own token
    g.on("GET /user", { status: 200, body: { login: "maya-codes", id: 4242 } });
    g.on("GET /user/installations", { status: 200, body: { installations: [{ id: INSTALL, account: { login: "vyre-ai" }, repository_selection: "selected" }] } });
    g.on(`GET /user/installations/${INSTALL}/repositories`, { status: 200, body: { repositories: [{ full_name: "vyre-ai/website" }] } });
    g.on("GET /user/orgs", { status: 200, body: [{ login: "vyre-ai", id: 9 }, { login: "closed-org", id: 10 }] });
    g.tokenEndpoint();
    // the Gate: an Ask me first call is held until the person approves
    const gate = { held: 0, linked: [] as string[] };
    const base = g.ctx.call.bind(g.ctx);
    g.ctx.call = async (cap, input) => {
      if (cap === "github.me.approve") { gate.held++; throw fail("permission.needs_approval", TRACE); }
      if (cap === "identity.github_link") { gate.linked.push((input as { code: string }).code); return { login: "maya-codes" }; }
      return base(cap, input);
    };

    // ---- 1. connect: the address, GitHub's callback through the route, then the person finishes
    const c = await me.meConnect(g.ctx, { return: "https://space.vyre.test/settings" });
    assert.equal(c.source, "vyre", "no Space app, so the default Vyre app");
    assert.equal(new URL(c.authUrl).searchParams.get("redirect_uri"), "https://space.vyre.test/hooks/github/connect");
    const route = createGithubConnectRoute();
    let location = "";
    const req = { url: `/hooks/github/connect?code=gh-code-1&state=${encodeURIComponent(c.state)}`, method: "GET", headers: { host: "space.vyre.test", "x-forwarded-proto": "https" }, socket: {} } as unknown as http.IncomingMessage;
    const res = { writeHead: (_s: number, h: Record<string, string>) => { location = h.location!; }, end: () => undefined } as unknown as http.ServerResponse;
    assert.equal(route.handle(req, res), true);
    const frag = new URLSearchParams(new URL(location).hash.slice(1));
    assert.equal(new URL(location).origin + new URL(location).pathname, "https://space.vyre.test/settings");
    const done = await me.meComplete(g.ctx, { code: frag.get("github_connect_code")!, state: frag.get("github_connect_state")! });
    assert.deepEqual(done, { login: "maya-codes", source: "vyre" });
    await assert.rejects(me.meComplete(g.ctx, { code: "gh-code-1", state: c.state }), (e: any) => e.error.code === "validation.bad_input");   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await me.meStatus(g.ctx)).connected, true);
    assert.equal(gate.linked.length, 1, "connecting also linked the sign-in");
    assert.match(gate.linked[0]!, /^vyre-gh-link\./);
    assert.equal(tickets.takeLink(gate.linked[0]!)?.login, "maya-codes", "the ticket the host minted stands for who GitHub said");

    // ---- 2. the refresh token is in the person's own Vault, sealed, and nowhere else
    const item = v.rows(`SELECT * FROM vault_meta WHERE "owner" = ?`, PERSON)[0]!;
    assert.equal(item.scope, "mine");
    assert.equal(v.rows(`SELECT * FROM vault_secret WHERE "itemId" = ?`, item.id as string)[0]!.enc, 2);
    assert.equal(await u.secretPort(v.ctx.db).secret(`${item.handle}.refresh_token`, "", PERSON), "ghr_walk_1");
    assert.equal(JSON.stringify([v.everything(), g.emitted, g.rows("SELECT * FROM github_me")]).includes("ghr_walk_1"), false, "not in a row, an event or a log");

    // ---- 3. reach, and a repository the person does not reach
    const reach = await me.meReach(g.ctx);
    assert.deepEqual(reach.orgs.map((o) => [o.login, o.install]), [["vyre-ai", "selected"], ["closed-org", "none"]]);
    assert.deepEqual(reach.repos, [{ repo: "vyre-ai/website", installationId: INSTALL }]);
    await assert.rejects(me.token(g.ctx, { repo: "vyre-ai/private-notes", action: "read", consumer: "crew" }), (e: any) => e.error.code === "validation.not_found");   // eslint-disable-line @typescript-eslint/no-explicit-any

    // ---- 4. Ask me first holds a card; once approved the token comes, and the filler holds it, not the module
    await assert.rejects(me.token(g.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" }), (e: any) => e.error.code === "permission.needs_approval");   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(gate.held, 1);
    me.meApprove(g.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" });
    const t = await me.token(g.ctx, { repo: "vyre-ai/website", action: "open_pr", consumer: "crew" });
    assert.match(t.handle, /^#fill_/);
    assert.equal(JSON.stringify(t).includes("ghs_"), false);
    await assert.rejects(me.token(g.ctx, { repo: "vyre-ai/website", action: "push_default", consumer: "crew" }), (e: any) => e.error.code === "validation.precondition_failed");   // eslint-disable-line @typescript-eslint/no-explicit-any

    // ---- 5. a CLI session: the engine asks the broker as the person and takes the token out of the real filler
    const port = {
      call: async (cap: string, input: unknown) => {
        if (cap === "threads.get") return { thread: { scopeType: "project", scopeId: "prj_site" } };
        if (cap === "projects.get") return { project: { folderId: "fld_site" } };
        if (cap === "git.status") return { remotes: [{ name: "origin", url: "https://github.com/vyre-ai/website.git" }] };
        if (cap === "github.session_env") return me.sessionEnv(g.ctx, input as never);
        throw new Error(`no ${cap}`);
      },
      fill: (handle: string) => { const ref = `pe_${handle}`; if (!filler.fill(handle, { kind: "process_env", ref }, g.ctx.now())) return null; const x = processEnv.get(ref) ?? null; processEnv.delete(ref); return x; },
    };
    const env = await githubEnv(port, PERSON, "thr_1");
    assert.match(env["GH_TOKEN"]!, /^ghs_token_/, "the real token, in the process environment only");
    assert.equal(env["GITHUB_TOKEN"], env["GH_TOKEN"]);
    assert.equal(env["GIT_CONFIG_COUNT"], "2");
    const mint = g.withPath("POST", `/app/installations/${INSTALL}/access_tokens`).at(-1)!;
    assert.deepEqual(mint.body, { repositories: ["website"], permissions: { contents: "read", pull_requests: "read", issues: "read", checks: "read", metadata: "read" } }, "the session got read only: everything else asks");
    me.policySet(g.ctx, { policy: { read: "ask" } });
    assert.deepEqual(await githubEnv(port, PERSON, "thr_1"), {}, "when reading asks first, a session gets no token");
    assert.deepEqual(me.meUsage(g.ctx).uses.map((x) => x.consumer).sort(), ["crew", "session.engine"]);

    // ---- 6. disconnect: revoked, the Vault item in the Trash, the next ask refused
    g.on("DELETE /applications/Iv1.vyre/grant", { status: 204, body: {} });
    assert.deepEqual(await me.meDisconnect(g.ctx), { disconnected: true });
    assert.equal(v.rows(`SELECT * FROM vault_meta WHERE "owner" = ? AND "deleted_at" IS NULL`, PERSON).length, 0);
    assert.equal((await me.meStatus(g.ctx)).connected, false);
    assert.ok(sent.some((s) => s.startsWith("DELETE https://api.github.com/applications/Iv1.vyre/grant")), "the grant was revoked at GitHub");
  } finally { v.cleanup(); }
});

test("walk: signing in with GitHub through the default Vyre app connects it too, and connecting it links the sign-in", async () => {
  const g = githubWorld(), v = vaultWorld();
  try {
    ensure(g.ctx);
    setKeyPort({ async personKey(id) { return keyOfPerson(id); } });
    v.actAs("service", "svc_host");
    const tickets = createGithubTickets(), filler = createFiller({}, () => g.ctx.now());
    const fetched: string[] = [];
    const f = (async (url: string) => {
      fetched.push(String(url));
      const body = String(url).includes("access_token") ? { access_token: "ghu_signin_1", refresh_token: "ghr_signin_1", expires_in: 28800 } : { id: 4242, login: "maya-codes" };
      return { json: async () => body, text: async () => JSON.stringify(body), status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    }) as never;
    const seam = createGithubHost({
      vault: u.secretPort(v.ctx.db) as never, fetch: f, blobs: {} as never, filler, tickets, publicUrl: async () => "https://space.vyre.test",
      hostCall: async (name, input) => (name === "vault.mine_set" ? mineSet(v.ctx, input as never) : {}),
      defaultApp: () => ({ clientId: "Iv1.vyre", clientSecret: "vyre_secret" }),
    });
    g.host.user = seam.user as never;
    g.host.fillerHandle = async (_c, a) => filler.hold(a.token, a.expiresAt);
    // Settings, GitHub, "Sign in with GitHub": the identity module calls resolve(code) and then signedIn(id, person) once the session exists
    const sign = createGithub({ clientId: "Iv1.vyre", clientSecret: "vyre_secret", fetch: f }, tickets, (githubId, person) => me.adoptSignIn(g.ctx, { githubId, person }));
    assert.deepEqual(await sign.resolve("sign-in-code"), { id: "4242", login: "maya-codes" });
    assert.equal((await me.meStatus(g.ctx)).connected, false, "not connected until the sign-in finishes");
    await sign.signedIn!("4242", PERSON);
    const st = await me.meStatus(g.ctx);
    assert.equal(st.connected, true);
    assert.equal(st.login, "maya-codes");
    assert.equal(st.source, "vyre", "the default Vyre app");
    const item = v.rows(`SELECT * FROM vault_meta WHERE "owner" = ?`, PERSON)[0]!;
    assert.equal(await u.secretPort(v.ctx.db).secret(`${item.handle}.refresh_token`, "", PERSON), "ghr_signin_1");
    assert.equal(JSON.stringify([v.everything(), g.emitted]).includes("ghr_signin_1"), false);
    assert.deepEqual(me.policyGet(g.ctx).policy, { read: "always", push_branch: "ask", open_pr: "ask", comment: "ask", merge: "ask", push_default: "never" });
    // a second sign-in does not disturb the connection, and a server with no app says so
    assert.deepEqual(await me.adoptSignIn(g.ctx, { githubId: "4242", person: PERSON }), { adopted: false });
    const none = createGithubHost({ vault: u.secretPort(v.ctx.db) as never, fetch: f, blobs: {} as never, tickets });
    await assert.rejects(none.user!.app({ space: "spc", trace: { traceId: TRACE }, now: () => 0, db: { all: () => [] } } as never), (e: any) => e.error.code === "internal.unavailable" && /VYRE_GH_OAUTH_CLIENT_ID/.test(e.error.message));   // eslint-disable-line @typescript-eslint/no-explicit-any
  } finally { v.cleanup(); }
});
