// OAuth for connectors: PKCE and the state bound to who started it, tokens only in the Vault, refresh (serialized, once), revoke, and honest errors that never carry a code, verifier or token.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OAUTHAPP } from "../fixtures/acme.ts";
import { kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";
import type { ConnectorDef } from "../projections.ts";

const code = (c: string) => (e: unknown) => { assert.equal((e as { error?: { code?: string } }).error?.code, c); return true; };
const APP: ConnectorDef = { ...OAUTHAPP, auth: { ...OAUTHAPP.auth, revokeUrl: "https://login.oauthapp.test/revoke" }, actions: [{ name: "me", url: "https://api.oauthapp.test/me", output: "/user" }] };

async function started(k: Kit, o: { owner?: "person" | "space"; def?: ConnectorDef } = {}) {
  k.install(o.def ?? APP);
  k.vault["#AppClientSecret"] = "client-secret-VALUE";
  const made = await k.hs["connections.create"](k.ctx, { connector: "oauthapp", title: "My app", ownerKind: o.owner ?? "person", secrets: { App_ClientSecret: "#AppClientSecret" } } as never);
  const url = new URL(made.authUrl!);
  return { made, url, state: url.searchParams.get("state")!, id: made.connection.connectionId };
}
const tokens = (k: Kit, access = "at_ACCESS1", refresh = "rt_REFRESH1", extra: Record<string, unknown> = {}) => { k.state.reply = (req) => req.url.endsWith("/token") ? { status: 200, body: { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, ...extra } } : { status: 200, body: { user: { name: "Dana" } } }; };
const formOf = (body: string | undefined) => new URLSearchParams(body);

test("the sign-in address carries a PKCE S256 challenge, and the code exchange sends the verifier that matches it", async () => {
  const k = kit(); const s = await started(k);
  assert.equal(s.url.searchParams.get("code_challenge_method"), "S256");
  const challenge = s.url.searchParams.get("code_challenge")!;
  tokens(k);
  await k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "code-ABC1" });
  const verifier = formOf(k.sent[0]!.body).get("code_verifier")!;
  assert.ok(verifier.length >= 43, "an RFC 7636 verifier");
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), challenge, "the verifier answers the challenge that was sent");
  assert.equal(k.tx.all("SELECT * FROM cn_oauth_flow").length, 0, "the flow row is gone with the state");
});

test("someone else cannot finish or spend a sign-in: they are refused before the state is used, and the person who started it still can", async () => {
  const k = kit(); const s = await started(k);
  tokens(k);
  const other = k.mk("usr_eve");
  await assert.rejects(k.hs["connections.complete_auth"](other, { state: s.state, code: "stolen" }), code("permission.no_grant"));
  assert.equal(k.sent.length, 0, "nothing was sent to the app");
  assert.equal(k.tx.all("SELECT * FROM cn_oauth WHERE state = ?", s.state).length, 1, "the state is not spent");
  assert.equal((await k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "mine" })).connectionId, s.id);
});

test("a Space connection too: only the person who started it finishes it", async () => {
  const k = kit(); const s = await started(k, { owner: "space", def: { ...APP, scope: "space" } });
  tokens(k);
  await assert.rejects(k.hs["connections.complete_auth"](k.mk("usr_admin2"), { state: s.state, code: "x" }), code("permission.no_grant"));
  assert.equal((await k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "x" })).connectionId, s.id);
});

test("a declined sign-in says so, spends the state, and keeps nothing; so does an expired one", async () => {
  const k = kit(); const s = await started(k);
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s.state, error: "access_denied" }), (e: unknown) => /declined/.test((e as Error).message) && (e as { error: { details: { reason: string } } }).error.details.reason === "declined");
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "late" }), code("auth.invalid_code"));
  assert.equal(k.sent.length, 0); assert.equal(k.stored.length, 0);
  const s2 = await started(kit()); void s2;
  const k2 = kit(); const t = await started(k2);
  k2.clock.t += 11 * 60_000;
  await assert.rejects(k2.hs["connections.complete_auth"](k2.ctx, { state: t.state, code: "x" }), code("auth.invalid_code"));
  assert.equal(k2.tx.all("SELECT * FROM cn_oauth").length, 0, "an expired state is spent too");
});

