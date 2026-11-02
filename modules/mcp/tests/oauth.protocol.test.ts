// Sign-in for outside agents, the rules one at a time, on real SQLite: discovery, registration, the exact redirect, PKCE, one use of a code, rotation, a replay ending the grant, binding to this address, and the page a client opens.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import { ACCESS_MS, CODE_MS, REFRESH_MS, REQUEST_MS, beginAuthorize, challengeOf, cleanClientName, collect, exchange, grantForAccess, protectedResource, redirectKind, registerClient, revokeGrant, sameRedirect, serverMetadata } from "../oauth.ts";
import { allowTab, refusalPage } from "../allow-page.ts";
import { handlers } from "../impl.ts";

const ORIGIN = "https://acme.vyre.run";
const RESOURCE = `${ORIGIN}/mcp`;
const VERIFIER = "v".repeat(60);
const h = handlers as unknown as Record<string, (ctx: unknown, input: any) => Promise<any> | any>;

function client(hn: Harness, redirect = "http://127.0.0.1:4100/cb", name: unknown = "Claude Code"): string {
  ensure(hn.db);
  const r = registerClient(hn.db, { client_name: name, redirect_uris: [redirect] }, hn.clock.t);
  assert.ok("client" in r);
  return String((r as { client: { client_id: string } }).client.client_id);
}
const query = (clientId: string, over: Record<string, string | undefined> = {}, redirect = "http://127.0.0.1:4100/cb") => ({
  client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challengeOf(VERIFIER), code_challenge_method: "S256", state: "st8", resource: RESOURCE, ...over,
});
const people = (hn: Harness) => ({ ...hn.ctx, call: async (cap: string) => (cap === "agents.outside.connect" ? { agentId: "agt_out", name: "Claude Code" } : cap === "agents.get" ? { agent: { name: "Claude Code" } } : { space: { name: "Acme" } }) });

/** Register, ask, press Allow, collect: the code the client's redirect receives. */
async function code(hn: Harness, redirect = "http://127.0.0.1:4100/cb", id = client(hn, redirect)): Promise<{ clientId: string; code: string; redirect: string }> {
  const b = beginAuthorize(hn.db, query(id, {}, redirect), ORIGIN, hn.clock.t);
  assert.equal(b.kind, "page");
  if (b.kind !== "page") throw new Error("no page");
  await h["mcp.oauth.allow"]!(people(hn), { requestId: b.request.requestId });
  const w = collect(hn.db, b.request.requestId, b.proof, ORIGIN, hn.clock.t);
  assert.equal(w?.status, "allowed");
  const u = new URL((w as { redirect: string }).redirect);
  assert.equal(u.searchParams.get("state"), "st8");
  assert.equal(u.searchParams.get("iss"), ORIGIN);
  return { clientId: id, code: u.searchParams.get("code") as string, redirect };
}
async function tokens(hn: Harness): Promise<{ clientId: string; access: string; refresh: string }> {
  const c = await code(hn);
  const r = exchange(hn.db, { grant_type: "authorization_code", client_id: c.clientId, code: c.code, redirect_uri: c.redirect, code_verifier: VERIFIER, resource: RESOURCE }, ORIGIN, hn.clock.t);
  assert.ok("tokens" in r);
  return { clientId: c.clientId, access: r.tokens.access_token, refresh: r.tokens.refresh_token };
}
const failure = (r: ReturnType<typeof exchange>): string => ("error" in r ? r.error : "no error");

test("metadata says what a client must see: this address, S256 only, the iss parameter, and no password grant", () => {
  assert.deepEqual(protectedResource(ORIGIN), { resource: RESOURCE, authorization_servers: [ORIGIN], bearer_methods_supported: ["header"], resource_name: "Vyre" });
  const m = serverMetadata(ORIGIN);
  assert.equal(m["issuer"], ORIGIN);
  assert.deepEqual(m["code_challenge_methods_supported"], ["S256"]);
  assert.deepEqual(m["grant_types_supported"], ["authorization_code", "refresh_token"]);
  assert.deepEqual(m["token_endpoint_auth_methods_supported"], ["none"]);
  assert.equal(m["authorization_response_iss_parameter_supported"], true);
});

