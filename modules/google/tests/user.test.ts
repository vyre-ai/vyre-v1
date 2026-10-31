// google.user.*: a person's own Google sign-in for mail. The Space's OAuth client lives in a Vault item, the person's refresh token is sealed in the module,
// and the mailbox it makes is pulled and sent through the same code as a Workspace mailbox. No socket is opened; the host seam is the harness's.
// @reads /modules/google/fixtures/gmail/profile.json
import test from "node:test";
import assert from "node:assert/strict";
import { receivePush } from "../handlers/workspace.ts";
import { pullMailbox } from "../handlers/gmail.ts";
import { userAppSet, userAppStatus, userComplete, userList, userRemove, userStart } from "../handlers/personal.ts";
import { codeOf, fixture, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const MAYA = "maya@gmail.test";

function configured(h: Harness): Harness {
  return h;
}

async function app(h: Harness): Promise<void> {
  await userAppSet(h.ctx, { vaultItem: "#Google_Sign_In" });
}

async function signIn(h: Harness, code = "c1", email = MAYA): Promise<{ accountId: string; email: string; mailboxId?: string }> {
  h.on("GET", PROFILE, { body: { ...(fixture("gmail/profile.json") as object), emailAddress: email } });
  const { state } = await userStart(h.ctx, {});
  return userComplete(h.ctx, { state, code });
}

const expectCode = async (p: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(p, (e) => codeOf(e) === code, `expected ${code}`);
};

test("app: status says how to set it up, set reads the client from the Vault item", async () => {
  const h = configured(harness());
  assert.deepEqual(await userAppStatus(h.ctx), { configured: false, redirectUri: "https://space.test/oauth/callback" });
  await expectCode(userAppSet(h.ctx, { vaultItem: "Google" }), "validation.bad_input");
  await expectCode(userAppSet(h.ctx, { vaultItem: "#Nothing" }), "provider.auth_failed");
  assert.deepEqual(await userAppSet(h.ctx, { vaultItem: "#Google_Sign_In" }), { configured: true, clientId: "client-123.apps.googleusercontent.com" });
  assert.deepEqual(await userAppStatus(h.ctx), { configured: true, clientId: "client-123.apps.googleusercontent.com", vaultItem: "#Google_Sign_In", redirectUri: "https://space.test/oauth/callback" });
});

test("start: refuses without an app; the link carries the client, the exact redirect, offline access, S256 and the hint", async () => {
  const h = harness();
  await expectCode(userStart(h.ctx, {}), "validation.precondition_failed");
  await app(h);
  const { authUrl, state } = await userStart(h.ctx, { loginHint: MAYA });
  const u = new URL(authUrl);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("client_id"), "client-123.apps.googleusercontent.com");
  assert.equal(u.searchParams.get("redirect_uri"), "https://space.test/oauth/callback");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.modify");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("login_hint"), MAYA);
  assert.equal(u.searchParams.get("state"), state);
  assert.match(state, /^gos_[0-9a-f]{48}$/);
  const row = h.rows(`SELECT * FROM google_user_oauth`)[0]!;
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(row["verifier"])))).toString("base64url");
  assert.equal(u.searchParams.get("code_challenge"), digest);
});

test("complete: the code is traded, the address is Gmail's, the token is sealed, the mailbox is made and pulled, the event says who", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  assert.equal(out.email, MAYA);
  assert.match(out.accountId, /^gua_[0-9a-f]{32}$/);
  assert.equal(h.exchanges.length, 1);
  assert.equal(h.exchanges[0]!.code, "c1");
  assert.equal(h.exchanges[0]!.appHandle, "#Google_Sign_In");
  assert.equal(h.exchanges[0]!.redirectUri, "https://space.test/oauth/callback");
  assert.equal(h.hits(PROFILE)[0]!.headers["authorization"], "Bearer access-for-c1");
  const connect = h.calls("mail.connect")[0]!.input;
  assert.deepEqual([connect["provider"], connect["address"], connect["connectionId"]], ["google", MAYA, out.accountId]);
  assert.equal(h.calls("mail.sync_now").length, 1);
  assert.deepEqual(h.named("google.user_connected").map((e) => e.payload), [{ accountId: out.accountId, email: MAYA }]);
  // the refresh token is in the row only sealed, and in no output, event or call
  const row = h.rows(`SELECT * FROM google_user_account`)[0]!;
  assert.ok(!String(row["refreshSealed"]).includes("refresh-for-c1"));
  const everything = JSON.stringify([out, h.emitted, h.called, h.scheduled]);
  assert.ok(!everything.includes("refresh-for-c1") && !everything.includes("access-for-c1"));
});

test("complete: a state is used once; someone else cannot finish it or spend it; an old one is refused", async () => {
  const h = harness();
  await app(h);
  h.on("GET", PROFILE, { body: fixture("gmail/profile.json") });
  const { state } = await userStart(h.ctx, {});
  await userComplete(h.ctx, { state, code: "c1" });
  await expectCode(userComplete(h.ctx, { state, code: "c1" }), "auth.invalid_code");

  const second = await userStart(h.ctx, {});
  const maya = h.ctx.principal;
  h.ctx.principal = { kind: "person", id: "usr_other01" };
  await expectCode(userComplete(h.ctx, { state: second.state, code: "c2" }), "permission.no_grant");
  h.ctx.principal = maya;
  assert.equal(h.rows(`SELECT state FROM google_user_oauth WHERE state = ?`, second.state).length, 1);
  h.advance(11 * 60_000);
  await expectCode(userComplete(h.ctx, { state: second.state, code: "c2" }), "auth.invalid_code");
  assert.equal(h.exchanges.length, 1);
});