test("tokens go only to Vault items: Mine for a person, Shared for the Space; the connection keeps handles, and no table or log holds a value", async () => {
  const k = kit(); const s = await started(k);
  tokens(k);
  await k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "code-ABC2" });
  assert.deepEqual(k.vaultFolders.map((f) => [f.name, f.scope]), [["Connections", "mine"]]);
  assert.equal(Object.keys(k.items).length, 2, "an access item and a refresh item");
  const dump = JSON.stringify([k.tx.all("SELECT * FROM cn_connections"), k.tx.all("SELECT * FROM cn_oauth"), k.tx.all("SELECT * FROM cn_oauth_flow"), k.tx.all("SELECT * FROM cn_oauth_tokens"), k.events, k.logs]);
  for (const v of ["at_ACCESS1", "rt_REFRESH1", "client-secret-VALUE", "code-ABC2"]) assert.equal(dump.includes(v), false, `${v} is not kept outside the Vault`);
  const space = kit(); const t = await started(space, { owner: "space", def: { ...APP, scope: "space" } });
  tokens(space);
  await space.hs["connections.complete_auth"](space.ctx, { state: t.state, code: "c" });
  assert.deepEqual(space.vaultFolders.map((f) => f.scope), ["shared"]);
});

test("a person's tokens are never put anywhere shared: with the vault locked the sign-in is refused with guidance and nothing is stored", async () => {
  const k = kit(); const s = await started(k);
  tokens(k);
  k.vaultFault.next = { error: { code: "auth.unauthenticated", message: "Your vault key is locked. Sign in again to open your Mine items." } };
  await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "c" }), (e: unknown) => (e as { error: { code: string } }).error.code === "auth.unauthenticated" && /vault is locked on this computer/.test((e as Error).message));
  assert.equal(k.stored.length, 0);
  assert.equal(k.vaultFolders.filter((f) => f.scope === "shared").length, 0, "never a Shared fallback");
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: s.id })).connection.state, "pending");
});

test("a token response that is not a usable bearer token is refused: wrong type, no token, absurd lifetime, oversize", async () => {
  for (const body of [{ access_token: "a_TOKEN1", token_type: "mac" }, { token_type: "bearer" }, { access_token: "a_TOKEN1", expires_in: -5 }, { access_token: "a_TOKEN1", expires_in: 1e12 }, { access_token: "x".repeat(9000) }]) {
    const k = kit(); const s = await started(k);
    k.state.reply = () => ({ status: 200, body });
    await assert.rejects(k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "c" }), code("provider.bad_response"), JSON.stringify(body).slice(0, 60));
    assert.equal(k.stored.length, 0);
  }
});

test("errors never carry the code, the verifier, the client secret or a token", async () => {
  const k = kit(); const s = await started(k);
  k.state.reply = () => new Error("connect ECONNREFUSED while sending code-SECRETCODE and client-secret-VALUE");
  const err = await k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "code-SECRETCODE" }).catch((e: unknown) => e);
  const text = JSON.stringify(err);
  assert.equal((err as { error: { code: string } }).error.code, "provider.network");
  for (const v of ["code-SECRETCODE", "client-secret-VALUE"]) assert.equal(text.includes(v), false);
  assert.equal(JSON.stringify(k.logs).includes("code-SECRETCODE"), false);
});

async function connected(k: Kit, expiresIn = 3600) {
  const s = await started(k);
  tokens(k, "at_ACCESS1", "rt_REFRESH1", { expires_in: expiresIn });
  await k.hs["connections.complete_auth"](k.ctx, { state: s.state, code: "c" });
  k.sent.length = 0;
  return s.id;
}
const run = (k: Kit, id: string) => k.hs["connectors.run"](k.ctx, { key: "oauthapp", action: "me", connectionId: id, input: {} });

test("a rejected token is refreshed once and the call repeated with the new token; the handle and the connection stay", async () => {
  const k = kit(); const id = await connected(k);
  const handleBefore = JSON.parse(k.tx.get<{ secrets: string }>("SELECT secrets FROM cn_connections WHERE connection_id = ?", id)!.secrets).App_Token;
  let apiCalls = 0;
  k.state.reply = (req) => {
    if (req.url.endsWith("/token")) return { status: 200, body: { access_token: "at_ACCESS2", refresh_token: "rt_REFRESH2", token_type: "Bearer", expires_in: 3600 } };
    return req.headers["Authorization"] === "Bearer at_ACCESS1" ? (apiCalls++, { status: 401, body: {} }) : { status: 200, body: { user: { name: "Dana" } } };
  };
  const out = await run(k, id);
  assert.deepEqual(out.output, { name: "Dana" });
  const refresh = k.sent.find((r) => r.url.endsWith("/token"))!;
  assert.deepEqual([formOf(refresh.body).get("grant_type"), formOf(refresh.body).get("refresh_token")], ["refresh_token", "rt_REFRESH1"]);
  assert.equal(apiCalls, 1); assert.equal(k.sent.filter((r) => r.url.endsWith("/me")).length, 2, "the call was repeated once");
  const secrets = JSON.parse(k.tx.get<{ secrets: string }>("SELECT secrets FROM cn_connections WHERE connection_id = ?", id)!.secrets);
  assert.equal(secrets.App_Token, handleBefore, "the same Vault item, updated in place");
  assert.equal(k.vault[handleBefore], "at_ACCESS2");
  assert.equal(k.vault[secrets.App_Token_refresh], "rt_REFRESH2", "a rotated refresh token is kept");
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: id })).connection.state, "active");
});