test("registration takes https and loopback only, and a client's words are made safe to show", () => {
  const hn = harness();
  ensure(hn.db);
  for (const bad of ["http://example.com/cb", "javascript:alert(1)", "https://a.example/cb#frag", "https://user:pw@a.example/cb", "cursor://x/cb", "not a url"]) {
    const r = registerClient(hn.db, { redirect_uris: [bad] }, hn.clock.t);
    assert.equal("error" in r && r.error, "invalid_redirect_uri", bad);
  }
  assert.equal("error" in registerClient(hn.db, { redirect_uris: [] }, hn.clock.t), true);
  assert.equal("error" in registerClient(hn.db, {}, hn.clock.t), true);
  assert.equal(redirectKind("http://localhost:9/cb"), "loopback");
  assert.equal(redirectKind("http://[::1]:9/cb"), "loopback");
  assert.equal(redirectKind("https://a.example/cb"), "https");
  assert.equal(cleanClientName("Claude‮ Code\n\u0000"), "Claude Code");
  assert.equal(cleanClientName(""), "An MCP app");
  assert.equal(cleanClientName(42), "An MCP app");
  assert.equal(cleanClientName("x".repeat(500)).length, 60);
});

test("wrong redirect: an address the client did not register is a page, never a redirect", () => {
  const hn = harness();
  const id = client(hn, "https://tools.example.com/cb");
  for (const wrong of ["https://evil.example/cb", "https://tools.example.com/cb2", "https://tools.example.com:8443/cb", "https://tools.example.com/cb?x=1", "http://127.0.0.1:1/cb"]) {
    const b = beginAuthorize(hn.db, query(id, {}, wrong), ORIGIN, hn.clock.t);
    assert.equal(b.kind, "refuse", wrong);
  }
  assert.equal(beginAuthorize(hn.db, query("mcl_unknown"), ORIGIN, hn.clock.t).kind, "refuse");
  // a loopback app picks its port when it runs (RFC 8252 7.3); nothing else may change
  assert.equal(sameRedirect("http://127.0.0.1:4100/cb", "http://127.0.0.1:5200/cb"), true);
  assert.equal(sameRedirect("http://127.0.0.1:4100/cb", "http://localhost:4100/cb"), false);
  assert.equal(sameRedirect("http://127.0.0.1:4100/cb", "http://127.0.0.1:4100/other"), false);
  assert.equal(sameRedirect("https://a.example:1/cb", "https://a.example:2/cb"), false);
});

test("after the redirect is known, every other mistake goes back to the client, with its state and the issuer", () => {
  const hn = harness();
  const id = client(hn);
  const go = (over: Record<string, string | undefined>): URL => {
    const b = beginAuthorize(hn.db, query(id, over), ORIGIN, hn.clock.t);
    assert.equal(b.kind, "redirect");
    return new URL((b as { to: string }).to);
  };
  assert.equal(go({ response_type: "token" }).searchParams.get("error"), "unsupported_response_type");
  assert.equal(go({ code_challenge_method: "plain" }).searchParams.get("error"), "invalid_request");
  assert.equal(go({ code_challenge_method: undefined }).searchParams.get("error"), "invalid_request");
  assert.equal(go({ code_challenge: undefined }).searchParams.get("error"), "invalid_request");
  const other = go({ resource: "https://other.vyre.run/mcp" });
  assert.equal(other.searchParams.get("error"), "invalid_target");
  assert.equal(other.searchParams.get("state"), "st8");
  assert.equal(other.searchParams.get("iss"), ORIGIN);
  assert.equal(other.searchParams.has("code"), false);
});

test("wrong PKCE: a verifier that does not match gets nothing, and the code is burned", async () => {
  const hn = harness();
  const c = await code(hn);
  const wrong = exchange(hn.db, { grant_type: "authorization_code", client_id: c.clientId, code: c.code, redirect_uri: c.redirect, code_verifier: "w".repeat(60) }, ORIGIN, hn.clock.t);
  assert.equal(failure(wrong), "invalid_grant");
  const right = exchange(hn.db, { grant_type: "authorization_code", client_id: c.clientId, code: c.code, redirect_uri: c.redirect, code_verifier: VERIFIER }, ORIGIN, hn.clock.t);
  assert.equal(failure(right), "invalid_grant", "a burned code does not work with the right verifier either");
  const c2 = await code(hn);
  assert.equal(failure(exchange(hn.db, { grant_type: "authorization_code", client_id: c2.clientId, code: c2.code, redirect_uri: c2.redirect }, ORIGIN, hn.clock.t)), "invalid_grant", "no verifier at all");
  assert.equal(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), createHash("sha256").update("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").digest("base64url"));
  assert.equal(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "the vector of RFC 7636");
});

