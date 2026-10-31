// @reads /modules/dropbox/migrations/0001_dropbox.sql
// @reads /modules/dropbox/handlers/connect.ts
// The Dropbox app and the sign-in (live folders L3): the app is a Vault item, a sign-in is OAuth with PKCE that only its starter can finish, the refresh token goes to the Vault (Mine for a person, Shared for
// the Space) and the connection is kept per owner. Replayed against recorded Dropbox bodies; no socket is opened.
import test from "node:test";
import assert from "node:assert/strict";
import * as d from "../handlers/index.ts";
import { ACCESS, APP_KEY, MAYA, OTHER, RECORDED, REFRESH, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const ME = "POST api.dropboxapi.com/2/users/get_current_account";

async function setUp(h: Harness): Promise<void> {
  await d.appSet(h.ctx, { vaultItem: "#Dropbox_App" });
}

test("app.set names the Vault item and keeps the public key only; status shows the redirect address", async () => {
  const h = harness();
  assert.deepEqual(out(await d.appStatus(h.ctx)), { configured: false });
  const set = out(await d.appSet(h.ctx, { vaultItem: "#Dropbox_App" }));
  assert.deepEqual(contractErrors("dropbox.app.set", "out", set), []);
  assert.deepEqual(set, { configured: true, appKey: APP_KEY, webhooks: true });
  const status = out(await d.appStatus(h.ctx));
  assert.deepEqual(contractErrors("dropbox.app.status", "out", status), []);
  assert.deepEqual(status, { configured: true, appKey: APP_KEY, vaultItem: "#Dropbox_App", redirectUri: "https://space.vyre.test/oauth/callback" });
  assert.ok(!JSON.stringify(h.rows(`SELECT * FROM dropbox_config`)).includes("appsecret_not_real"), "the secret is never kept");
  await d.appSet(h.ctx, { vaultItem: "#Dropbox_NoSecret" });
  assert.equal(h.rows(`SELECT * FROM dropbox_config`).length, 1, "set again replaces, never adds");
  assert.equal(out(await d.appSet(h.ctx, { vaultItem: "#Dropbox_NoSecret" }))["webhooks"], false);
  assert.equal(await refusedWith(d.appSet(h.ctx, { vaultItem: "Dropbox_App" })), "validation.bad_input");
  assert.equal(await refusedWith(d.appSet(h.ctx, { vaultItem: "#Dropbox_Missing" })), "provider.auth_failed");
});

test("connect.start needs the app, builds a PKCE address with offline access, and keeps the verifier here", async () => {
  const h = harness();
  assert.equal(await refusedWith(d.connectStart(h.ctx, {})), "validation.precondition_failed", "no app yet");
  await setUp(h);
  const start = out(await d.connectStart(h.ctx, {}));
  assert.deepEqual(contractErrors("dropbox.connect.start", "out", start), []);
  const u = new URL(start["authUrl"] as string);
  assert.equal(`${u.origin}${u.pathname}`, "https://www.dropbox.com/oauth2/authorize");
  const q = u.searchParams;
  assert.deepEqual([q.get("client_id"), q.get("response_type"), q.get("token_access_type"), q.get("code_challenge_method"), q.get("redirect_uri")], [APP_KEY, "code", "offline", "S256", "https://space.vyre.test/oauth/callback"]);
  assert.equal(q.get("state"), start["state"]);
  assert.match(String(start["state"]), /^dbs_[0-9a-f]{48}$/);
  assert.match(q.get("scope") ?? "", /files\.content\.write/);
  const row = h.rows(`SELECT * FROM dropbox_oauth`)[0]!;
  const verifier = String(row["verifier"]);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  assert.equal(q.get("code_challenge"), Buffer.from(new Uint8Array(digest)).toString("base64url"), "the challenge is the verifier's hash; the verifier is not in the address");
  assert.ok(!start["authUrl"]!.toString().includes(verifier));
});

test("a Space connection takes the admin grant", async () => {
  const h = harness({ allow: false });
  await setUp(h);
  assert.equal(await refusedWith(d.connectStart(h.ctx, { ownerKind: "space" })), "permission.no_grant");
  const ok = harness();
  await setUp(ok);
  assert.ok(out(await d.connectStart(ok.ctx, { ownerKind: "space" }))["state"]);
});

async function signIn(h: Harness, ownerKind: "person" | "space" = "person"): Promise<{ state: string; verifier: string }> {
  const start = out(await d.connectStart(h.ctx, { ownerKind }));
  const state = String(start["state"]);
  const row = h.rows(`SELECT * FROM dropbox_oauth WHERE "state" = ?`, state)[0]!;
  return { state, verifier: String(row["verifier"]) };
}

test("connect.complete trades the code, keeps the refresh token in the person's own Vault, drops the access token and records the account", async () => {
  const h = harness();
  await setUp(h);
  const { state, verifier } = await signIn(h);
  h.on(ME, { status: 200, body: RECORDED.account });
  const done = out(await d.connectComplete(h.ctx, { state, code: "good-code" }));
  assert.deepEqual(contractErrors("dropbox.connect.complete", "out", done), []);
  assert.match(String(done["connectionId"]), /^con_[0-9a-f]{24}$/);
  assert.deepEqual([done["accountId"], done["email"], done["name"]], ["dbid:AAH4f99T0taONIb", "maya@firm.example", "Maya Rivera"]);
  // the host got the verifier, the call to Dropbox used the access token it was handed
  assert.deepEqual(h.requests.find((r) => r.method === "EXCHANGE")?.body, { verifier, redirectUri: "https://space.vyre.test/oauth/callback" });
  assert.equal(h.api()[0]?.headers["authorization"], `Bearer ${ACCESS}`);
  // the Vault: a Connections folder in Mine, one item holding the refresh token as a secret field
  assert.deepEqual(h.calls("vault.folders.list").map((c) => c.input), [{ scope: "mine" }]);
  assert.equal(h.calls("vault.folders.create")[0]?.input["scope"], "mine");
  const put = h.calls("vault.item.put")[0]!.input;
  assert.deepEqual(put["fields"], [{ key: "token", value: REFRESH, secret: true }]);
  // nothing the module keeps holds a token
  const kept = JSON.stringify([h.rows(`SELECT * FROM dropbox_account`), h.rows(`SELECT * FROM dropbox_oauth`)]);
  assert.ok(!kept.includes(REFRESH) && !kept.includes(ACCESS), "no token in the module's tables");
  assert.equal(h.rows(`SELECT * FROM dropbox_oauth`).length, 0, "the sign-in is used up");
  assert.deepEqual(h.named("dropbox.connected").map((e) => e.payload), [{ connectionId: done["connectionId"], accountId: "dbid:AAH4f99T0taONIb", ownerKind: "person", email: "maya@firm.example" }]);
  const mine = out(d.accountList(h.ctx));
  assert.deepEqual(contractErrors("dropbox.account.list", "out", mine), []);
  assert.deepEqual(mine["connections"], [{ connectionId: done["connectionId"], ownerKind: "person", accountId: "dbid:AAH4f99T0taONIb", email: "maya@firm.example", name: "Maya Rivera" }]);
});

test("a Space connection keeps its token in the Shared folder and is listed for every member", async () => {
  const h = harness();
  await setUp(h);
  const { state } = await signIn(h, "space");
  h.on(ME, { status: 200, body: RECORDED.account });
  await d.connectComplete(h.ctx, { state, code: "c" });
  assert.equal(h.calls("vault.folders.list")[0]?.input["scope"], "shared");
  assert.equal(h.rows(`SELECT * FROM dropbox_account`)[0]?.["ownerKind"], "space");
  const other = harness({ principal: { kind: "person", id: OTHER } });
  other.connect({ ownerKind: "space" });
  assert.equal((out(d.accountList(other.ctx))["connections"] as unknown[]).length, 1, "a member sees the Space's Dropbox");
});

test("a person's connection is theirs alone; the host's own services act for it", async () => {
  const h = harness();
  h.connect();
  assert.equal((out(d.accountList(h.ctx))["connections"] as unknown[]).length, 1);
  const stranger = harness({ principal: { kind: "person", id: OTHER } });
  stranger.connect({ ownerId: MAYA });
  assert.deepEqual(out(d.accountList(stranger.ctx))["connections"], []);
  stranger.on("POST api.dropboxapi.com/2/files/get_metadata", { status: 200, body: RECORDED.file });
  assert.equal(await refusedWith(d.getMetadata(stranger.ctx, { connectionId: "con_dbx0001", path: "/Sales" })), "validation.not_found", "a connection that is not yours does not exist for you");
  const service = harness({ principal: { kind: "service", id: "svc_engine01" } });
  service.connect();
  service.on("POST api.dropboxapi.com/2/files/get_metadata", { status: 200, body: RECORDED.file });
  assert.ok(await d.getMetadata(service.ctx, { connectionId: "con_dbx0001", path: "/Sales/Report.docx" }), "the engine syncs a mount for its owner");
  assert.deepEqual(service.tokenAsks[0], { refreshHandle: "#Dropbox_tok0", asker: MAYA }, "and the token is read as the owner");
});

test("signing in again to the same Dropbox keeps the connection and replaces the token", async () => {
  const h = harness();
  await setUp(h);
  h.on(ME, { status: 200, body: RECORDED.account });
  const first = out(await d.connectComplete(h.ctx, { state: (await signIn(h)).state, code: "c1" }));
  const again = out(await d.connectComplete(h.ctx, { state: (await signIn(h)).state, code: "c2" }));
  assert.equal(again["connectionId"], first["connectionId"]);
  assert.equal(h.rows(`SELECT * FROM dropbox_account`).length, 1);
  assert.equal(h.calls("vault.item.put").length, 1);
  assert.equal(h.calls("vault.item.update").length, 1);
  assert.deepEqual(h.calls("vault.item.update")[0]?.input["fieldsSet"], [{ key: "token", value: REFRESH, secret: true }]);
});

test("only the person who started a sign-in can finish it, once, within ten minutes", async () => {
  const h = harness();
  await setUp(h);
  h.on(ME, { status: 200, body: RECORDED.account });
  const { state } = await signIn(h);
  // someone else holding the link can neither finish it nor use it up
  const thief = { ...h.ctx, principal: { kind: "person" as const, id: OTHER } };
  assert.equal(await refusedWith(d.connectComplete(thief, { state, code: "c" })), "permission.no_grant");
  assert.equal(h.rows(`SELECT * FROM dropbox_oauth`).length, 1, "the state is still there for its owner");
  assert.ok(await d.connectComplete(h.ctx, { state, code: "c" }));
  assert.equal(await refusedWith(d.connectComplete(h.ctx, { state, code: "c" })), "auth.invalid_code", "one use");
  assert.equal(await refusedWith(d.connectComplete(h.ctx, { state: "dbs_nonsense", code: "c" })), "auth.invalid_code");
  const late = await signIn(h);
  h.advance(11 * 60_000);
  assert.equal(await refusedWith(d.connectComplete(h.ctx, { state: late.state, code: "c" })), "auth.invalid_code", "expired");
  assert.equal(h.rows(`SELECT * FROM dropbox_oauth`).length, 0, "an expired state is gone too");
});

test("a declined sign-in, a missing code and a refused code say so and leave nothing behind", async () => {
  const h = harness();
  await setUp(h);
  let e: unknown;
  try { await d.connectComplete(h.ctx, { state: (await signIn(h)).state, error: "access_denied" }); } catch (x) { e = x; }
  assert.equal((e as { error: { details: { reason: string } } }).error.details.reason, "declined");
  assert.equal(await refusedWith(d.connectComplete(h.ctx, { state: (await signIn(h)).state })), "validation.bad_input");
  assert.equal(await refusedWith(d.connectComplete(h.ctx, { state: (await signIn(h)).state, code: "bad-code" })), "provider.auth_failed");
  h.on(ME, { status: 401, body: {} });
  assert.equal(await refusedWith(d.connectComplete(h.ctx, { state: (await signIn(h)).state, code: "c" })), "provider.auth_failed", "the token does not work");
  assert.equal(h.rows(`SELECT * FROM dropbox_account`).length, 0);
  assert.equal(h.calls("vault.item.put").length, 0, "no token is kept for an account that never signed in");
});

test("account.remove tells Dropbox, removes the Vault item and the rows; only an admin removes the Space's", async () => {
  const h = harness();
  h.connect();
  h.on("POST api.dropboxapi.com/2/auth/token/revoke", { status: 200, body: {} });
  assert.deepEqual(out(await d.accountRemove(h.ctx, { connectionId: "con_dbx0001" })), { removed: true });
  assert.equal(h.api()[0]?.path, "/2/auth/token/revoke");
  assert.deepEqual(h.calls("vault.item.delete").map((c) => c.input), [{ itemId: "vit_dbx0" }]);
  assert.equal(h.rows(`SELECT * FROM dropbox_account`).length, 0);
  assert.equal(await refusedWith(d.accountRemove(h.ctx, { connectionId: "con_dbx0001" })), "validation.not_found");

  const space = harness({ allow: false });
  space.connect({ ownerKind: "space" });
  assert.equal(await refusedWith(d.accountRemove(space.ctx, { connectionId: "con_dbx0001" })), "permission.no_grant");
  const gone = harness();
  gone.connect();
  gone.on("POST api.dropboxapi.com/2/auth/token/revoke", { status: 401, body: {} });
  assert.deepEqual(out(await d.accountRemove(gone.ctx, { connectionId: "con_dbx0001" })), { removed: true }, "a token Dropbox already lost is no reason to keep the connection");
});

test("health: not set up and not connected are not unhealthy; a refused token is down; a slow answer is degraded", async () => {
  const h = harness();
  assert.equal(out(await d.health(h.ctx))["state"], "healthy");
  await setUp(h);
  assert.equal(out(await d.health(h.ctx))["detail"], "No Dropbox is connected.");
  h.connect();
  h.on(ME, { status: 200, body: RECORDED.account });
  const up = out(await d.health(h.ctx));
  assert.deepEqual(contractErrors("dropbox.health", "out", up), []);
  assert.equal(up["state"], "healthy");
  h.on(ME, { status: 401, body: {} });
  assert.equal(out(await d.health(h.ctx))["state"], "down");
  h.on(ME, { status: 503, body: {} });
  assert.equal(out(await d.health(h.ctx))["state"], "degraded");
  h.on(ME, { throws: true });
  assert.equal(out(await d.health(h.ctx))["state"], "down");
});
