// Subscriptions and the renewal Run (it extends before expiry), notification intake and polling, consent setup with the auto-connect notices,
// verify, the access policy snippet, members and exclusions, and health. Recorded Graph answers; no socket is opened.
// @reads /modules/microsoft/fixtures/graph/organization.json
import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarSubscribe, calendarUnsubscribe, consentDisable, consentExclude, consentLink, consentMembers, consentSetup, consentSnippet, consentStatus, consentVerify, health,
  mailSubscribe, mailUnsubscribe, receiveNotification, renew, teamsSubscribe,
} from "../handlers/subscriptions.ts";
import { mailFolders } from "../handlers/graph.ts";
import { handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { PERMISSIONS } from "../projections.ts";
import { act, codeOf, CONN, contractErrors, fixture, harness, NOW, seedConsent, U } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAYA = "maya@vyre.test";
const SAM = "sam@vyre.test";
const MIN = 60_000;
const members = [
  { userId: "usr_maya01", email: MAYA }, { userId: "usr_sam01", email: SAM }, { userId: "usr_kim01", email: "kim@vyre.test" }, { userId: "usr_out01", email: "ext@other.test" },
];
const check = (cap: string, out: unknown): void => assert.deepEqual(contractErrors(cap, "out", out), [], cap);
const URL_OK = "https://hooks.vyre.test/hooks/graph";

function ready(o: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(o);
  seedConsent(h);
  return h;
}

// ---- subscriptions

test("a mail subscription asks for the longest lifetime, records the client state, and names the member's folder", async () => {
  const h = ready();
  h.on("POST", `${GRAPH}/subscriptions`, (r) => ({ body: { id: "sub1", expirationDateTime: (r.body as { expirationDateTime: string }).expirationDateTime } }));
  const made = await mailSubscribe(h.ctx, { ...act, folderId: "inbox", notificationUrl: URL_OK });
  const body = h.hits(`${GRAPH}/subscriptions`)[0]!.body as Record<string, string>;
  assert.deepEqual([body.changeType, body.resource, body.notificationUrl], ["created,updated", "users/maya@vyre.test/mailFolders('inbox')/messages", URL_OK]);
  assert.equal(body.expirationDateTime, new Date(NOW + 4230 * MIN - 5 * MIN).toISOString());
  assert.match(body.clientState!, /^[0-9a-f]{64}$/);
  assert.deepEqual(made, { subscriptionId: "sub1", expiresAt: NOW + 4225 * MIN });
  const row = h.rows(`SELECT * FROM microsoft_subscription`)[0]!;
  assert.deepEqual([row.id, row.kind, row.mailbox, row.clientState, row.expiresAt, row.maxMinutes], ["sub1", "mail", MAYA, body.clientState, made.expiresAt, 4230]);
  assert.equal(h.rows(`SELECT email FROM microsoft_mailbox`).length, 1);
  check("ms.mail.subscribe", made);
});

test("calendar and Teams subscriptions, and what they refuse", async () => {
  const h = ready();
  let n = 0;
  h.on("POST", `${GRAPH}/subscriptions`, () => ({ body: { id: `sub${++n}` } }));
  const own = await calendarSubscribe(h.ctx, { ...act, notificationUrl: URL_OK });
  const other = await calendarSubscribe(h.ctx, { ...act, calendarId: "cal2", notificationUrl: URL_OK });
  const teams = await teamsSubscribe(h.ctx, { ...act, resource: "communications/onlineMeetings/getAllTranscripts", notificationUrl: URL_OK });
  const bodies = h.hits(`${GRAPH}/subscriptions`).map((r) => r.body as Record<string, string>);
  assert.deepEqual(bodies.map((b) => [b.changeType, b.resource]), [["created,updated,deleted", "users/maya@vyre.test/events"], ["created,updated,deleted", "users/maya@vyre.test/calendars/cal2/events"], ["created", "communications/onlineMeetings/getAllTranscripts"]]);
  assert.equal(bodies[2]!.expirationDateTime, new Date(NOW + 55 * MIN).toISOString());   // Teams subscriptions last an hour at most
  assert.deepEqual(h.rows(`SELECT kind, mailbox, "maxMinutes" FROM microsoft_subscription ORDER BY id ASC`), [{ kind: "calendar", mailbox: MAYA, maxMinutes: 4230 }, { kind: "calendar", mailbox: MAYA, maxMinutes: 4230 }, { kind: "teams", mailbox: null, maxMinutes: 60 }]);
  for (const [cap, out] of [["ms.calendar.subscribe", own], ["ms.calendar.subscribe", other], ["ms.teams.recordings.subscribe", teams]] as const) check(cap, out);

  const before = h.requests.length;
  for (const url of ["http://hooks.vyre.test/h", "https://user:pw@hooks.vyre.test/h", "not an address"]) {
    await assert.rejects(() => mailSubscribe(h.ctx, { ...act, folderId: "inbox", notificationUrl: url }), (e) => codeOf(e) === "validation.bad_input", url);
  }
  await assert.rejects(() => mailSubscribe(h.ctx, { ...act, folderId: "in')/x", notificationUrl: URL_OK }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => teamsSubscribe(h.ctx, { ...act, resource: "users/other@vyre.test/onlineMeetings/getAllTranscripts", notificationUrl: URL_OK }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => teamsSubscribe(h.ctx, { ...act, resource: "communications/onlineMeetings/../../admin", notificationUrl: URL_OK }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.requests.length, before);   // nothing was sent to Microsoft for any of them
});

test("only the member a subscription watches, or an admin, can remove it; Microsoft already forgetting it is fine", async () => {
  const h = ready();
  h.on("POST", `${GRAPH}/subscriptions`, { body: { id: "sub1" } });
  await mailSubscribe(h.ctx, { ...act, folderId: "inbox", notificationUrl: URL_OK });
  h.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "subSam", "mail", "users/sam@vyre.test/messages", SAM, CONN, URL_OK, "cs", NOW + MIN, 4230, "created");
  h.on("DELETE", `${GRAPH}/subscriptions/sub1`, { status: 404, body: { error: { code: "ResourceNotFound" } } });
  assert.deepEqual(await mailUnsubscribe(h.ctx, { ...act, subscriptionId: "sub1" }), { removed: true });
  assert.equal(h.rows(`SELECT id FROM microsoft_subscription WHERE id = ?`, "sub1").length, 0);
  await assert.rejects(() => calendarUnsubscribe(h.ctx, { ...act, subscriptionId: "subSam" }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => mailUnsubscribe(h.ctx, { ...act, subscriptionId: "nope" }), (e) => codeOf(e) === "validation.not_found");
  h.on("DELETE", `${GRAPH}/subscriptions/subSam`, { status: 503, body: {} });
  const boss = harness({ admin: true });
  seedConsent(boss, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01" }] });
  boss.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "subSam", "mail", "users/sam@vyre.test/messages", SAM, CONN, URL_OK, "cs", NOW + MIN, 4230, "created");
  boss.on("DELETE", `${GRAPH}/subscriptions/subSam`, { status: 503, body: {} });
  await assert.rejects(() => mailUnsubscribe(boss.ctx, { ...act, as: SAM, subscriptionId: "subSam" }), (e) => codeOf(e) === "provider.unavailable");
  assert.equal(boss.rows(`SELECT id FROM microsoft_subscription`).length, 1);   // a refusal other than "gone" keeps the row
  boss.on("DELETE", `${GRAPH}/subscriptions/subSam`, { status: 204 });
  assert.deepEqual(await mailUnsubscribe(boss.ctx, { ...act, as: SAM, subscriptionId: "subSam" }), { removed: true });
  check("ms.mail.unsubscribe", { removed: true });
});

// ---- the renewal Run

function sub(h: Harness, id: string, expiresIn: number, maxMinutes = 4230, kind = "mail"): void {
  h.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, kind, `users/maya@vyre.test/messages`, MAYA, CONN, URL_OK, "cs", NOW + expiresIn, maxMinutes, "created");
}

test("the renewal Run extends a subscription before it expires, leaves a fresh one alone, and queues the next Run once", async () => {
  const h = ready();
  sub(h, "soon", 6 * 60 * MIN);
  sub(h, "fresh", 40 * 60 * MIN);
  sub(h, "teamsSoon", 10 * MIN, 60, "teams");
  sub(h, "teamsFresh", 50 * MIN, 60, "teams");
  h.on("PATCH", `${GRAPH}/subscriptions/`, (r) => ({ body: { expirationDateTime: (r.body as { expirationDateTime: string }).expirationDateTime } }));
  const run = await renew(h.ctx);
  assert.match(run.runId, /^run_[a-z0-9]+$/);
  check("ms.subscriptions.renew", run);
  const patched = h.hits(`${GRAPH}/subscriptions/`, "PATCH");
  assert.deepEqual(patched.map((r) => r.url.split("/").pop()).sort(), ["soon", "teamsSoon"]);
  const exp = Object.fromEntries(patched.map((r) => [r.url.split("/").pop(), (r.body as { expirationDateTime: string }).expirationDateTime]));
  assert.equal(exp.soon, new Date(NOW + 4225 * MIN).toISOString());
  assert.equal(exp.teamsSoon, new Date(NOW + 55 * MIN).toISOString());
  const rows = Object.fromEntries(h.rows(`SELECT id, "expiresAt" FROM microsoft_subscription`).map((r) => [r.id, r.expiresAt]));
  assert.deepEqual(rows, { soon: NOW + 4225 * MIN, fresh: NOW + 40 * 60 * MIN, teamsSoon: NOW + 55 * MIN, teamsFresh: NOW + 50 * MIN });
  assert.ok(patched.every((r) => (r.body as { expirationDateTime: string }).expirationDateTime > new Date(NOW).toISOString()));
  assert.deepEqual(h.scheduled, [{ at: NOW + 12 * 60 * MIN, cap: "ms.subscriptions.renew", input: {} }]);
  await renew(h.ctx);   // run again straight away: renewed ones are skipped and no second Run is queued
  assert.equal(h.hits(`${GRAPH}/subscriptions/`, "PATCH").length, 2);
  assert.equal(h.scheduled.length, 1);
  h.advance(12 * 60 * MIN);   // the queued Run fires
  await renew(h.ctx);
  assert.equal(h.scheduled.length, 2);
  assert.equal(h.scheduled[1]!.at, NOW + 24 * 60 * MIN);
});

test("a subscription Microsoft forgot is made again for the same resource; one that cannot be renewed stays for the next Run", async () => {
  const h = ready();
  sub(h, "lost", 2 * 60 * MIN);
  sub(h, "busy", 3 * 60 * MIN);
  h.on("PATCH", `${GRAPH}/subscriptions/lost`, { status: 404, body: { error: { code: "ResourceNotFound" } } });
  h.on("PATCH", `${GRAPH}/subscriptions/busy`, { status: 503, body: {} });
  h.on("POST", `${GRAPH}/subscriptions`, { body: { id: "again" } });
  await renew(h.ctx);
  const again = h.hits(`${GRAPH}/subscriptions`, "POST")[0]!.body as Record<string, string>;
  assert.deepEqual([again.resource, again.notificationUrl, again.changeType], ["users/maya@vyre.test/messages", URL_OK, "created"]);
  assert.notEqual(again.clientState, "cs");
  const rows = h.rows(`SELECT id, "clientState", "expiresAt" FROM microsoft_subscription ORDER BY id ASC`);
  assert.deepEqual(rows.map((r) => r.id), ["again", "busy"]);
  assert.equal(rows[0]!.expiresAt, NOW + 4225 * MIN);
  assert.equal(rows[1]!.expiresAt, NOW + 3 * 60 * MIN);   // untouched: the next Run tries again
});

test("with the connection off the Run touches nothing and queues nothing; it reports the run the host started", async () => {
  const off = harness({ run: "run_fromhost01" });
  seedConsent(off, { configured: false });
  sub(off, "soon", MIN);
  assert.deepEqual(await renew(off.ctx), { runId: "run_fromhost01" });
  assert.equal(off.requests.length, 0);
  assert.equal(off.scheduled.length, 0);
  assert.equal(handlers["ms.subscriptions.renew"] !== undefined, true);
});

// ---- notifications and polling

function mailboxReady(): Harness {
  const h = ready();
  h.on("GET", `${U}/mailFolders/inbox/messages/delta?$select`, { body: { value: [{ id: "g3" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('inbox')/messages/delta?$deltatoken=D1" } });
  h.on("GET", `${U}/mailFolders/sentitems/messages/delta?$select`, { body: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users('mid')/mailFolders('sentitems')/messages/delta?$deltatoken=S1" } });
  h.on("GET", `${U}/messages/g3?`, { body: fixture("graph/message-g3.json") });
  h.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "subM", "mail", "users/mid/mailFolders('inbox')/messages", MAYA, CONN, URL_OK, "cs", NOW - MIN, 4230, "created,updated");   // expired, so polling stays at the active interval
  return h;
}
const note = (id: string, o: Partial<Parameters<typeof receiveNotification>[1]> = {}) => ({
  notificationId: id, subscriptionId: "subM", resource: "Users/mid/Messages/g3", changeType: "created" as const, clientStateOk: true, tenantId: "tenant-guid", ...o,
});

test("a verified notice is taken once, announced, the mailbox pulled, and one future poll queued", async () => {
  const h = mailboxReady();
  const first = await receiveNotification(h.ctx, note("n1"));
  assert.deepEqual(first, { accepted: true });
  check("ms.receive_notification", first);
  assert.deepEqual(h.named("microsoft.notification_received").map((e) => e.payload), [{ connector: "microsoft", notificationId: "n1", subscriptionId: "subM", resource: "Users/mid/Messages/g3", changeType: "created", tenantId: "tenant-guid" }]);
  assert.deepEqual(h.ingests.map((i) => i.providerId), ["g3"]);
  assert.equal(h.scheduled.length, 1);
  assert.deepEqual(h.scheduled[0], {
    at: NOW + 2 * MIN, cap: "ms.receive_notification",
    input: { notificationId: `poll:${MAYA}:${NOW + 2 * MIN}`, subscriptionId: "poll", resource: `users/${MAYA}/messages`, changeType: "updated", clientStateOk: true },
  });
  assert.deepEqual(await receiveNotification(h.ctx, note("n1")), { accepted: false });   // a redelivery changes nothing
  assert.equal(h.named("microsoft.notification_received").length, 1);
  assert.equal(h.ingests.length, 1);
  await receiveNotification(h.ctx, note("n2"));   // before the queued poll: pulled, no second chain
  assert.equal(h.scheduled.length, 1);
  h.advance(2 * MIN);
  await receiveNotification(h.ctx, h.scheduled[0]!.input as ReturnType<typeof note>);   // the queued poll fires
  assert.equal(h.scheduled.length, 2);
});

test("a notice that fails the client state, or names no subscription of ours, is dropped; a manual sync and a poll are our own", async () => {
  const h = mailboxReady();
  assert.deepEqual(await receiveNotification(h.ctx, note("bad1", { clientStateOk: false })), { accepted: false });
  assert.deepEqual(await receiveNotification(h.ctx, note("bad2", { subscriptionId: "strangers" })), { accepted: false });
  assert.equal(h.named("microsoft.notification_received").length, 0);
  assert.equal(h.requests.length, 0);
  const manual = await receiveNotification(h.ctx, note("m1", { subscriptionId: "manual", resource: `users/${MAYA}/messages`, changeType: "updated" }));
  assert.deepEqual(manual, { accepted: true });
  assert.equal(h.ingests.length, 1);
  await assert.rejects(() => receiveNotification(h.ctx, note("")), (e) => codeOf(e) === "validation.bad_input");
});

test("a notice for an excluded member, or after the connection is off, pulls nothing; calendar notices start no pull", async () => {
  const h = mailboxReady();
  await consentExclude(h.ctx, { email: MAYA, excluded: true });
  assert.deepEqual(await receiveNotification(h.ctx, note("x1")), { accepted: true });
  await consentExclude(h.ctx, { email: MAYA, excluded: false });
  await consentDisable(h.ctx);
  await receiveNotification(h.ctx, note("x2"));
  assert.equal(h.requests.length, 0);
  assert.equal(h.scheduled.length, 0);
  const cal = mailboxReady();
  await receiveNotification(cal.ctx, note("c1", { resource: "Users/mid/Events/e1" }));
  assert.equal(cal.requests.length, 0);
});

test("a failed pull is logged and retried later; the notice is still accepted; a live subscription turns the poll into an hourly backstop", async () => {
  const h = mailboxReady();
  h.on("GET", `${U}/mailFolders/inbox/messages/delta?$select`, { status: 503, body: {} });
  assert.deepEqual(await receiveNotification(h.ctx, note("f1")), { accepted: true });
  assert.equal(h.ingests.length, 0);
  assert.equal(h.scheduled[0]!.at, NOW + 15 * MIN);
  const live = mailboxReady();
  live.ctx.db.run(`UPDATE microsoft_subscription SET "expiresAt" = ? WHERE id = ?`, NOW + 60 * MIN, "subM");
  await receiveNotification(live.ctx, note("l1"));
  assert.equal(live.scheduled[0]!.at, NOW + 60 * MIN);
});

// ---- consent

function admin(o: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness({ admin: true, members, ...o });
  h.on("GET", `${GRAPH}/organization`, { body: fixture("graph/organization.json") });
  h.on("GET", `${GRAPH}/users/maya%40vyre.test/mailFolders/inbox`, { body: { id: "inbox" } });
  return h;
}
const setupInput = { vaultItem: "#Microsoft_App", tenantId: "tenant-guid", domain: "Vyre.test", idempotencyKey: "setup-1" };

test("setup connects every mapped member once and never an excluded or outside address, and queues the first renewal Run", async () => {
  const h = admin();
  const { ensure } = await import("../projections.ts");
  ensure(h.ctx);
  h.ctx.db.run(`INSERT INTO microsoft_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, "kim@vyre.test", "usr_kim01", 1, 1, null, NOW);
  const out = await consentSetup(h.ctx, setupInput);
  assert.deepEqual(out, { configured: true, mappedMembers: 2, connected: 2 });
  check("ms.consent.setup", out);
  const connect = h.calls("mail.auto_connect_members");
  assert.equal(connect.length, 1);   // one call; the mail module sends one notice per member in it
  assert.equal(connect[0]!.input.provider, "microsoft");
  assert.deepEqual(connect[0]!.input.members, [{ userId: "usr_maya01", email: MAYA }, { userId: "usr_sam01", email: SAM }]);
  assert.deepEqual(h.calls("connections.create")[0]!.input.secrets, { Microsoft_App: "#Microsoft_App" });
  const rows = Object.fromEntries(h.rows(`SELECT email, "mailboxState", excluded FROM microsoft_member`).map((r) => [r.email, r]));
  assert.deepEqual(Object.keys(rows).sort(), ["kim@vyre.test", MAYA, SAM]);
  assert.deepEqual([rows[MAYA]!.mailboxState, rows[SAM]!.mailboxState, rows["kim@vyre.test"]!.mailboxState, rows["kim@vyre.test"]!.excluded], ["pending", "pending", null, 1]);
  const cfg = h.rows(`SELECT * FROM microsoft_config`)[0]!;
  assert.deepEqual([cfg.connectionId, cfg.tenantId, cfg.domain, cfg.clientId, cfg.configured, cfg.consentGiven, cfg.autoConnect], [CONN, "tenant-guid", "vyre.test", "11111111-2222-3333-4444-555555555555", 1, 0, 1]);
  assert.deepEqual(h.named("microsoft.consent_configured").map((e) => e.payload), [{ connector: "microsoft", tenantId: "tenant-guid", mappedMembers: 2, autoConnect: true }]);
  assert.deepEqual(h.scheduled, [{ at: NOW + 12 * 60 * MIN, cap: "ms.subscriptions.renew", input: {} }]);
  await consentSetup(h.ctx, { ...setupInput, idempotencyKey: "setup-2" });
  assert.equal(h.calls("connections.create").length, 1);   // the Space connection is kept
  assert.equal(h.scheduled.length, 1);   // and so is the one queued Run
});

test("with auto-connect off nobody is connected until the first-run step", async () => {
  const h = admin({ autoConnect: false });
  const out = await consentSetup(h.ctx, { vaultItem: "#Microsoft_App", tenantId: "tenant-guid", idempotencyKey: "s" });
  assert.deepEqual([out.mappedMembers, out.connected], [4, 0]);   // no domain was given, so every address on record is mapped
  assert.equal(h.calls("mail.auto_connect_members").length, 0);
  assert.equal((await consentStatus(h.ctx)).autoConnect, false);
});

test("an app registration Microsoft will not sign in with configures nothing and connects nobody", async () => {
  const h = admin();
  h.state.mintFails = true;
  await assert.rejects(() => consentSetup(h.ctx, setupInput), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(h.rows(`SELECT id FROM microsoft_config`).length, 0);
  assert.equal(h.rows(`SELECT email FROM microsoft_member`).length, 0);
  assert.equal(h.calls("mail.auto_connect_members").length, 0);
  h.state.mintFails = false;
  for (const patch of [{ vaultItem: "plain-secret" }, { tenantId: "bad tenant!" }, { domain: "a b" }, { domain: "x@y" }]) {
    await assert.rejects(() => consentSetup(h.ctx, { ...setupInput, ...patch }), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(patch));
  }
  await assert.rejects(() => consentSetup(h.ctx, { ...setupInput, vaultItem: "#NotAnApp" }), (e) => codeOf(e) === "provider.auth_failed");
  await assert.rejects(() => consentSetup(h.ctx, { ...setupInput, tenantId: "0000-other-guid" }), (e) => codeOf(e) === "validation.bad_input");
});

test("verify names missing permissions and the mailbox the access policy blocks, and records what it found", async () => {
  const h = admin();
  await consentSetup(h.ctx, setupInput);
  const ok = await consentVerify(h.ctx, {});
  assert.deepEqual(ok, { ok: true, missingPermissions: [] });
  assert.deepEqual(h.named("microsoft.consent_verified").at(-1)?.payload, { connector: "microsoft", ok: true, missingPermissions: [] });
  assert.deepEqual(await consentStatus(h.ctx), { configured: true, tenantId: "tenant-guid", consentGiven: true, policyConfirmed: true, lastVerifyAt: NOW, autoConnect: true, mappedMembers: 3, excluded: [] });
  check("ms.consent.verify", ok);

  h.state.roles = PERMISSIONS.filter((p) => p !== "Mail.Send" && p !== "OnlineMeetingRecording.Read.All");
  h.advance(2 * 3_600_000);   // the token is new, so the roles are re-read
  const missing = await consentVerify(h.ctx, {});
  assert.deepEqual([missing.ok, missing.missingPermissions], [false, ["Mail.Send", "OnlineMeetingRecording.Read.All"]]);
  assert.match(missing.detail ?? "", /Grant admin consent for: Mail\.Send, OnlineMeetingRecording\.Read\.All/);
  assert.equal((await consentStatus(h.ctx)).consentGiven, false);

  h.state.roles = PERMISSIONS;
  h.advance(2 * 3_600_000);
  h.on("GET", `${GRAPH}/users/maya%40vyre.test/mailFolders/inbox`, { status: 403, body: { error: { code: "ErrorAccessDenied" } } });
  const blocked = await consentVerify(h.ctx, { as: MAYA });
  assert.deepEqual([blocked.ok, blocked.missingPermissions], [false, []]);
  assert.match(blocked.detail ?? "", /cannot reach maya@vyre\.test.*access policy snippet/);
  assert.equal((await consentStatus(h.ctx)).consentGiven, true);   // consent is fine; the policy is the gap
  assert.equal((await consentStatus(h.ctx)).policyConfirmed, false);
  const told = await consentVerify(h.ctx, { as: MAYA, policyConfirmed: true });
  assert.equal(told.ok, false);
  assert.equal((await consentStatus(h.ctx)).policyConfirmed, true);   // the admin said they ran it

  h.on("GET", `${GRAPH}/organization`, { status: 403, body: { error: { code: "Authorization_RequestDenied" } } });
  const refused = await consentVerify(h.ctx, {});
  assert.equal(refused.ok, false);
  assert.match(refused.detail ?? "", /consent link/);
  await assert.rejects(() => consentVerify(harness({ admin: true }).ctx, {}), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(() => consentVerify(h.ctx, { as: "nope" }), (e) => codeOf(e) === "validation.bad_input");
});

test("the consent link and the PowerShell snippet carry the client id and the mapped members", async () => {
  const h = admin();
  await assert.rejects(() => consentLink(h.ctx, {}), (e) => codeOf(e) === "validation.precondition_failed");
  const blank = await consentSnippet(h.ctx);
  assert.match(blank.snippet, /first\.member@yourcompany\.com/);
  await consentSetup(h.ctx, setupInput);
  await consentExclude(h.ctx, { email: SAM, excluded: true });
  const link = await consentLink(h.ctx, {});
  assert.equal(link.url, "https://login.microsoftonline.com/tenant-guid/adminconsent?client_id=11111111-2222-3333-4444-555555555555");
  assert.deepEqual(link.permissions, PERMISSIONS);
  assert.equal((await consentLink(h.ctx, { tenantId: "contoso.onmicrosoft.com" })).url.startsWith("https://login.microsoftonline.com/contoso.onmicrosoft.com/"), true);
  await assert.rejects(() => consentLink(h.ctx, { tenantId: "a/../b" }), (e) => codeOf(e) === "validation.bad_input");
  const snippet = await consentSnippet(h.ctx);
  assert.equal(snippet.language, "powershell");
  assert.equal(snippet.groupName, "VyreMappedMembers");
  assert.match(snippet.snippet, /New-DistributionGroup -Name "VyreMappedMembers" .* -Members "kim@vyre\.test","maya@vyre\.test"\r?\n/);
  assert.ok(!snippet.snippet.includes(SAM));   // an excluded member is not given access
  assert.match(snippet.snippet, /New-ApplicationAccessPolicy -AppId "11111111-2222-3333-4444-555555555555" -PolicyScopeGroupId "vyremappedmembers@vyre\.test" -AccessRight RestrictAccess/);
  assert.match(snippet.snippet, /Test-ApplicationAccessPolicy .* -Identity "kim@vyre\.test"/);
  for (const [cap, out] of [["ms.consent.link", link], ["ms.consent.policy_snippet", snippet]] as const) check(cap, out);
});

test("members list in pages; an exclusion stops every call for that member; turning the connection off stops them all", async () => {
  const h = admin();
  await consentSetup(h.ctx, setupInput);
  const page = await consentMembers(h.ctx, { limit: 1 });
  assert.deepEqual(page.members, [{ email: "kim@vyre.test", userId: "usr_kim01", mapped: true, excluded: false, mailboxState: "pending" }]);
  assert.equal(page.next, "1");
  assert.deepEqual((await consentMembers(h.ctx, { limit: 1, cursor: page.next })).members.map((m) => m.email), [MAYA]);
  check("ms.consent.members", page);
  await assert.rejects(() => consentMembers(h.ctx, { limit: 0 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => consentMembers(h.ctx, { cursor: "x" }), (e) => codeOf(e) === "validation.bad_input");

  h.on("GET", /mailFolders/, { body: { value: [] } });
  assert.deepEqual(await consentExclude(h.ctx, { email: "Sam@Vyre.test", excluded: true }), { excluded: [SAM] });
  await assert.rejects(() => mailFolders(h.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  assert.deepEqual(await consentExclude(h.ctx, { email: SAM, excluded: false }), { excluded: [] });
  await mailFolders(h.ctx, { ...act, as: SAM });
  assert.deepEqual(await consentExclude(h.ctx, { email: "new@vyre.test", excluded: true }), { excluded: ["new@vyre.test"] });
  await assert.rejects(() => consentExclude(h.ctx, { email: "nope", excluded: true }), (e) => codeOf(e) === "validation.bad_input");

  assert.deepEqual(await consentDisable(h.ctx), { disabled: true });
  assert.deepEqual(h.named("microsoft.consent_revoked").map((e) => e.payload), [{ connector: "microsoft", by: "usr_maya01" }]);
  assert.equal((await consentStatus(h.ctx)).configured, false);
  assert.ok(h.rows(`SELECT "mailboxState" FROM microsoft_member WHERE mapped = ?`, 1).every((r) => r.mailboxState === "paused"));
  await assert.rejects(() => mailFolders(h.ctx, act), (e) => codeOf(e) === "validation.precondition_failed");
  check("ms.consent.disable", { disabled: true });
});

test("status before setup, and read log rows for tenant-level calls", async () => {
  const h = admin();
  const before = await consentStatus(h.ctx);
  assert.deepEqual(before, { configured: false, consentGiven: false, policyConfirmed: false, autoConnect: true, mappedMembers: 0, excluded: [] });
  check("ms.consent.status", before);
  await consentSetup(h.ctx, setupInput);
  await consentVerify(h.ctx, {});
  const log = h.rows(`SELECT subject, cap FROM microsoft_read_log`);
  assert.deepEqual(log.filter((r) => r.cap === "ms.consent.verify").map((r) => r.subject), ["tenant", MAYA]);   // the organization check reaches no member; the probe reaches one
});

// ---- health

test("health is healthy with a latency, degraded when Microsoft struggles, down when the sign-in is refused or nothing is set up", async () => {
  const off = harness();
  assert.deepEqual(await health(off.ctx), { state: "down", detail: "Microsoft 365 is not set up." });
  const h = ready();
  h.on("GET", `${GRAPH}/organization`, { body: fixture("graph/organization.json") });
  const ok = await health(h.ctx);
  assert.deepEqual(ok, { state: "healthy", latencyMs: 0 });
  check("ms.health", ok);
  h.on("GET", `${GRAPH}/organization`, { status: 503, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET", `${GRAPH}/organization`, { status: 403, body: { error: { code: "Authorization_RequestDenied" } } });
  assert.equal((await health(h.ctx)).state, "down");
  h.on("GET", `${GRAPH}/organization`, { throws: true });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.state.mintFails = true;
  h.advance(3_700_000);
  const down = await health(h.ctx);
  assert.equal(down.state, "down");
  assert.match(down.detail ?? "", /consent and the app permissions/);
});

// ---- the module

test("the handler map covers exactly the capabilities the microsoft manifest declares", () => {
  const declared = registry.capabilities.filter((c) => c.module === "microsoft").map((c) => c.name).sort();
  assert.deepEqual(Object.keys(handlers).sort(), declared);
  assert.equal(declared.length, 48);
});
