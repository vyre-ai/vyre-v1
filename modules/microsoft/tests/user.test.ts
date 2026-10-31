// ms.user.*: a person's own Microsoft sign-in for mail. The Space's app registration lives in a Vault item, the person's refresh token is sealed in the module,
// and the mailbox it makes is pulled through Graph's /me by the same code as a work mailbox. No socket is opened; the host seam is the harness's.
// @reads /modules/microsoft/fixtures/graph/delta-inbox-1.json
// @reads /modules/microsoft/fixtures/graph/delta-inbox-2.json
// @reads /modules/microsoft/fixtures/graph/delta-sent.json
// @reads /modules/microsoft/fixtures/graph/message-g1.json
// @reads /modules/microsoft/fixtures/graph/message-g2.json
// @reads /modules/microsoft/fixtures/graph/message-g3.json
// @reads /modules/microsoft/fixtures/graph/message-g9.json
// @reads /modules/microsoft/fixtures/graph/attachments-g1.json
// @reads /modules/microsoft/fixtures/graph/attachment-a1.json
// @reads /modules/microsoft/fixtures/graph/delta-empty.json
import test from "node:test";
import assert from "node:assert/strict";
import { pullMailbox } from "../handlers/graph.ts";
import { receiveNotification } from "../handlers/subscriptions.ts";
import { userAppSet, userAppStatus, userComplete, userList, userRemove, userSend, userStart } from "../handlers/personal.ts";
import { codeOf, fixture, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const ME = "https://graph.microsoft.com/v1.0/me";
const MAYA = "maya@outlook.test";
const APP = "22222222-3333-4444-5555-666666666666";

const app = async (h: Harness): Promise<void> => { await userAppSet(h.ctx, { vaultItem: "#Microsoft_Sign_In" }); };

async function signIn(h: Harness, code = "c1", email = MAYA): Promise<{ accountId: string; email: string; mailboxId?: string }> {
  h.on("GET", `${ME}?`, { body: { mail: email, userPrincipalName: email } });
  const { state } = await userStart(h.ctx, {});
  return userComplete(h.ctx, { state, code });
}

const expectCode = async (p: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(p, (e) => codeOf(e) === code, `expected ${code}`);
};

/** The recorded first walk, answered at /me. */
function walk(h: Harness): void {
  h.on("GET", `${ME}/mailFolders/inbox/messages/delta?$select`, { body: fixture("graph/delta-inbox-1.json") });
  h.on("GET", /skiptoken=S2/, { body: fixture("graph/delta-inbox-2.json") });
  h.on("GET", `${ME}/mailFolders/sentitems/messages/delta?$select`, { body: fixture("graph/delta-sent.json") });
  for (const id of ["g1", "g2", "g3", "g9"]) h.on("GET", `${ME}/messages/${id}?`, { body: fixture(`graph/message-${id}.json`) });
  h.on("GET", `${ME}/messages/g1/attachments?`, { body: fixture("graph/attachments-g1.json") });
  h.on("GET", `${ME}/messages/g1/attachments/a1`, { body: fixture("graph/attachment-a1.json") });
}

test("app: status gives the redirect to register, set reads the client from the Vault item", async () => {
  const h = harness();
  assert.deepEqual(await userAppStatus(h.ctx), { configured: false, redirectUri: "https://space.test/oauth/callback" });
  await expectCode(userAppSet(h.ctx, { vaultItem: "Microsoft" }), "validation.bad_input");
  await expectCode(userAppSet(h.ctx, { vaultItem: "#Nothing" }), "provider.auth_failed");
  assert.deepEqual(await userAppSet(h.ctx, { vaultItem: "#Microsoft_Sign_In" }), { configured: true, clientId: APP });
  assert.deepEqual(await userAppStatus(h.ctx), { configured: true, clientId: APP, vaultItem: "#Microsoft_Sign_In", redirectUri: "https://space.test/oauth/callback" });
});

test("start: refuses without an app; the link carries the client, the exact redirect, offline access, S256, the tenant and the hint", async () => {
  const h = harness();
  await expectCode(userStart(h.ctx, {}), "validation.precondition_failed");
  await app(h);
  const common = new URL((await userStart(h.ctx, { loginHint: MAYA })).authUrl);
  assert.equal(common.origin + common.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  assert.equal(common.searchParams.get("client_id"), APP);
  assert.equal(common.searchParams.get("redirect_uri"), "https://space.test/oauth/callback");
  assert.equal(common.searchParams.get("scope"), "offline_access User.Read Mail.ReadWrite Mail.Send");
  assert.equal(common.searchParams.get("code_challenge_method"), "S256");
  assert.equal(common.searchParams.get("login_hint"), MAYA);
  assert.match(common.searchParams.get("state") ?? "", /^mos_[0-9a-f]{48}$/);

  h.userApps.set("#Microsoft_Sign_In", { clientId: APP, tenant: "contoso.test" });
  const own = new URL((await userStart(h.ctx, {})).authUrl);
  assert.equal(own.pathname, "/contoso.test/oauth2/v2.0/authorize");
});

test("complete: the code is traded, the address is Graph's, the token is sealed, the mailbox is made and pulled, the event says who", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  assert.equal(out.email, MAYA);
  assert.match(out.accountId, /^mua_[0-9a-f]{32}$/);
  assert.deepEqual([h.exchanges.length, h.exchanges[0]!.code, h.exchanges[0]!.appHandle], [1, "c1", "#Microsoft_Sign_In"]);
  assert.equal(h.hits(`${ME}?`)[0]!.headers["authorization"], "Bearer access-for-c1");
  const connect = h.calls("mail.connect")[0]!.input;
  assert.deepEqual([connect["provider"], connect["address"], connect["connectionId"]], ["microsoft", MAYA, out.accountId]);
  assert.equal(h.calls("mail.sync_now").length, 1);
  assert.deepEqual(h.named("microsoft.user_connected").map((e) => e.payload), [{ accountId: out.accountId, email: MAYA }]);
  const row = h.rows(`SELECT * FROM microsoft_user_account`)[0]!;
  assert.ok(!String(row["refreshSealed"]).includes("refresh-for-c1"));
  const everything = JSON.stringify([out, h.emitted, h.called, h.scheduled]);
  assert.ok(!everything.includes("refresh-for-c1") && !everything.includes("access-for-c1"));
});

test("complete: a state is used once; someone else cannot finish it or spend it; an old one is refused", async () => {
  const h = harness();
  await app(h);
  h.on("GET", `${ME}?`, { body: { mail: MAYA } });
  const { state } = await userStart(h.ctx, {});
  await userComplete(h.ctx, { state, code: "c1" });
  await expectCode(userComplete(h.ctx, { state, code: "c1" }), "auth.invalid_code");

  const second = await userStart(h.ctx, {});
  const maya = h.ctx.principal;
  h.ctx.principal = { kind: "person", id: "usr_other01" };
  await expectCode(userComplete(h.ctx, { state: second.state, code: "c2" }), "permission.no_grant");
  h.ctx.principal = maya;
  assert.equal(h.rows(`SELECT state FROM microsoft_user_oauth WHERE state = ?`, second.state).length, 1);
  h.advance(11 * 60_000);
  await expectCode(userComplete(h.ctx, { state: second.state, code: "c2" }), "auth.invalid_code");
  assert.equal(h.exchanges.length, 1);
});

test("complete: a declined sign-in ends cleanly; a refused exchange or profile reaches the caller; a work account without a mail address falls back to its principal name", async () => {
  const h = harness();
  await app(h);
  const a = await userStart(h.ctx, {});
  await assert.rejects(userComplete(h.ctx, { state: a.state, error: "access_denied" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.exchanges.length, 0);

  h.userState.exchangeFails = true;
  const b = await userStart(h.ctx, {});
  await expectCode(userComplete(h.ctx, { state: b.state, code: "c" }), "provider.auth_failed");
  h.userState.exchangeFails = false;

  h.on("GET", `${ME}?`, { status: 403, body: {} });
  const c = await userStart(h.ctx, {});
  await expectCode(userComplete(h.ctx, { state: c.state, code: "c" }), "provider.auth_failed");
  assert.equal(h.rows(`SELECT * FROM microsoft_user_account`).length, 0);

  h.on("GET", `${ME}?`, { body: { mail: null, userPrincipalName: "Pat@Work.Test" } });
  const d = await userStart(h.ctx, {});
  assert.equal((await userComplete(h.ctx, { state: d.state, code: "c" })).email, "pat@work.test");
});

test("complete: signing in again to the same address keeps the account and swaps the token; an existing mailbox is fine", async () => {
  const h = harness();
  await app(h);
  const first = await signIn(h, "c1");
  h.mailState.duplicate = true;
  const again = await signIn(h, "c2");
  assert.equal(again.accountId, first.accountId);
  assert.equal(again.mailboxId, first.mailboxId, "the mailbox is the same one");
  assert.equal(h.rows(`SELECT * FROM microsoft_user_account`).length, 1);
  assert.equal(h.calls("mail.sync_now").length, 2);
  walk(h);
  await pullMailbox(h.ctx, { connectionId: first.accountId, mailbox: MAYA });
  assert.equal(h.refreshes.at(-1)!.refreshToken, "refresh-for-c2");
});

test("list and remove: a person sees only their accounts; remove drops the token and the mailbox row", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  walk(h);
  await pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA });
  assert.equal(h.rows(`SELECT * FROM microsoft_mailbox`).length, 1);
  assert.deepEqual(userList(h.ctx), { accounts: [{ accountId: out.accountId, email: MAYA }] });

  const maya = h.ctx.principal;
  h.ctx.principal = { kind: "person", id: "usr_other01" };
  assert.deepEqual(userList(h.ctx), { accounts: [] });
  await expectCode(userRemove(h.ctx, { accountId: out.accountId }), "validation.not_found");
  h.ctx.principal = maya;

  assert.deepEqual(await userRemove(h.ctx, { accountId: out.accountId }), { removed: true });
  assert.equal(h.rows(`SELECT * FROM microsoft_user_account`).length, 0);
  assert.equal(h.rows(`SELECT * FROM microsoft_mailbox`).length, 0);
});

