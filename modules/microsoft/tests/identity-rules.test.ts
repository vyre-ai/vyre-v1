// The identity rules of Connect your company, for Microsoft. The same rules as Google's, and what is Microsoft's own: Mail and Calendars are not consented in Entra, where they would reach every mailbox.
import test from "node:test";
import assert from "node:assert/strict";
import { accessLog, adoptPolls, consentConnectAll, consentExclude, consentSetData, consentSetup, consentSnippet, consentStatus, consentVerify, directoryImport, directoryReconcile, mailFolders, matchProven, receiveNotification, renew, syncMembers } from "../handlers/index.ts";
import { dataOf, ensure, GRAPH, PERMISSIONS, permissionsFor, rolesFor } from "../projections.ts";
import { act, codeOf, CONN, contractErrors, harness, NOW, seedConsent } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test", SAM = "sam@vyre.test", KIM = "kim@vyre.test";
const people = [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01" }, { email: KIM, userId: "usr_kim01" }];
const USERS = `${GRAPH}/users`;

const asHost = (h: Harness) => ({ ...h.ctx, principal: { kind: "service" as const, id: "svc_host" } });
function world(o: Parameters<typeof harness>[0] = {}, seeded: { email: string; userId: string; excluded?: boolean }[] = people): Harness {
  const h = harness({ admin: true, members: people, ...o });
  ensure(h.ctx);
  seedConsent(h, { members: seeded });
  h.on("GET", /mailFolders/, { body: { value: [] } });
  return h;
}
const user = (mail: string, o: Record<string, unknown> = {}) => ({ mail, userPrincipalName: mail, accountEnabled: true, ...o });
const subscription = (h: Harness, id: string, mailbox: string, expiresAt: number) => h.ctx.db.run(
  `INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "mail", `users/${mailbox}/messages`, mailbox, CONN, "https://space.test/hook", "cs", expiresAt, 4230, "created");

test("rule: an agent working for an admin never reaches a teammate's mailbox", async () => {
  const h = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  await assert.rejects(() => mailFolders(h.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(h.requests.length, 0, "Graph was never asked");
  await mailFolders(h.ctx, act);
  assert.match(h.requests.at(-1)!.url, /users\/maya%40vyre\.test\//);
});

test("rule: an admin's role and an automation's grant reach no teammate either", async () => {
  const person = world();
  await assert.rejects(() => mailFolders(person.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  const automation = world({ principal: { kind: "service", id: `svc_${"a".repeat(32)}` } });
  await assert.rejects(() => mailFolders(automation.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
});

test("rule: the setup check reaches only an included member, the caller's own mailbox first", async () => {
  const h = world({}, [...people.slice(0, 2), { ...people[2]!, excluded: true }]);
  await assert.rejects(() => consentVerify(h.ctx, { as: KIM }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => consentVerify(h.ctx, { as: "stranger@vyre.test" }), (e) => codeOf(e) === "permission.no_grant");
  assert.ok(!h.requests.some((r) => r.url.includes("kim%40vyre.test")), "an excluded inbox is never read");
  h.on("GET", `${GRAPH}/organization`, { body: { value: [{ id: "org" }] } });
  await consentVerify(h.ctx, {});
  assert.ok(h.requests.at(-1)!.url.includes("maya%40vyre.test"), "the person checking is the one probed");
});

test("rule: an excluded member is never touched: no invitation, no calendar, and their watch comes down", async () => {
  const h = world();
  subscription(h, "subSam", SAM, NOW + 1000);
  h.on("DELETE", `${GRAPH}/subscriptions/subSam`, { status: 204 });
  await consentExclude(h.ctx, { email: SAM, excluded: true });
  assert.equal(h.rows(`SELECT id FROM microsoft_subscription`).length, 0);
  assert.equal(h.calls("mail.member_pause").at(-1)?.input.paused, true);
  assert.equal(h.calls("mounts.account_pause").at(-1)?.input.paused, true);
  assert.deepEqual(await directoryImport(h.ctx, { people: [{ email: SAM, role: "rol_member" }], idempotencyKey: "i1" }), { invited: [], skipped: [{ email: SAM, reason: "Excluded. Include them first." }] });
  await syncMembers(h.ctx, {});
  await consentConnectAll(h.ctx, { idempotencyKey: "c1" });
  assert.ok(!JSON.stringify(h.calls("mail.auto_connect_members")).includes(SAM));
  assert.ok(!JSON.stringify(h.scheduled).includes(SAM));
});

test("rule: the renewal Run never keeps a watch alive on someone excluded", async () => {
  const h = world({ principal: { kind: "service", id: "svc_host" } }, [...people.slice(0, 2), { ...people[2]!, excluded: true }]);
  subscription(h, "subKim", KIM, NOW + 1000);
  h.on("DELETE", `${GRAPH}/subscriptions/subKim`, { status: 204 });
  await renew(h.ctx);
  assert.equal(h.requests.filter((r) => r.method === "PATCH").length, 0);
  assert.equal(h.requests.filter((r) => r.method === "DELETE").length, 1);
  assert.equal(h.rows(`SELECT id FROM microsoft_subscription`).length, 0);
});

test("rule: a person gone or turned off in the directory stops and is suspended; a proxy address is not leaving", async () => {
  const h = world();
  h.on("GET", USERS, { body: { value: [user(MAYA, { accountEnabled: false }), user("sam.lee@vyre.test", { proxyAddresses: [`smtp:${SAM}`] })] } });
  const out = await directoryReconcile(h.ctx, {});
  assert.deepEqual(out, { checked: 3, gone: [MAYA, KIM] });
  assert.deepEqual(contractErrors("ms.directory.reconcile", "out", out), []);
  assert.deepEqual(h.calls("members.suspend").map((c) => c.input.personId).sort(), ["usr_kim01", "usr_maya01"]);
});

test("rule: an answer cut short or empty removes nobody, and a large change waits for a person", async () => {
  const failed = world();
  failed.on("GET", USERS, { status: 503, body: {} });
  await assert.rejects(() => directoryReconcile(failed.ctx, {}));
  assert.equal(failed.calls("members.suspend").length, 0);
  const empty = world();
  empty.on("GET", USERS, { body: { value: [] } });
  assert.match((await directoryReconcile(empty.ctx, {})).held ?? "", /nobody in it/);
  const many = world({}, [...people, { email: "a@vyre.test", userId: "usr_a01" }, { email: "b@vyre.test", userId: "usr_b01" }]);
  many.on("GET", USERS, { body: { value: [user(MAYA)] } });
  assert.match((await directoryReconcile(many.ctx, {})).held ?? "", /4 of 5/);
  assert.equal((await directoryReconcile(many.ctx, { confirmed: true })).gone.length, 4);
  const agent = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  await assert.rejects(() => directoryReconcile(agent.ctx, { confirmed: true }), (e) => codeOf(e) === "permission.no_grant");
});

test("rule: the log names who, on whose behalf and which mailbox", async () => {
  const h = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  await mailFolders(h.ctx, act);
  const out = await accessLog(h.ctx, {});
  assert.deepEqual(out.entries, [{ who: "agt_assist01", onBehalf: "usr_maya01", mailbox: MAYA, cap: "ms.mail.list_folders", at: NOW }]);
  assert.deepEqual(contractErrors("ms.access_log", "out", out), []);
});

test("Mail and Calendars stay out of Entra, and verify says so if someone consented them there", async () => {
  assert.ok(!PERMISSIONS.some((p) => /^(Mail|Calendars)\./.test(p)));
  assert.deepEqual(permissionsFor({ mail: true, calendar: false, files: false }), ["User.Read.All"]);
  assert.deepEqual(rolesFor({ mail: true, calendar: false, files: false }), ["Application Mail.ReadWrite", "Application Mail.Send"]);
  const h = world();
  h.on("GET", `${GRAPH}/organization`, { body: { value: [{ id: "org" }] } });
  h.state.roles = [...PERMISSIONS, "Mail.ReadWrite"];
  const out = await consentVerify(h.ctx, {});
  assert.equal(out.ok, true, "it works; it is only wider than it should be");
  assert.deepEqual(out.unscoped, ["Mail.ReadWrite"]);
  assert.match(out.detail ?? "", /Remove Mail\.ReadWrite from the app in Entra/);
});

test("the Exchange snippet follows what was chosen, and asks for nothing about mail when Mail and Calendar are off", async () => {
  const h = world();
  h.on("GET", `${GRAPH}/organization`, { body: { value: [{ id: "org" }] } });
  await consentSetData(h.ctx, { data: { mail: false, calendar: false, files: true }, idempotencyKey: "d1" });
  assert.equal((await consentSnippet(h.ctx)).snippet.includes("New-ManagementRoleAssignment"), false);
  await consentSetData(h.ctx, { data: { mail: true, calendar: false, files: true }, idempotencyKey: "d2" });
  const s = (await consentSnippet(h.ctx)).snippet;
  assert.ok(s.includes("Application Mail.Send") && !s.includes("Application Calendars.ReadWrite"));
});

test("data: chosen separately, and one confirmation brings everyone in with nobody signing in", async () => {
  const h = harness({ admin: true, members: people });
  ensure(h.ctx);
  const held = await consentSetup(h.ctx, { vaultItem: "#Microsoft_App", tenantId: "tenant-guid", domain: "vyre.test", data: { mail: true, calendar: false, files: true }, hold: true, idempotencyKey: "s1" });
  assert.deepEqual([held.mappedMembers, held.connected], [3, 0]);
  assert.deepEqual((await consentStatus(h.ctx)).data, { mail: true, calendar: false, files: true });
  assert.deepEqual(dataOf(h.rows(`SELECT * FROM microsoft_config`)[0]!), { mail: true, calendar: false, files: true });
  await consentExclude(h.ctx, { email: KIM, excluded: true });
  assert.deepEqual(await consentConnectAll(h.ctx, { idempotencyKey: "c1" }), { connected: 2, included: 2 });
  assert.equal(h.calls("calendar.connect_provider").filter((c) => c.input.connected !== false).length, 0);
  assert.deepEqual(h.scheduled.filter((s) => s.cap === "ms.receive_notification").map((s) => s.input.resource), [`users/${MAYA}/messages`], "the person pressing it pulls their own mailbox");
  await adoptPolls(asHost(h));
  assert.deepEqual(h.scheduled.filter((s) => s.cap === "ms.receive_notification").map((s) => s.input.resource), [`users/${MAYA}/messages`, `users/${SAM}/messages`], "the host queues the teammate's");
});

test("rule: a mail poll an admin queued for a teammate never reads their mailbox as the admin; the host takes it over", async () => {
  const h = world();
  h.ctx.db.run(`INSERT INTO microsoft_mailbox (email, "connectionId", "nextPollAt") VALUES (?, ?, ?)`, SAM, CONN, NOW);
  await receiveNotification(h.ctx, { notificationId: `poll:${SAM}:${NOW}`, subscriptionId: "poll", resource: `users/${SAM}/messages`, changeType: "updated", clientStateOk: true });
  assert.equal(h.requests.filter((r) => r.url.includes(encodeURIComponent(SAM)) || r.url.includes(SAM)).length, 0, "nothing is read as the admin");
  assert.equal(h.scheduled.length, 0, "the admin's chain ends here");
  assert.equal(h.rows(`SELECT "nextPollAt" FROM microsoft_mailbox WHERE email = ?`, SAM)[0]?.nextPollAt, 0, "and the mailbox is due for the host");
  assert.deepEqual(await adoptPolls(h.ctx), { adopted: 0 }, "only the host adopts a poll");
  assert.deepEqual(await adoptPolls(asHost(h)), { adopted: 1 });
  assert.deepEqual(h.scheduled.map((s) => [s.cap, s.input.resource]), [["ms.receive_notification", `users/${SAM}/messages`]]);
});

test("rule: a sign-in proved in the tenant matches the person to that address, and never takes one someone else holds", async () => {
  const h = world();
  const host = asHost(h);
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: "new@vyre.test", tenant: "other-tenant" }), { matched: false, reason: "not connected for that tenant" });
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: SAM, tenant: "tenant-guid" }), { matched: false, reason: "matched to someone else" });
  assert.deepEqual(await matchProven(host, { person: "usr_maya01", email: "maya.other@vyre.test", tenant: "tenant-guid" }), { matched: false, reason: "matched to another address" });
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: "new@vyre.test", tenant: "tenant-guid" }), { matched: true });
  assert.deepEqual(h.rows(`SELECT "userId", mapped FROM microsoft_member WHERE email = ?`, "new@vyre.test"), [{ userId: "usr_new01", mapped: 1 }]);
});
