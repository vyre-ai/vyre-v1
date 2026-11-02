// The identity rules of Connect your company, for Google. Each rule has its test, named for the rule: an agent reaches a person's mail, calendar or files only for that person; excluded members are never touched;
// a person gone from the directory loses access; the log names who, for whom and which mailbox. Mail, calendar and files come in with nobody signing in.
import test from "node:test";
import assert from "node:assert/strict";
import { accessLog, adoptPolls, directoryImport, directoryReconcile, matchProven, dwdConnectAll, dwdProbe, dwdScopes, dwdSetData, dwdSetExcluded, dwdSetup, dwdStatus, getProfile, personLeft, receivePush, syncMembers } from "../handlers/index.ts";
import { dataOf, ensure, SCOPE, scopesFor, SCOPES, subjectFor } from "../projections.ts";
import { act, codeOf, CONN, contractErrors, fixture, harness, NOW, seedDelegation } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const DIRECTORY = "https://admin.googleapis.com/admin/directory/v1/users";
const ADMIN = "admin@vyre.test", MAYA = "maya@vyre.test", SAM = "sam@vyre.test", KIM = "kim@vyre.test";
const people = [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01" }, { email: KIM, userId: "usr_kim01" }];
const setup = { vaultItem: "#Google_DWD", adminEmail: ADMIN, idempotencyKey: "s1" };

function world(o: Parameters<typeof harness>[0] = {}, seeded: { email: string; userId: string; excluded?: boolean }[] = people): Harness {
  const h = harness({ admin: true, members: people, ...o });
  ensure(h.ctx);
  seedDelegation(h, { members: seeded });
  h.on("GET", PROFILE, { body: { emailAddress: MAYA, historyId: "1" } });
  return h;
}
const asHost = (h: Harness) => ({ ...h.ctx, principal: { kind: "service" as const, id: "svc_host" } });
const nextPoll = (h: Harness, email: string): unknown => h.rows(`SELECT "nextPollAt" FROM google_mailbox WHERE email = ?`, email)[0]?.nextPollAt;
const directory = (h: Harness, users: Record<string, unknown>[], next?: string) => h.on("GET", DIRECTORY, { body: { users, ...(next ? { nextPageToken: next } : {}) } });
const user = (primaryEmail: string, o: Record<string, unknown> = {}) => ({ primaryEmail, suspended: false, ...o });

test("rule: an agent working for an admin never reaches a teammate's mailbox, whatever the delegation can do", async () => {
  const h = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  await assert.rejects(() => getProfile(h.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  assert.deepEqual(h.minted, [], "not even a token was made for the teammate");
  await getProfile(h.ctx, act);
  assert.equal(h.minted.at(-1)?.sub, MAYA, "the asker's own mailbox, as the asker");
});

test("rule: an admin's role and an automation's grant reach no teammate either; only the host's own services name a member", async () => {
  const person = world();
  await assert.rejects(() => getProfile(person.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  const automation = world({ principal: { kind: "service", id: `svc_${"a".repeat(32)}` } });
  await assert.rejects(() => getProfile(automation.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  const agentAlone = world({ principal: { kind: "agent", id: "agt_assist01" } });
  await assert.rejects(() => getProfile(agentAlone.ctx, act), (e) => codeOf(e) === "validation.precondition_failed", "an agent working for nobody has no mailbox");
  const host = world({ principal: { kind: "service", id: "svc_host" } });
  await getProfile(host.ctx, { ...act, as: SAM });
  assert.equal(host.minted.at(-1)?.sub, SAM);
});

test("rule: the push secret never reaches a model", async () => {
  const h = world();
  await dwdSetExcluded(h.ctx, { email: KIM, excluded: false });
  h.ctx.db.run(`INSERT INTO google_push_secret (id, token, created_at) VALUES (?, ?, ?)`, "google", "s3cr3t", NOW);
  assert.equal((await dwdStatus(h.ctx)).pushToken, "s3cr3t", "the admin setting up Pub/Sub sees it");
  const agent = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  agent.ctx.db.run(`INSERT INTO google_push_secret (id, token, created_at) VALUES (?, ?, ?)`, "google", "s3cr3t", NOW);
  assert.equal((await dwdStatus(agent.ctx)).pushToken, undefined);
});

test("rule: an excluded member is never touched: no probe, no token, no invitation, and it holds through sync and setup", async () => {
  const h = world({}, [...people.slice(0, 2), { ...people[2]!, excluded: true }]);
  await assert.rejects(() => dwdProbe(h.ctx, { as: KIM }), (e) => codeOf(e) === "permission.no_grant");
  const host = { ...h.ctx, principal: { kind: "service" as const, id: "svc_host" } };
  await assert.rejects(() => getProfile(host, { ...act, as: KIM }), (e) => codeOf(e) === "permission.no_grant");
  assert.deepEqual(h.minted.filter((m) => m.sub === KIM), []);
  const invited = await directoryImport(h.ctx, { people: [{ email: KIM, role: "rol_member" }], idempotencyKey: "i1" });
  assert.deepEqual(invited, { invited: [], skipped: [{ email: KIM, reason: "Excluded. Include them first." }] });
  await syncMembers(h.ctx, {});
  await dwdSetup(h.ctx, { ...setup, idempotencyKey: "s2" });
  assert.deepEqual((await dwdStatus(h.ctx)).excluded, [KIM]);
  await dwdConnectAll(h.ctx, { idempotencyKey: "c1" });
  assert.ok(!JSON.stringify(h.calls("mail.auto_connect_members")).includes(KIM), "no mailbox was made for them");
  assert.ok(!JSON.stringify(h.calls("calendar.connect_provider")).includes(KIM), "no calendar was made for them");
  assert.ok(!JSON.stringify(h.scheduled).includes(KIM), "no pull was queued for them");
});

test("rule: excluding someone stops their mailbox, calendar, mounts and polling at once; including them brings them back", async () => {
  const h = world();
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, SAM, CONN, "1", null, null, null, null, NOW + 1000);
  await dwdSetExcluded(h.ctx, { email: SAM, excluded: true });
  assert.deepEqual(h.calls("mail.member_pause").map((c) => c.input), [{ provider: "google", address: SAM, paused: true }]);
  assert.deepEqual(h.calls("mounts.account_pause").map((c) => c.input), [{ account: SAM, paused: true }]);
  assert.equal(h.calls("calendar.connect_provider").at(-1)?.input.connected, false);
  assert.equal(h.rows(`SELECT "nextPollAt" FROM google_mailbox WHERE email = ?`, SAM)[0]?.nextPollAt, null);
  await dwdSetExcluded(h.ctx, { email: SAM, excluded: false });
  assert.equal(h.calls("mail.member_pause").at(-1)?.input.paused, false);
  assert.equal(h.calls("mounts.account_pause").at(-1)?.input.paused, false);
  assert.equal(nextPoll(h, SAM), 0, "their pull is due for the host: a job the admin queued would run as the admin, who never reads a teammate's mailbox");
  await adoptPolls(asHost(h));
  assert.ok(h.scheduled.some((s) => String(s.input.messageId).startsWith(`adopt:${SAM}`)), "the host queues it");
});

test("rule: a mail poll an admin queued for a teammate never reads their mailbox as the admin; the host takes it over and their mail comes in", async () => {
  const h = world();
  h.on("GET", /\/history\?/, { body: fixture("gmail/history-page2.json") });
  for (const [id, file] of Object.entries({ m1: "message-m1.json", m3: "message-m3.json", d1: "message-draft.json" })) h.on("GET", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?`, { body: fixture(`gmail/${file}`) });
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/att1", { body: fixture("gmail/attachment.json") });
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, SAM, CONN, "1000", null, null, null, null, NOW);
  // the job runs as whoever queued it: here the admin who pressed Connect
  await receivePush(h.ctx, { kind: "gmail", messageId: `poll:${SAM}:${NOW}`, mailbox: SAM });
  assert.equal(h.ingests.length, 0, "nothing is read as the admin");
  assert.deepEqual(h.minted.filter((m) => m.sub === SAM), [], "not even a token");
  assert.equal(h.scheduled.length, 0, "the admin's chain ends here");
  assert.equal(nextPoll(h, SAM), 0, "and the mailbox is due for the host");
  assert.deepEqual(await adoptPolls(h.ctx), { adopted: 0 }, "only the host adopts a poll");
  assert.deepEqual(await adoptPolls(asHost(h)), { adopted: 1 });
  const job = h.scheduled.at(-1)!;
  assert.deepEqual([job.cap, job.input.mailbox], ["google.receive_push", SAM]);
  await receivePush(asHost(h), job.input as never);
  assert.equal(h.ingests.length, 2, "the host's pass brings their mail in");
  assert.ok(Number(nextPoll(h, SAM)) > NOW, "and keeps one poll queued");
  assert.deepEqual(await adoptPolls(asHost(h)), { adopted: 0 }, "a chain the host runs is never taken over twice");
});

test("rule: a person gone from the directory stops and is suspended, which refuses their next sign-in", async () => {
  const h = world();
  directory(h, [user(ADMIN), user(MAYA), user(KIM)]);
  const out = await directoryReconcile(h.ctx, {});
  assert.deepEqual(out, { checked: 3, gone: [SAM] });
  assert.deepEqual(contractErrors("google.directory.reconcile", "out", out), []);
  assert.deepEqual(h.calls("members.suspend").map((c) => c.input), [{ personId: "usr_sam01", reason: "Gone from the company directory" }]);
  assert.deepEqual(h.calls("mail.member_pause").map((c) => c.input.address), [SAM]);
  const host = { ...h.ctx, principal: { kind: "service" as const, id: "svc_host" } };
  await assert.rejects(() => getProfile(host, { ...act, as: SAM }), (e) => codeOf(e) === "validation.precondition_failed", "nothing reaches their mailbox any more");
  await syncMembers(h.ctx, {});
  assert.equal(h.rows(`SELECT mapped FROM google_member WHERE email = ?`, SAM)[0]?.mapped, 0, "sync does not bring them back");
});

test("rule: suspended at the provider counts as gone; an address that became an alias does not", async () => {
  const h = world();
  directory(h, [user(ADMIN), user(MAYA, { suspended: true }), user("sam.lee@vyre.test", { aliases: [SAM] }), user(KIM)]);
  assert.deepEqual((await directoryReconcile(h.ctx, {})).gone, [MAYA]);
});

test("rule: an answer cut short removes nobody", async () => {
  const failed = world();
  failed.on("GET", DIRECTORY, { status: 503, body: {} });
  await assert.rejects(() => directoryReconcile(failed.ctx, {}), (e) => codeOf(e) === "provider.unavailable");
  assert.equal(failed.calls("members.suspend").length, 0);
  const wrong = world();
  directory(wrong, [user(MAYA)]);
  assert.match((await directoryReconcile(wrong.ctx, {})).held ?? "", /without admin@vyre\.test/, "a directory without its own admin is the wrong answer");
  assert.equal(wrong.calls("members.suspend").length, 0);
  const many = world({}, [...people, { email: "a@vyre.test", userId: "usr_a01" }, { email: "b@vyre.test", userId: "usr_b01" }]);
  directory(many, [user(ADMIN), user(MAYA)]);
  const held = await directoryReconcile(many.ctx, {});
  assert.deepEqual(held.gone, []);
  assert.match(held.held ?? "", /4 of 5 people look gone/);
  assert.equal(many.calls("members.suspend").length, 0, "a large change waits for a person");
  assert.equal((await directoryReconcile(many.ctx, { confirmed: true })).gone.length, 4);
});

test("rule: only a person confirms a large removal", async () => {
  const h = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  await assert.rejects(() => directoryReconcile(h.ctx, { confirmed: true }), (e) => codeOf(e) === "permission.no_grant");
});

test("rule: a person removed by the wizard stops being read", async () => {
  const h = world();
  await personLeft(h.ctx, { payload: { personId: "usr_sam01" } });
  assert.equal(h.rows(`SELECT mapped FROM google_member WHERE email = ?`, SAM)[0]?.mapped, 0);
});

test("rule: the log names who, on whose behalf and which mailbox", async () => {
  const h = world({ principal: { kind: "agent", id: "agt_assist01" }, actingFor: "usr_maya01" });
  await getProfile(h.ctx, act);
  const out = await accessLog(h.ctx, {});
  assert.deepEqual(out, { entries: [{ who: "agt_assist01", onBehalf: "usr_maya01", mailbox: MAYA, cap: "google.gmail.get_profile", at: NOW }] });
  assert.deepEqual(contractErrors("google.access_log", "out", out), []);
  assert.deepEqual((await accessLog(h.ctx, { mailbox: SAM })).entries, []);
  const person = world();
  await getProfile(person.ctx, act);
  assert.deepEqual((await accessLog(person.ctx, {})).entries[0], { who: "usr_maya01", mailbox: MAYA, cap: "google.gmail.get_profile", at: NOW }, "a person acting for themselves names nobody else");
});

test("data: Mail, Calendar and Files are chosen separately, and only those scopes are asked for and checked", async () => {
  assert.deepEqual(scopesFor({ mail: true, calendar: true, files: true }), SCOPES);
  assert.deepEqual(scopesFor({ mail: true, calendar: false, files: false }).map((s) => s.slice(SCOPE.length)), ["gmail.modify", "admin.directory.user.readonly"]);
  const h = harness({ admin: true, members: people });
  ensure(h.ctx);
  h.on("GET", PROFILE, { body: { emailAddress: ADMIN, historyId: "1" } });
  await dwdSetup(h.ctx, { ...setup, data: { mail: true, calendar: false, files: false } });
  assert.deepEqual((await dwdScopes(h.ctx)).scopes.map((s) => s.slice(SCOPE.length)), ["gmail.modify", "admin.directory.user.readonly"]);
  assert.equal(h.calls("calendar.connect_provider").length, 0, "no calendar comes in");
  const minted = h.minted.length;
  assert.equal((await dwdProbe(h.ctx, {})).ok, true);
  assert.deepEqual(h.minted.slice(minted).map((m) => m.scopes[0]!.slice(SCOPE.length)), ["gmail.modify", "admin.directory.user.readonly"], "the probe checks what was chosen, and nothing else");
});

test("data: turning a service off stops it for everyone, and on brings it in", async () => {
  const h = world();
  const out = await dwdSetData(h.ctx, { data: { mail: false, calendar: true, files: false }, idempotencyKey: "d1" });
  assert.deepEqual(contractErrors("google.dwd.set_data", "out", out), []);
  assert.deepEqual(dataOf(h.rows(`SELECT * FROM google_config`)[0]!), { mail: false, calendar: true, files: false });
  assert.equal(h.calls("mail.member_pause").length, 3);
  assert.equal(h.calls("mounts.account_pause").length, 3);
  await dwdSetData(h.ctx, { data: { mail: true, calendar: true, files: false }, idempotencyKey: "d2" });
  assert.equal(h.calls("mail.auto_connect_members").length, 3);
  await adoptPolls(asHost(h));
  assert.deepEqual(h.scheduled.filter((s) => /^(first|adopt):/.test(String(s.input.messageId))).map((s) => s.input.mailbox).sort(), [KIM, MAYA, SAM], "each comes back with a first pull: the caller's own at once, the others by the host");
});

test("no per-person sign-in: setup can hold, then one confirmation brings everyone in and starts their mail, spaced out", async () => {
  const h = harness({ admin: true, members: people });
  ensure(h.ctx);
  h.on("GET", PROFILE, { body: { emailAddress: ADMIN, historyId: "1" } });
  const held = await dwdSetup(h.ctx, { ...setup, hold: true });
  assert.deepEqual([held.mappedMembers, held.connected], [3, 0]);
  assert.equal(h.calls("mail.auto_connect_members").length, 0, "nobody comes in before a person chose who is in");
  await dwdSetExcluded(h.ctx, { email: KIM, excluded: true });
  const out = await dwdConnectAll(h.ctx, { idempotencyKey: "c1" });
  assert.deepEqual(out, { connected: 2, included: 2 });
  assert.deepEqual(h.scheduled.map((s) => [s.cap, s.at, s.input.mailbox]), [["google.receive_push", NOW + 1000, MAYA]], "the person pressing it pulls their own mailbox");
  assert.equal(nextPoll(h, SAM), 0, "a teammate's is left due for the host");
  await adoptPolls(asHost(h));
  assert.deepEqual(h.scheduled.slice(1).map((s) => [s.cap, s.at, s.input.mailbox]), [["google.receive_push", NOW + 1000, SAM]], "the host queues it within a minute, spaced out");
  assert.equal(h.calls("calendar.connect_provider").filter((c) => c.input.connected !== false).length, 2);
  await dwdConnectAll(h.ctx, { idempotencyKey: "c2" });
  await adoptPolls(asHost(h));
  assert.equal(h.scheduled.length, 2, "repeating it starts no second chain");
});

test("rule: Sign in with Google matches the person to the address it proved, and never takes, moves or brings back anyone", async () => {
  const h = world();
  const host = asHost(h);
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: "new@elsewhere.test" }), { matched: false, reason: "not connected for that domain" });
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: SAM }), { matched: false, reason: "matched to someone else" }, "an address another person holds stays theirs");
  assert.deepEqual(await matchProven(host, { person: "usr_maya01", email: "maya.other@vyre.test" }), { matched: false, reason: "matched to another address" }, "a person matched elsewhere is an admin's call");
  h.ctx.db.run(`UPDATE google_member SET mapped = ?, "directoryGone" = ? WHERE email = ?`, 0, 1, KIM);
  assert.deepEqual(await matchProven(host, { person: "usr_kim01", email: KIM }), { matched: false, reason: "gone from the directory" });
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: "new@vyre.test" }), { matched: true });
  assert.deepEqual(h.rows(`SELECT "userId", mapped FROM google_member WHERE email = ?`, "new@vyre.test"), [{ userId: "usr_new01", mapped: 1 }]);
  assert.deepEqual(await matchProven(host, { person: "usr_new01", email: "new@vyre.test" }), { matched: true }, "a second sign-in changes nothing");
});

test("subjectFor lets the setup probe act as the admin and nobody else", () => {
  const h = world();
  assert.equal(subjectFor(h.ctx, { connectionId: CONN, as: ADMIN, open: true }), ADMIN);
  assert.throws(() => subjectFor(h.ctx, { connectionId: CONN, as: SAM, open: true }), (e) => codeOf(e) === "permission.no_grant");
});