test("the token request must name the redirect and the client the code was made for", async () => {
  const hn = harness();
  const c = await code(hn);
  assert.equal(failure(exchange(hn.db, { grant_type: "authorization_code", client_id: c.clientId, code: c.code, redirect_uri: "http://127.0.0.1:9999/other", code_verifier: VERIFIER }, ORIGIN, hn.clock.t)), "invalid_grant");
  const c2 = await code(hn);
  const stranger = client(hn);
  assert.equal(failure(exchange(hn.db, { grant_type: "authorization_code", client_id: stranger, code: c2.code, redirect_uri: c2.redirect, code_verifier: VERIFIER }, ORIGIN, hn.clock.t)), "invalid_grant");
  assert.equal(failure(exchange(hn.db, { grant_type: "authorization_code", client_id: "mcl_unknown", code: c2.code, redirect_uri: c2.redirect, code_verifier: VERIFIER }, ORIGIN, hn.clock.t)), "invalid_client");
  assert.equal(failure(exchange(hn.db, { grant_type: "password", client_id: c2.clientId }, ORIGIN, hn.clock.t)), "unsupported_grant_type");
  assert.equal(failure(exchange(hn.db, { grant_type: "authorization_code", client_id: c2.clientId, code: c2.code, redirect_uri: c2.redirect, code_verifier: VERIFIER, resource: "https://other.vyre.run/mcp" }, ORIGIN, hn.clock.t)), "invalid_target");
});

test("replayed code: the second use fails and ends everything the first use got", async () => {
  const hn = harness();
  const c = await code(hn);
  const form = { grant_type: "authorization_code", client_id: c.clientId, code: c.code, redirect_uri: c.redirect, code_verifier: VERIFIER };
  const first = exchange(hn.db, form, ORIGIN, hn.clock.t);
  assert.ok("tokens" in first);
  assert.ok(grantForAccess(hn.db, first.tokens.access_token, ORIGIN, hn.clock.t));
  const replay = exchange(hn.db, form, ORIGIN, hn.clock.t);
  assert.equal(failure(replay), "invalid_grant");
  assert.ok("replayed" in replay && replay.replayed);
  assert.equal(grantForAccess(hn.db, first.tokens.access_token, ORIGIN, hn.clock.t), null, "the token from the first use is gone");
  assert.equal(failure(exchange(hn.db, { grant_type: "refresh_token", client_id: c.clientId, refresh_token: first.tokens.refresh_token }, ORIGIN, hn.clock.t)), "invalid_grant");
});

test("a code lasts a minute", async () => {
  const hn = harness();
  const c = await code(hn);
  hn.advance(CODE_MS);
  assert.equal(failure(exchange(hn.db, { grant_type: "authorization_code", client_id: c.clientId, code: c.code, redirect_uri: c.redirect, code_verifier: VERIFIER }, ORIGIN, hn.clock.t)), "invalid_grant");
});

test("refresh rotates: the old token is spent and the new pair works", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const r = exchange(hn.db, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: t.refresh, resource: RESOURCE }, ORIGIN, hn.clock.t);
  assert.ok("tokens" in r);
  assert.notEqual(r.tokens.refresh_token, t.refresh);
  assert.ok(grantForAccess(hn.db, r.tokens.access_token, ORIGIN, hn.clock.t));
});

test("replayed refresh: a spent refresh token ends the sign-in, for the thief and the client alike", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const r = exchange(hn.db, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: t.refresh }, ORIGIN, hn.clock.t);
  assert.ok("tokens" in r);
  const replay = exchange(hn.db, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: t.refresh }, ORIGIN, hn.clock.t);
  assert.equal(failure(replay), "invalid_grant");
  assert.equal(grantForAccess(hn.db, r.tokens.access_token, ORIGIN, hn.clock.t), null);
  assert.equal(failure(exchange(hn.db, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: r.tokens.refresh_token }, ORIGIN, hn.clock.t)), "invalid_grant", "the rotated token went with it");
});