test("pull: a personal mailbox is read through /me with the person's own token, the whole first walk lands, and another person is refused", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  walk(h);
  const pull = await pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA });
  assert.deepEqual([pull.ingested, pull.complete], [4, true]);
  assert.deepEqual(h.ingests.map((i) => i.providerId), ["g1", "g2", "g3", "g9"]);
  assert.deepEqual(h.refreshes.map((r) => [r.appHandle, r.refreshToken, r.cacheKey]), [["#Microsoft_Sign_In", "refresh-for-c1", out.accountId]]);
  assert.equal(h.hits(/\/users\/[^?]*\/(messages|mailFolders)[^?]*\?\$select/).length, 0);   // every request we build is /me; later pages follow the links Graph hands back
  assert.equal(h.hits(`${ME}/mailFolders/inbox/messages/delta?$select`)[0]!.headers["authorization"], "Bearer user-access-1");

  h.ctx.principal = { kind: "person", id: "usr_other01" };
  await expectCode(pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA }), "validation.not_found");
  h.ctx.principal = { kind: "service", id: "svc_host" } as never;
  h.on("GET", /deltatoken=/, { body: fixture("graph/delta-empty.json") });   // the recorded delta links name the recorded user; the next pass follows them as Graph gave them
  const next = await pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA });
  assert.equal(next.ingested, 0);
});