test("when the refresh is refused or there is no refresh token, the connection asks to be reconnected; a repeat the app still rejects does not loop", async () => {
  const k = kit(); const id = await connected(k);
  k.state.reply = (req) => req.url.endsWith("/token") ? { status: 400, body: { error: "invalid_grant" } } : { status: 401, body: {} };
  await assert.rejects(run(k, id), code("provider.auth_failed"));
  assert.equal((await k.hs["connections.get"](k.ctx, { connectionId: id })).connection.state, "needs_reconnect");
  const k2 = kit(); const id2 = await connected(k2);
  let tokenCalls = 0;
  k2.state.reply = (req) => req.url.endsWith("/token") ? (tokenCalls++, { status: 200, body: { access_token: "at_ACCESS3", token_type: "Bearer" } }) : { status: 401, body: {} };
  await assert.rejects(run(k2, id2), code("provider.auth_failed"));
  assert.equal(tokenCalls, 1, "one refresh, one repeat, then reconnect");
  assert.equal((await k2.hs["connections.get"](k2.ctx, { connectionId: id2 })).connection.state, "needs_reconnect");
});

test("two calls that are rejected at once share ONE refresh, so a rotating refresh token is spent once", async () => {
  const k = kit(); const id = await connected(k);
  let refreshes = 0;
  k.state.reply = (req) => {
    if (req.url.endsWith("/token")) { refreshes++; return { status: 200, body: { access_token: "at_ACCESS2", refresh_token: "rt_REFRESH2", token_type: "Bearer" } }; }
    return req.headers["Authorization"] === "Bearer at_ACCESS1" ? { status: 401, body: {} } : { status: 200, body: { user: { name: "Dana" } } };
  };
  const [a, b] = await Promise.all([run(k, id), run(k, id)]);
  assert.deepEqual([a.output, b.output], [{ name: "Dana" }, { name: "Dana" }]);
  assert.equal(refreshes, 1);
});

test("a token that ends within a minute is refreshed before the call, not after a failure", async () => {
  const k = kit(); const id = await connected(k, 90);
  k.clock.t += 40_000;   // 50 s left: inside the minute
  const order: string[] = [];
  k.state.reply = (req) => { order.push(req.url.endsWith("/token") ? "refresh" : `api:${req.headers["Authorization"]}`); return req.url.endsWith("/token") ? { status: 200, body: { access_token: "at_ACCESS2", token_type: "Bearer", expires_in: 3600 } } : { status: 200, body: { user: { name: "Dana" } } }; };
  await run(k, id);
  assert.deepEqual(order, ["refresh", "api:Bearer at_ACCESS2"]);
});

test("deleting the connection revokes the tokens at the app when the connector declares how, then removes the Vault items", async () => {
  const k = kit(); const id = await connected(k);
  k.state.reply = () => ({ status: 200, body: {} });
  await k.hs["connections.delete"](k.ctx, { connectionId: id });
  const revokes = k.sent.filter((r) => r.url.endsWith("/revoke"));
  assert.deepEqual(revokes.map((r) => formOf(r.body).get("token")).sort(), ["at_ACCESS1", "rt_REFRESH1"]);
  assert.deepEqual(revokes.map((r) => formOf(r.body).get("token_type_hint")).sort(), ["access_token", "refresh_token"]);
  assert.equal(Object.keys(k.items).length, 0, "the Vault items are gone");
  assert.equal(k.tx.all("SELECT * FROM cn_oauth_tokens").length, 0);
  // an unreachable revoke address never blocks the delete
  const k2 = kit(); const id2 = await connected(k2);
  k2.state.reply = () => new Error("down");
  assert.deepEqual(await k2.hs["connections.delete"](k2.ctx, { connectionId: id2 }), { deleted: true });
});