test("expired token: an access token stops at 15 minutes, a refresh token at 30 days", async () => {
  const hn = harness();
  const t = await tokens(hn);
  hn.advance(ACCESS_MS - 1);
  assert.ok(grantForAccess(hn.db, t.access, ORIGIN, hn.clock.t));
  hn.advance(1);
  assert.equal(grantForAccess(hn.db, t.access, ORIGIN, hn.clock.t), null);
  hn.advance(REFRESH_MS);
  assert.equal(failure(exchange(hn.db, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: t.refresh }, ORIGIN, hn.clock.t)), "invalid_grant");
});

test("a token is for one address: another Space's, or a refresh token used as an access token, opens nothing", async () => {
  const hn = harness();
  const t = await tokens(hn);
  assert.equal(grantForAccess(hn.db, t.access, "https://other.vyre.run", hn.clock.t), null);
  assert.equal(grantForAccess(hn.db, t.access, undefined, hn.clock.t), null);
  assert.equal(grantForAccess(hn.db, t.refresh, ORIGIN, hn.clock.t), null);
  assert.equal(failure(exchange(hn.db, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: t.refresh }, "https://other.vyre.run", hn.clock.t)), "invalid_grant");
});

test("nothing kept is a secret: codes and tokens are hashes", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const all = JSON.stringify([...hn.rows("SELECT * FROM mcp_oauth_tokens"), ...hn.rows("SELECT * FROM mcp_oauth_grants"), ...hn.rows("SELECT * FROM mcp_oauth_requests")]);
  assert.equal(all.includes(t.access), false);
  assert.equal(all.includes(t.refresh), false);
});

test("revoking a grant ends every code and token under it at once", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const grant = grantForAccess(hn.db, t.access, ORIGIN, hn.clock.t)!;
  revokeGrant(hn.db, grant.grantId, "removed", hn.clock.t);
  assert.equal(grantForAccess(hn.db, t.access, ORIGIN, hn.clock.t), null);
  assert.equal(hn.rows("SELECT COUNT(*) AS n FROM mcp_oauth_tokens WHERE grant_id = ?", grant.grantId)[0]!["n"], 0);
});

test("only the tab that asked collects the code, once; a press alone gives nobody anything", async () => {
  const hn = harness();
  const id = client(hn);
  const b = beginAuthorize(hn.db, query(id), ORIGIN, hn.clock.t);
  if (b.kind !== "page") throw new Error("no page");
  assert.deepEqual(collect(hn.db, b.request.requestId, b.proof, ORIGIN, hn.clock.t), { status: "waiting" });
  await h["mcp.oauth.allow"]!(people(hn), { requestId: b.request.requestId });
  assert.equal(collect(hn.db, b.request.requestId, "vyp_wrong", ORIGIN, hn.clock.t), null);
  assert.equal(hn.rows("SELECT COUNT(*) AS n FROM mcp_oauth_tokens WHERE kind = 'code'")[0]!["n"], 0, "no code exists until the tab collects it");
  assert.equal(collect(hn.db, b.request.requestId, b.proof, ORIGIN, hn.clock.t)?.status, "allowed");
  assert.equal(collect(hn.db, b.request.requestId, b.proof, ORIGIN, hn.clock.t)?.status, "done");
});

test("a request ends in five minutes, a no goes back to the client, and a press counts once", async () => {
  const hn = harness();
  const id = client(hn);
  const b = beginAuthorize(hn.db, query(id), ORIGIN, hn.clock.t);
  if (b.kind !== "page") throw new Error("no page");
  await h["mcp.oauth.decline"]!(hn.ctx, { requestId: b.request.requestId });
  const no = collect(hn.db, b.request.requestId, b.proof, ORIGIN, hn.clock.t) as { status: string; redirect: string };
  assert.equal(no.status, "declined");
  assert.equal(new URL(no.redirect).searchParams.get("error"), "access_denied");

  const c = beginAuthorize(hn.db, query(id), ORIGIN, hn.clock.t);
  if (c.kind !== "page") throw new Error("no page");
  hn.advance(REQUEST_MS);
  assert.equal(collect(hn.db, c.request.requestId, c.proof, ORIGIN, hn.clock.t)?.status, "expired");

  const d = beginAuthorize(hn.db, query(id), ORIGIN, hn.clock.t);
  if (d.kind !== "page") throw new Error("no page");
  await h["mcp.oauth.allow"]!(people(hn), { requestId: d.request.requestId });
  await assert.rejects(() => h["mcp.oauth.allow"]!(people(hn), { requestId: d.request.requestId }));
});