test("complete: a declined sign-in ends cleanly; a refused exchange or profile reaches the caller", async () => {
  const h = harness();
  await app(h);
  const a = await userStart(h.ctx, {});
  await assert.rejects(userComplete(h.ctx, { state: a.state, error: "access_denied" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.exchanges.length, 0);

  h.userState.exchangeFails = true;
  const b = await userStart(h.ctx, {});
  await expectCode(userComplete(h.ctx, { state: b.state, code: "c" }), "provider.auth_failed");
  h.userState.exchangeFails = false;

  h.on("GET", PROFILE, { status: 403, body: {} });
  const c = await userStart(h.ctx, {});
  await expectCode(userComplete(h.ctx, { state: c.state, code: "c" }), "provider.auth_failed");
  assert.equal(h.rows(`SELECT * FROM google_user_account`).length, 0);
});

test("complete: signing in again to the same address keeps the account and swaps the token; an existing mailbox is fine", async () => {
  const h = harness();
  await app(h);
  const first = await signIn(h, "c1");
  h.mailState.duplicate = true;
  const again = await signIn(h, "c2");
  assert.equal(again.accountId, first.accountId);
  assert.equal(again.mailboxId, undefined);
  const rows = h.rows(`SELECT * FROM google_user_account`);
  assert.equal(rows.length, 1);
  assert.equal(h.calls("mail.sync_now").length, 1);
  // the new token is the one used
  h.on("GET", /\/history\?/, { body: { history: [], historyId: "1" } });
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId") VALUES (?, ?, ?)`, MAYA, first.accountId, "1");
  await pullMailbox(h.ctx, { connectionId: first.accountId, mailbox: MAYA });
  assert.equal(h.refreshes.at(-1)!.refreshToken, "refresh-for-c2");
});

test("list and remove: a person sees only their accounts; remove revokes, drops the token and the mailbox row", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId") VALUES (?, ?, ?)`, MAYA, out.accountId, "1");
  assert.deepEqual(userList(h.ctx), { accounts: [{ accountId: out.accountId, email: MAYA }] });

  const maya = h.ctx.principal;
  h.ctx.principal = { kind: "person", id: "usr_other01" };
  assert.deepEqual(userList(h.ctx), { accounts: [] });
  await expectCode(userRemove(h.ctx, { accountId: out.accountId }), "validation.not_found");
  h.ctx.principal = maya;

  h.on("POST", "https://oauth2.googleapis.com/revoke", { body: {} });
  assert.deepEqual(await userRemove(h.ctx, { accountId: out.accountId }), { removed: true });
  assert.equal(h.hits("https://oauth2.googleapis.com/revoke", "POST").length, 1);
  assert.equal(h.rows(`SELECT * FROM google_user_account`).length, 0);
  assert.equal(h.rows(`SELECT * FROM google_mailbox`).length, 0);
});

test("token use: the unsealed refresh token goes to the host only; another person is refused; a host service may use it", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId") VALUES (?, ?, ?)`, MAYA, out.accountId, "1");
  h.on("GET", /\/history\?/, { body: { history: [], historyId: "1" } });
  await pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA });
  assert.deepEqual(h.refreshes.map((r) => [r.appHandle, r.refreshToken, r.cacheKey]), [["#Google_Sign_In", "refresh-for-c1", out.accountId]]);
  assert.equal(h.hits(/\/history\?/)[0]!.headers["authorization"], "Bearer user-access-1");

  const maya = h.ctx.principal;
  h.ctx.principal = { kind: "person", id: "usr_other01" };
  await expectCode(pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA }), "validation.not_found");
  h.ctx.principal = { kind: "service", id: "svc_host" } as typeof maya;
  await pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA });
  assert.equal(h.hits(/\/history\?/).length, 2);   // the service read the mailbox; the access token was still fresh, so the host was not asked again
  h.ctx.principal = maya;
});

test("poll with nobody signed in: a personal address is pulled, no calendar or Meet call is made, the next poll is queued", async () => {
  const h = harness({ principal: { kind: "service", id: "svc_host" } as never });
  await app(h);
  h.ctx.principal = { kind: "person", id: "usr_maya01" };
  const out = await signIn(h);
  h.ctx.principal = { kind: "service", id: "svc_host" } as never;
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId") VALUES (?, ?, ?)`, MAYA, out.accountId, "1");
  h.on("GET", /\/history\?/, { body: { history: [], historyId: "2" } });
  const res = await receivePush(h.ctx, { kind: "gmail", messageId: "poll:1", mailbox: MAYA });
  assert.equal(res.accepted, true);
  assert.equal(h.calls("calendar.sync_now").length, 0);
  assert.equal(h.hits(/googleapis\.com\/calendar/).length, 0);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0]!.cap, "google.receive_push");
  assert.equal(h.scheduled[0]!.input["mailbox"], MAYA);
});