test("poll with nobody signed in: a personal address is pulled, no calendar or Teams call is made, the next poll is queued", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  h.ctx.principal = { kind: "service", id: "svc_host" } as never;
  walk(h);
  const res = await receiveNotification(h.ctx, { notificationId: "n1", subscriptionId: "manual", resource: `users/${MAYA}/messages`, changeType: "updated", clientStateOk: true });
  assert.equal(res.accepted, true);
  assert.equal(h.ingests.length, 4);
  assert.ok(out.accountId);
  assert.equal(h.hits(/\/calendar|\/onlineMeetings|\/drive/).length, 0);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0]!.cap, "ms.receive_notification");
});

test("complete: the mailbox is private in a Team Space and plain in a Personal Space", async () => {
  const team = harness();
  await app(team);
  await signIn(team);
  assert.equal(team.calls("mail.connect")[0]!.input["privacy"], "private");
  const personal = harness();
  personal.spaceState.kind = "personal";
  await app(personal);
  await signIn(personal);
  assert.equal(personal.calls("mail.connect")[0]!.input["privacy"], "space");
});

test("a lost sign-in: the first failed poll marks the mailbox, makes one Needs you task for the owner and stops the chain; signing in again closes it", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  const maya = h.ctx.principal;
  walk(h);
  await pullMailbox(h.ctx, { connectionId: out.accountId, mailbox: MAYA });
  h.ctx.principal = { kind: "service", id: "svc_host" } as never;
  h.advance(2 * 3_600_000);
  h.userState.refreshFails = true;
  const note = (id: string) => receiveNotification(h.ctx, { notificationId: id, subscriptionId: "poll", resource: `users/${MAYA}/messages`, changeType: "updated", clientStateOk: true });
  await note("n-lost-1");
  assert.deepEqual(h.calls("mail.mailbox.set_sync_state").map((c) => [c.input["mailboxId"], c.input["state"]]), [[out.mailboxId, "error"]]);
  const made = h.calls("tasks.create");
  assert.equal(made.length, 1);
  assert.match(String(made[0]!.input["idempotencyKey"]), /-fix:/, "the call carries its idempotency key");
  assert.deepEqual([made[0]!.input["kind"], made[0]!.input["assigned"]], ["unblock", { kind: "person", id: "usr_maya01" }]);
  assert.deepEqual((made[0]!.input["blocks"] as { type: string }[])[0]!.type, "mail_signin");
  assert.equal(h.scheduled.length, 0);
  await note("n-lost-2");
  assert.equal(h.calls("tasks.create").length, 1);

  h.userState.refreshFails = false;
  h.ctx.principal = maya;
  const again = await signIn(h, "c2");
  assert.equal(again.accountId, out.accountId);
  assert.deepEqual(h.calls("tasks.transition").map((c) => [c.input["taskId"], c.input["to"]]), [["tsk_fix1", "done"]]);
  assert.equal(h.calls("mail.mailbox.set_sync_state").at(-1)!.input["state"], "syncing");
});

test("send: the account's own Outlook sends through /me/sendMail with its token; another person is refused", async () => {
  const h = harness();
  await app(h);
  const out = await signIn(h);
  h.on("POST", `${ME}/sendMail`, { status: 202 });
  assert.deepEqual(await userSend(h.ctx, { accountId: out.accountId, to: ["pat@acme.test"], subject: "Hello", text: "Hi Pat", idempotencyKey: "k1" }), { sent: true });
  const req = h.hits(`${ME}/sendMail`, "POST")[0]!;
  assert.match(req.headers["authorization"] ?? "", /^Bearer user-access-\d+$/);
  assert.equal((req.body as { message: { subject: string } }).message.subject, "Hello");
  h.ctx.principal = { kind: "person", id: "usr_other01" };
  await expectCode(userSend(h.ctx, { accountId: out.accountId, to: ["pat@acme.test"], subject: "x", text: "y", idempotencyKey: "k2" }), "validation.not_found");
});