test("the same app signing in again stays the same agent, and the old sign-in ends", async () => {
  const hn = harness();
  const a = await code(hn);
  const form = { grant_type: "authorization_code", client_id: a.clientId, code: a.code, redirect_uri: a.redirect, code_verifier: VERIFIER };
  const first = exchange(hn.db, form, ORIGIN, hn.clock.t);
  assert.ok("tokens" in first);
  const before = grantForAccess(hn.db, first.tokens.access_token, ORIGIN, hn.clock.t)!;
  const again = await code(hn, a.redirect, a.clientId);
  const second = exchange(hn.db, { ...form, code: again.code }, ORIGIN, hn.clock.t);
  assert.ok("tokens" in second);
  const after = grantForAccess(hn.db, second.tokens.access_token, ORIGIN, hn.clock.t)!;
  assert.equal(after.agentId, before.agentId);
  assert.notEqual(after.grantId, before.grantId);
  assert.equal(grantForAccess(hn.db, first.tokens.access_token, ORIGIN, hn.clock.t), null);
});

test("an agent cannot answer: Allow, decline and reading a request are a person's, signed in as themselves", async () => {
  const hn = harness();
  const id = client(hn);
  const b = beginAuthorize(hn.db, query(id), ORIGIN, hn.clock.t);
  if (b.kind !== "page") throw new Error("no page");
  const agent = { ...people(hn), principal: { kind: "agent", id: "agt_x" }, actingFor: "usr_dana" };
  const through = { ...people(hn), actingFor: "usr_sam" };
  for (const ctx of [agent, through]) for (const cap of ["mcp.oauth.allow", "mcp.oauth.decline", "mcp.oauth.request"]) {
    await assert.rejects(async () => h[cap]!(ctx, { requestId: b.request.requestId }), (e: { error?: { code?: string } }) => e.error?.code === "permission.no_grant", cap);
  }
  await assert.rejects(async () => h["mcp.connected.remove"]!(agent, { agentId: "agt_x" }), (e: { error?: { code?: string } }) => e.error?.code === "permission.no_grant");
});

test("Remove: only its owner or an admin, and the sign-in ends", async () => {
  const hn = harness();
  const t = await tokens(hn);
  const stranger = { ...people(hn), principal: { kind: "person", id: "usr_sam" }, authorize: () => ({ effect: "deny" }) };
  await assert.rejects(async () => h["mcp.connected.remove"]!(stranger, { agentId: "agt_out" }), (e: { error?: { code?: string } }) => e.error?.code === "validation.not_found");
  assert.ok(grantForAccess(hn.db, t.access, ORIGIN, hn.clock.t));
  await h["mcp.connected.remove"]!(people(hn), { agentId: "agt_out" });
  assert.equal(grantForAccess(hn.db, t.access, ORIGIN, hn.clock.t), null);
  assert.deepEqual((await h["mcp.connected.list"]!(hn.ctx, {})).agents, []);
});

test("the tab: no Allow button, framed by nobody, a hostile name inert and marked, and the host named when it is not this computer", () => {
  const page = allowTab({ clientName: '<script>alert(1)</script>"', spaceName: "Acme", match: "4821", requestId: "oar_1", proof: "vyp_1", origin: ORIGIN, redirectHost: "evil.example" });
  assert.equal(page.body.includes("<script>alert(1)"), false);
  assert.match(page.body, /That name is what the app calls itself\. Vyre has not checked it\./);
  assert.match(page.body, /<b>evil\.example<\/b>, not an app on this computer/);
  assert.equal(/>Allow</.test(page.body), false, "the press happens in Vyre");
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(page.headers["content-security-policy"], /form-action 'none'/);
  assert.match(page.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.equal(page.headers["cache-control"], "no-store");
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(page.body)?.[1] ?? "";
  assert.equal(script.includes("</script"), false);
  assert.equal(allowTab({ clientName: "Claude Code", spaceName: "Acme", match: "4821", requestId: "oar_1", proof: "vyp_1", origin: ORIGIN }).body.includes("not an app on this computer"), false, "a loopback redirect stays quiet");
  assert.equal(refusalPage("<b>x", "y").body.includes("<b>x"), false);
});
