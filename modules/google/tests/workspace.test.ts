// Delegation setup and the auto-connect notices, the member map and exclusions, the read log per person, push intake and polling, health,
// and the Calendar, Drive, Sheets, Docs and Meet calls against scripted Google answers. No socket is opened.
import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarList, calendarStopWatch, calendarWatch, docBatch, docCreate, docGet, driveChanges, driveCopy, driveCreateFolder, driveDownload, driveExport, driveGet, driveList,
  drivePermissions, driveShare, driveStopWatch, driveTrash, driveUpload, driveWatch, dwdDisable, dwdMembers, dwdProbe, dwdScopes, dwdSetExcluded, dwdSetup, dwdStatus,
  eventCreate, eventDelete, eventGet, eventRespond, eventsList, eventUpdate, freeBusy, health, meetEntries, meetRecordings, meetRecords, meetSubscribe, meetTranscripts,
  receivePush, sheetAppend, sheetBatch, sheetCreate, sheetGet, sheetUpdate, sheetValues,
} from "../handlers/index.ts";
import { getProfile, watch } from "../handlers/gmail.ts";
import { handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { ensure, SCOPES } from "../projections.ts";
import { act, codeOf, CONN, contractErrors, fixture, harness, NOW, seedDelegation } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const MAYA = "maya@vyre.test";
const SAM = "sam@vyre.test";
const members = [
  { userId: "usr_maya01", email: MAYA }, { userId: "usr_sam01", email: SAM }, { userId: "usr_kim01", email: "kim@vyre.test" }, { userId: "usr_out01", email: "ext@other.test" },
];

function admin(o: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness({ admin: true, members, ...o });
  ensure(h.ctx);
  h.on("GET", PROFILE, { body: { emailAddress: "admin@vyre.test", historyId: "1000" } });
  return h;
}
const setupInput = { vaultItem: "#Google_DWD", adminEmail: "Admin@Vyre.test", idempotencyKey: "setup-1" };
const check = (cap: string, out: unknown): void => assert.deepEqual(contractErrors(cap, "out", out), [], cap);

// ---- setup and the auto-connect notices

test("setup with auto-connect on connects every mapped member once and never an excluded or outside address", async () => {
  const h = admin();
  h.ctx.db.run(`INSERT INTO google_member (email, "userId", mapped, excluded, "mailboxState", updated_at) VALUES (?, ?, ?, ?, ?, ?)`, "kim@vyre.test", "usr_kim01", 1, 1, null, NOW);
  const out = await dwdSetup(h.ctx, setupInput);
  assert.deepEqual(out, { configured: true, scopes: SCOPES, mappedMembers: 2, connected: 2 });
  check("google.dwd.setup", out);

  const connect = h.calls("mail.auto_connect_members");
  assert.equal(connect.length, 1);   // one call; the mail module sends one notice per member in it
  assert.equal(connect[0]!.input.provider, "google");
  assert.deepEqual(connect[0]!.input.members, [{ userId: "usr_maya01", email: MAYA }, { userId: "usr_sam01", email: SAM }]);
  assert.equal(h.calls("connections.create").length, 1);
  assert.deepEqual(h.calls("connections.create")[0]!.input.secrets, { Google_DWD: "#Google_DWD" });

  const rows = Object.fromEntries(h.rows(`SELECT email, mapped, excluded, "mailboxState" FROM google_member`).map((r) => [r.email, r]));
  assert.deepEqual(Object.keys(rows).sort(), ["kim@vyre.test", MAYA, SAM]);
  assert.deepEqual([rows[MAYA]!.mailboxState, rows[SAM]!.mailboxState, rows["kim@vyre.test"]!.mailboxState, rows["kim@vyre.test"]!.excluded], ["pending", "pending", null, 1]);
  const cfg = h.rows(`SELECT * FROM google_config`)[0]!;
  assert.deepEqual([cfg.connectionId, cfg.adminEmail, cfg.domain, cfg.clientId, cfg.configured, cfg.autoConnect, cfg.lastProbeOk], [CONN, "admin@vyre.test", "vyre.test", "1234567890", 1, 1, 1]);
  assert.deepEqual(h.named("google.dwd_configured").map((e) => e.payload), [{ connector: "google", adminEmail: "admin@vyre.test", mappedMembers: 2, autoConnect: true }]);

  const again = await dwdSetup(h.ctx, { ...setupInput, idempotencyKey: "setup-2" });
  assert.equal(again.mappedMembers, 2);
  assert.equal(h.calls("connections.create").length, 1);   // the Space connection is kept
});

test("with auto-connect off nobody is connected until the first-run step", async () => {
  const h = admin({ autoConnect: false });
  const out = await dwdSetup(h.ctx, setupInput);
  assert.deepEqual([out.mappedMembers, out.connected], [3, 0]);
  assert.equal(h.calls("mail.auto_connect_members").length, 0);
  assert.deepEqual(h.rows(`SELECT "mailboxState" FROM google_member`).map((r) => r.mailboxState), [null, null, null]);
  assert.equal(h.rows(`SELECT "autoConnect" FROM google_config`)[0]?.autoConnect, 0);
  assert.equal((await dwdStatus(h.ctx)).autoConnect, false);
});

test("a delegation Google does not accept configures nothing and connects nobody", async () => {
  const h = admin();
  h.on("GET", PROFILE, { status: 403, body: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } } });
  await assert.rejects(() => dwdSetup(h.ctx, setupInput), (e) => codeOf(e) === "provider.auth_failed");
  assert.deepEqual(h.rows(`SELECT configured, "lastProbeOk" FROM google_config`), [{ configured: 0, lastProbeOk: 0 }]);
  assert.equal(h.rows(`SELECT email FROM google_member`).length, 0);
  assert.equal(h.calls("mail.auto_connect_members").length, 0);

  const refused = admin();
  refused.refuseScope(SCOPES[0]!);
  await assert.rejects(() => dwdSetup(refused.ctx, setupInput), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(refused.rows(`SELECT configured FROM google_config`)[0]?.configured, 0);
  assert.equal(refused.calls("mail.auto_connect_members").length, 0);
});

test("setup refuses a bad handle, address or domain and a Vault item that is not a service account", async () => {
  const h = admin();
  for (const patch of [{ vaultItem: "plain-secret" }, { adminEmail: "nope" }, { domain: "bad domain" }]) {
    await assert.rejects(() => dwdSetup(h.ctx, { ...setupInput, ...patch }), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(patch));
  }
  await assert.rejects(() => dwdSetup(h.ctx, { ...setupInput, vaultItem: "#NotAKey" }), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(h.rows(`SELECT id FROM google_config`).length, 0);
});

test("status and scopes tell the wizard what is set and what to paste into the Admin console", async () => {
  const h = admin();
  const before = await dwdStatus(h.ctx);
  assert.deepEqual(before, { configured: false, autoConnect: true, mappedMembers: 0, excluded: [] });
  await dwdSetup(h.ctx, setupInput);
  await dwdSetExcluded(h.ctx, { email: SAM, excluded: true });
  const after = await dwdStatus(h.ctx);
  assert.deepEqual(after, { configured: true, adminEmail: "admin@vyre.test", domain: "vyre.test", lastProbeAt: NOW, lastProbeOk: true, autoConnect: true, mappedMembers: 2, excluded: [SAM] });
  check("google.dwd.status", before);
  check("google.dwd.status", after);
  const scopes = await dwdScopes(h.ctx);
  assert.deepEqual(scopes.scopes, SCOPES);
  assert.equal(scopes.clientId, "1234567890");
  assert.match(scopes.adminConsoleUrl, /^https:\/\/admin\.google\.com\//);
  check("google.dwd.scopes", scopes);
  assert.equal((await dwdScopes(harness())).clientId, undefined);
});

test("a probe names the scopes the Admin console is missing and proves the profile when none are", async () => {
  const h = admin();
  await dwdSetup(h.ctx, setupInput);
  const ok = await dwdProbe(h.ctx, {});
  assert.deepEqual(ok, { ok: true, email: "admin@vyre.test", scopesMissing: [] });
  assert.deepEqual(h.named("google.dwd_probed").at(-1)?.payload, { connector: "google", ok: true, email: "admin@vyre.test", scopesMissing: [] });
  check("google.dwd.probe", ok);

  h.refuseScope(SCOPES[2]!);
  h.refuseScope(SCOPES[5]!);
  const before = h.hits(PROFILE).length;
  const bad = await dwdProbe(h.ctx, { as: SAM });
  assert.deepEqual([bad.ok, bad.scopesMissing, bad.email], [false, [SCOPES[2], SCOPES[5]], undefined]);
  assert.match(bad.detail ?? "", /Admin console/);
  assert.equal(h.hits(PROFILE).length, before);   // no mailbox was touched when the scopes are not there
  assert.equal(h.rows(`SELECT "lastProbeOk" FROM google_config`)[0]?.lastProbeOk, 0);
  check("google.dwd.probe", bad);

  await assert.rejects(() => dwdProbe(harness({ admin: true }).ctx, {}), (e) => codeOf(e) === "validation.precondition_failed");
});

test("members list in pages; an exclusion stops every call for that member; turning delegation off stops them all", async () => {
  const h = admin();
  await dwdSetup(h.ctx, setupInput);
  const page = await dwdMembers(h.ctx, { limit: 2 });
  assert.deepEqual(page.members.map((m) => m.email), ["kim@vyre.test", MAYA]);
  assert.equal(page.next, "2");
  assert.deepEqual((await dwdMembers(h.ctx, { limit: 2, cursor: page.next })).members.map((m) => m.email), [SAM]);
  assert.deepEqual(page.members[1], { email: MAYA, userId: "usr_maya01", mapped: true, excluded: false, mailboxState: "pending" });
  check("google.dwd.members", page);
  await assert.rejects(() => dwdMembers(h.ctx, { limit: 0 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => dwdMembers(h.ctx, { cursor: "x" }), (e) => codeOf(e) === "validation.bad_input");

  assert.deepEqual(await dwdSetExcluded(h.ctx, { email: "Sam@Vyre.test", excluded: true }), { excluded: [SAM] });
  await assert.rejects(() => getProfile(h.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");
  assert.deepEqual(await dwdSetExcluded(h.ctx, { email: SAM, excluded: false }), { excluded: [] });
  await getProfile(h.ctx, { ...act, as: SAM });
  assert.deepEqual(await dwdSetExcluded(h.ctx, { email: "new@vyre.test", excluded: true }), { excluded: ["new@vyre.test"] });   // an address not yet mapped can be excluded ahead of time
  await assert.rejects(() => dwdSetExcluded(h.ctx, { email: "nope", excluded: true }), (e) => codeOf(e) === "validation.bad_input");

  assert.deepEqual(await dwdDisable(h.ctx), { disabled: true });
  assert.deepEqual(h.named("google.dwd_revoked").map((e) => e.payload), [{ connector: "google", by: "usr_maya01" }]);
  assert.equal((await dwdStatus(h.ctx)).configured, false);
  assert.ok(h.rows(`SELECT "mailboxState" FROM google_member WHERE mapped = ?`, 1).every((r) => r.mailboxState === "paused"));
  await assert.rejects(() => getProfile(h.ctx, act), (e) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(contractErrors("google.dwd.disable", "out", { disabled: true }), []);
});

// ---- who a call acts as

test("a call acts as the caller's mapped address; another address needs an admin; a service may act for a mapped member", async () => {
  const h = harness({ members });
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01" }] });
  h.on("GET", PROFILE, { body: { emailAddress: MAYA, historyId: "1" } });
  await getProfile(h.ctx, act);
  assert.equal(h.minted.at(-1)?.sub, MAYA);
  await assert.rejects(() => getProfile(h.ctx, { ...act, as: SAM }), (e) => codeOf(e) === "permission.no_grant");

  const boss = harness({ admin: true });
  seedDelegation(boss, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01" }] });
  boss.on("GET", PROFILE, { body: { emailAddress: SAM, historyId: "1" } });
  await getProfile(boss.ctx, { ...act, as: "SAM@vyre.test" });
  assert.equal(boss.minted.at(-1)?.sub, SAM);
  await assert.rejects(() => getProfile(boss.ctx, { ...act, as: "stranger@vyre.test" }), (e) => codeOf(e) === "validation.precondition_failed");

  const svc = harness({ principal: { kind: "service", id: "svc_google" } });
  seedDelegation(svc, { members: [{ email: MAYA, userId: "usr_maya01" }] });
  svc.on("GET", PROFILE, { body: { emailAddress: MAYA, historyId: "1" } });
  await getProfile(svc.ctx, { ...act, as: MAYA });
  await assert.rejects(() => getProfile(svc.ctx, act), (e) => codeOf(e) === "validation.precondition_failed");   // a service with no member to act for

  const stranger = harness({ principal: { kind: "person", id: "usr_nobody" } });
  seedDelegation(stranger);
  await assert.rejects(() => getProfile(stranger.ctx, act), (e) => codeOf(e) === "validation.precondition_failed");

  const agent = harness({ principal: { kind: "agent", id: "agt_scout01" }, actingFor: "usr_maya01" });
  seedDelegation(agent);
  agent.on("GET", PROFILE, { body: { emailAddress: MAYA, historyId: "1" } });
  await getProfile(agent.ctx, act);   // an agent acts for the person it works for, and the log says who
  assert.deepEqual(agent.rows(`SELECT subject, actor FROM google_read_log`), [{ subject: MAYA, actor: "usr_maya01" }]);
});

test("a person's own calls are logged under that person; a second member's under theirs", async () => {
  const h = harness({ admin: true });
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01" }, { email: SAM, userId: "usr_sam01" }] });
  h.on("GET", PROFILE, { body: { emailAddress: MAYA, historyId: "1" } });
  await getProfile(h.ctx, act);
  await getProfile(h.ctx, { ...act, as: SAM });
  await getProfile(h.ctx, { ...act, as: SAM });
  const log = h.rows(`SELECT subject, actor, cap, bulk, at FROM google_read_log`);
  assert.deepEqual(log.map((r) => [r.subject, r.actor, r.cap]), [[MAYA, "usr_maya01", "google.gmail.get_profile"], [SAM, "usr_maya01", "google.gmail.get_profile"], [SAM, "usr_maya01", "google.gmail.get_profile"]]);
  assert.ok(log.every((r) => r.at === NOW && r.bulk === 0));
});

// ---- push and polling

function mapped(): Harness {
  const h = harness();
  seedDelegation(h);
  h.on("GET", PROFILE, { body: fixture("gmail/profile.json") });
  h.on("GET", /\/history\?/, { body: fixture("gmail/history-page2.json") });
  for (const [id, file] of Object.entries({ m1: "message-m1.json", m3: "message-m3.json", d1: "message-draft.json" })) h.on("GET", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?`, { body: fixture(`gmail/${file}`) });
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/att1", { body: fixture("gmail/attachment.json") });
  h.ctx.db.run(
    `INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    MAYA, CONN, "1000", null, null, null, null, null,
  );
  return h;
}
const push = (messageId: string) => ({ kind: "gmail" as const, messageId, mailbox: MAYA, historyId: "1500" });

test("a Gmail push is taken once, announced, pulled, and one future poll is queued at the active interval", async () => {
  const h = mapped();
  const first = await receivePush(h.ctx, push("pub-1"));
  assert.deepEqual(first, { accepted: true });
  check("google.receive_push", first);
  assert.deepEqual(h.named("google.push_received").map((e) => e.payload), [{ connector: "google", kind: "gmail", messageId: "pub-1", mailbox: MAYA, historyId: "1500" }]);
  assert.equal(h.ingests.length, 2);   // m1 and m3; the draft is left out
  assert.equal(h.scheduled.length, 1);
  assert.deepEqual(h.scheduled[0], { at: NOW + 2 * 60_000, cap: "google.receive_push", input: { kind: "gmail", messageId: `poll:${MAYA}:${NOW + 120_000}`, mailbox: MAYA } });

  assert.deepEqual(await receivePush(h.ctx, push("pub-1")), { accepted: false });   // a redelivery changes nothing
  assert.equal(h.ingests.length, 2);
  assert.equal(h.named("google.push_received").length, 1);

  await receivePush(h.ctx, push("pub-2"));   // a second notice before the queued poll: pulled, but no second chain of polls
  assert.equal(h.scheduled.length, 1);

  h.advance(2 * 60_000);   // the queued poll fires: it pulls and queues the next one
  await receivePush(h.ctx, h.scheduled[0]!.input as ReturnType<typeof push>);
  assert.equal(h.scheduled.length, 2);
  assert.equal(h.scheduled[1]!.at, NOW + 2 * 60_000 + 15 * 60_000);   // nothing new arrived this round: the mailbox is idle
});

test("a push for an excluded or unmapped member, or after delegation is off, pulls nothing and queues nothing", async () => {
  const h = mapped();
  await dwdSetExcluded(h.ctx, { email: MAYA, excluded: true });
  assert.deepEqual(await receivePush(h.ctx, push("p1")), { accepted: true });
  await receivePush(h.ctx, { ...push("p2"), mailbox: "stranger@vyre.test" });
  await dwdSetExcluded(h.ctx, { email: MAYA, excluded: false });
  await dwdDisable(h.ctx);
  await receivePush(h.ctx, push("p3"));
  assert.equal(h.requests.length, 0);
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.named("google.push_received").length, 3);
});

test("Calendar, Drive and Meet notices are recorded and start no mailbox pull", async () => {
  const h = mapped();
  for (const kind of ["calendar", "drive", "meet"] as const) await receivePush(h.ctx, { kind, messageId: `n-${kind}`, channelId: "ch1", resourceState: "exists", resourceId: "res1" });
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.named("google.push_received").map((e) => e.payload.kind), ["calendar", "drive", "meet"]);
  await assert.rejects(() => receivePush(h.ctx, { kind: "gmail", messageId: "" }), (e) => codeOf(e) === "validation.bad_input");
});

test("a failed pull is logged and retried later; the notice is still accepted", async () => {
  const h = mapped();
  h.on("GET", /\/history\?/, { status: 503, body: { error: { code: 503 } } });
  assert.deepEqual(await receivePush(h.ctx, push("pub-x")), { accepted: true });
  assert.equal(h.ingests.length, 0);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0]!.at, NOW + 15 * 60_000);
});

test("a Pub/Sub watch turns the poll into an hourly backstop", async () => {
  const h = mapped();
  h.on("POST", "https://gmail.googleapis.com/gmail/v1/users/me/watch", { body: { historyId: "1000", expiration: String(NOW + 7 * 86_400_000) } });
  await watch(h.ctx, { ...act, topicName: "projects/p/topics/gmail" });
  await receivePush(h.ctx, push("pub-w"));
  assert.equal(h.scheduled[0]!.at, NOW + 3_600_000);
});

// ---- health

test("health is healthy with a latency, degraded when Google struggles, down when the delegation is refused or not set up", async () => {
  const off = harness();
  assert.deepEqual(await health(off.ctx, {}), { state: "down", detail: "Google delegation is not set up." });
  const h = harness();
  seedDelegation(h);
  h.on("GET", PROFILE, { body: { emailAddress: "admin@vyre.test", historyId: "1" } });
  const ok = await health(h.ctx, {});
  assert.deepEqual(ok, { state: "healthy", latencyMs: 0 });
  check("google.health", ok);
  h.on("GET", PROFILE, { status: 503, body: {} });
  assert.equal((await health(h.ctx, {})).state, "degraded");
  h.on("GET", PROFILE, { status: 403, body: { error: { errors: [{ reason: "forbidden" }] } } });
  assert.equal((await health(h.ctx, {})).state, "down");
  h.on("GET", PROFILE, { throws: true });
  assert.equal((await health(h.ctx, {})).state, "degraded");
  h.refuseScope(SCOPES[0]!);
  h.advance(3_700_000);   // the cached token expired, so the next call mints again and is refused
  const down = await health(h.ctx, {});
  assert.equal(down.state, "down");
  assert.match(down.detail ?? "", /key and the scopes/);
});

// ---- Calendar

const CAL = "https://www.googleapis.com/calendar/v3";
const event = { id: "ev1", status: "confirmed", summary: "Intake", start: { dateTime: "2026-10-26T10:00:00Z" }, end: { dateTime: "2026-10-26T10:30:00Z" }, hangoutLink: "https://meet.google.com/abc",
  attendees: [{ email: MAYA, responseStatus: "needsAction", self: true }, { email: "pat@acme.test", optional: true }], organizer: { email: "pat@acme.test" }, updated: "2026-10-25T08:00:00Z" };

function ready(): Harness {
  const h = harness();
  seedDelegation(h);
  return h;
}

test("calendars and events: a full listing, an incremental one that sends only the sync token, and one event", async () => {
  const h = ready();
  h.on("GET", `${CAL}/users/me/calendarList`, { body: { items: [{ id: "primary", summary: "Maya", primary: true, backgroundColor: "#4f6bed", accessRole: "owner" }, { id: "team@vyre.test", summary: "Team" }] } });
  h.on("GET", /calendars\/primary\/events\?/, { body: { items: [event], nextSyncToken: "sync2" } });
  h.on("GET", `${CAL}/calendars/primary/events/ev1`, { body: event });
  const calendars = await calendarList(h.ctx, act);
  assert.deepEqual(calendars.calendars[0], { id: "primary", summary: "Maya", primary: true, backgroundColor: "#4f6bed", accessRole: "owner" });
  assert.deepEqual(calendars.calendars[1], { id: "team@vyre.test", summary: "Team" });
  const full = await eventsList(h.ctx, { ...act, calendarId: "primary", timeMin: "2026-10-01T00:00:00Z", q: "intake" });
  const u1 = new URL(h.hits(/events\?/)[0]!.url);
  assert.deepEqual([u1.searchParams.get("timeMin"), u1.searchParams.get("q"), u1.searchParams.get("singleEvents"), u1.searchParams.get("syncToken")], ["2026-10-01T00:00:00Z", "intake", "true", null]);
  assert.deepEqual([full.events.length, full.nextSyncToken], [1, "sync2"]);
  assert.deepEqual(full.events[0], { id: "ev1", status: "confirmed", summary: "Intake", start: event.start, end: event.end, hangoutLink: "https://meet.google.com/abc",
    attendees: [{ email: MAYA, responseStatus: "needsAction" }, { email: "pat@acme.test", optional: true }], organizer: { email: "pat@acme.test" }, updated: "2026-10-25T08:00:00Z" });
  await eventsList(h.ctx, { ...act, calendarId: "primary", syncToken: "sync1", timeMin: "ignored" });
  const u2 = new URL(h.hits(/events\?/)[1]!.url);
  assert.deepEqual([u2.searchParams.get("syncToken"), u2.searchParams.get("timeMin"), u2.searchParams.get("singleEvents")], ["sync1", null, null]);
  const one = await eventGet(h.ctx, { ...act, calendarId: "primary", eventId: "ev1" });
  for (const [cap, out] of [["google.calendar.list_calendars", calendars], ["google.calendar.list_events", full], ["google.calendar.get_event", one]] as const) check(cap, out);
});

test("an event is created with a Meet link and invitees, changed, answered and deleted", async () => {
  const h = ready();
  h.on("POST", `${CAL}/calendars/primary/events`, { body: event });
  h.on("PATCH", `${CAL}/calendars/primary/events/ev1`, (r) => ((r.body as { attendees?: unknown }).attendees ? { body: event } : { body: { ...event, summary: "Moved" } }));
  h.on("GET", `${CAL}/calendars/primary/events/ev1`, { body: event });
  h.on("DELETE", `${CAL}/calendars/primary/events/ev1`, { status: 204 });
  const created = await eventCreate(h.ctx, {
    ...act, calendarId: "primary", summary: "Intake", start: event.start, end: event.end, conference: true, attendees: [{ email: "Pat@Acme.test", optional: true }, { email: "kim@acme.test" }],
  });
  const post = h.hits(`${CAL}/calendars/primary/events`, "POST")[0]!;
  const pu = new URL(post.url);
  assert.deepEqual([pu.searchParams.get("sendUpdates"), pu.searchParams.get("conferenceDataVersion")], ["all", "1"]);
  const body = post.body as Record<string, unknown>;
  assert.deepEqual(body.attendees, [{ email: "pat@acme.test", optional: true }, { email: "kim@acme.test" }]);
  assert.equal((body.conferenceData as { createRequest: { conferenceSolutionKey: { type: string } } }).createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.match(String((body.conferenceData as { createRequest: { requestId: string } }).createRequest.requestId), /^cnf_[a-z0-9]+$/);
  check("google.calendar.create_event", created);

  const moved = await eventUpdate(h.ctx, { ...act, calendarId: "primary", eventId: "ev1", summary: "Moved", sendUpdates: "none" });
  assert.equal(new URL(h.hits(`${CAL}/calendars/primary/events/ev1`, "PATCH")[0]!.url).searchParams.get("sendUpdates"), "none");
  assert.deepEqual(h.hits(`${CAL}/calendars/primary/events/ev1`, "PATCH")[0]!.body, { summary: "Moved" });
  check("google.calendar.update_event", moved);

  const answered = await eventRespond(h.ctx, { ...act, calendarId: "primary", eventId: "ev1", response: "accepted" });
  const patch = h.hits(`${CAL}/calendars/primary/events/ev1`, "PATCH")[1]!.body as { attendees: { email: string; responseStatus: string }[] };
  assert.deepEqual(patch.attendees.map((a) => [a.email, a.responseStatus]), [[MAYA, "accepted"], ["pat@acme.test", undefined]]);
  check("google.calendar.respond", answered);
  h.on("GET", `${CAL}/calendars/primary/events/ev1`, { body: { ...event, attendees: [{ email: "pat@acme.test" }] } });
  await assert.rejects(() => eventRespond(h.ctx, { ...act, calendarId: "primary", eventId: "ev1", response: "declined" }), (e) => codeOf(e) === "validation.precondition_failed");

  assert.deepEqual(await eventDelete(h.ctx, { ...act, calendarId: "primary", eventId: "ev1" }), { deleted: true });
  await assert.rejects(() => eventCreate(h.ctx, { ...act, calendarId: "primary", attendees: [{ email: "nope" }] }), (e) => codeOf(e) === "validation.bad_input");
});

test("free/busy is flattened per person and channels are opened and closed", async () => {
  const h = ready();
  h.on("POST", `${CAL}/freeBusy`, { body: { calendars: { [MAYA]: { busy: [{ start: "a", end: "b" }, { start: "c", end: "d" }] }, [SAM]: { busy: [] } } } });
  h.on("POST", `${CAL}/calendars/primary/events/watch`, { body: { resourceId: "res1", expiration: "1761000000000" } });
  h.on("POST", `${CAL}/channels/stop`, { status: 204 });
  const busy = await freeBusy(h.ctx, { ...act, emails: [MAYA, SAM], timeMin: "2026-10-26T00:00:00Z", timeMax: "2026-10-27T00:00:00Z" });
  assert.deepEqual(busy.busy, [{ email: MAYA, start: "a", end: "b" }, { email: MAYA, start: "c", end: "d" }]);
  assert.deepEqual(h.hits(`${CAL}/freeBusy`)[0]!.body, { timeMin: "2026-10-26T00:00:00Z", timeMax: "2026-10-27T00:00:00Z", items: [{ id: MAYA }, { id: SAM }] });
  const w = await calendarWatch(h.ctx, { ...act, calendarId: "primary", channelId: "ch1", address: "https://hooks.vyre.test/hooks/google" });
  assert.deepEqual(w, { resourceId: "res1", expiration: 1_761_000_000_000 });
  assert.deepEqual(h.hits(`${CAL}/calendars/primary/events/watch`)[0]!.body, { id: "ch1", type: "web_hook", address: "https://hooks.vyre.test/hooks/google" });
  assert.deepEqual(await calendarStopWatch(h.ctx, { ...act, channelId: "ch1", resourceId: "res1" }), { stopped: true });
  check("google.calendar.free_busy", busy);
  check("google.calendar.watch", w);
  await assert.rejects(() => freeBusy(h.ctx, { ...act, emails: ["nope"], timeMin: "a", timeMax: "b" }), (e) => codeOf(e) === "validation.bad_input");
});

// ---- Drive

const DRIVE = "https://www.googleapis.com/drive/v3";
const file = { id: "f1", name: "Intake.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", parents: ["root1"], modifiedTime: "2026-10-25T08:00:00Z", size: "2048", webViewLink: "https://drive.google.com/f1", driveId: "d1" };

test("Drive listings compose the query, include shared drives and map each file", async () => {
  const h = ready();
  h.on("GET", /drive\/v3\/files\?/, { body: { files: [file, { id: "f2", name: "Folder", mimeType: "application/vnd.google-apps.folder" }], nextPageToken: "pg2" } });
  h.on("GET", `${DRIVE}/files/f1`, { body: file });
  h.on("GET", `${DRIVE}/files/f1/permissions`, { body: { permissions: [{ id: "p1", role: "writer", type: "user", emailAddress: MAYA }, { id: "p2", role: "reader", type: "anyone" }] } });
  const list = await driveList(h.ctx, { ...act, q: "name contains 'Intake'", parentId: "it's", driveId: "d1", pageSize: 50 });
  const u = new URL(h.hits(/drive\/v3\/files\?/)[0]!.url);
  assert.equal(u.searchParams.get("q"), "name contains 'Intake' and 'it\\'s' in parents and trashed = false");
  assert.deepEqual([u.searchParams.get("corpora"), u.searchParams.get("driveId"), u.searchParams.get("supportsAllDrives"), u.searchParams.get("includeItemsFromAllDrives"), u.searchParams.get("pageSize")], ["drive", "d1", "true", "true", "50"]);
  assert.deepEqual(list.files[0], { id: "f1", name: "Intake.docx", mimeType: file.mimeType, parents: ["root1"], modifiedTime: file.modifiedTime, size: 2048, webViewLink: file.webViewLink, driveId: "d1" });
  assert.deepEqual(list.files[1], { id: "f2", name: "Folder", mimeType: "application/vnd.google-apps.folder" });
  assert.equal(list.nextPageToken, "pg2");
  await driveList(h.ctx, { ...act, q: "trashed = true" });
  assert.equal(new URL(h.hits(/drive\/v3\/files\?/)[1]!.url).searchParams.get("q"), "trashed = true");
  const got = await driveGet(h.ctx, { ...act, fileId: "f1" });
  const perms = await drivePermissions(h.ctx, { ...act, fileId: "f1" });
  assert.deepEqual(perms.permissions, [{ id: "p1", role: "writer", type: "user", emailAddress: MAYA }, { id: "p2", role: "reader", type: "anyone" }]);
  for (const [cap, out] of [["google.drive.list_files", list], ["google.drive.get_file", got], ["google.drive.get_permissions", perms]] as const) check(cap, out);
});

test("downloads, exports and uploads go through the host with a token for the member, never raw bytes in the handler", async () => {
  const h = ready();
  const dl = await driveDownload(h.ctx, { ...act, fileId: "f1" });
  const ex = await driveExport(h.ctx, { ...act, fileId: "f1", mimeType: "application/pdf" });
  h.on("POST", /upload\/drive/, { body: file });
  const up = await driveUpload(h.ctx, { ...act, name: "Contract.pdf", parentId: "root1", fileId: "fil_contract" });
  assert.deepEqual(dl, { blobId: "blb_download", size: 42, mimeType: "application/pdf" });
  assert.deepEqual(ex, { blobId: "blb_download", size: 42 });
  assert.equal(up.file.name, "Contract.pdf");
  assert.equal(h.requests.length, 0);   // ctx.http carries only JSON; the transfers belong to the host
  assert.deepEqual(h.minted.map((m) => m.scopes[0]), Array(3).fill("https://www.googleapis.com/auth/drive"));
  assert.deepEqual(h.rows(`SELECT cap FROM google_read_log`).map((r) => r.cap), ["google.drive.download_file", "google.drive.export_file", "google.drive.upload_file"]);
  for (const [cap, out] of [["google.drive.download_file", dl], ["google.drive.export_file", ex], ["google.drive.upload_file", up]] as const) check(cap, out);
});

test("folders, copies, shares and trash change Drive as asked", async () => {
  const h = ready();
  h.on("POST", `${DRIVE}/files?`, { body: { id: "fo1", name: "Matters", mimeType: "application/vnd.google-apps.folder" } });
  h.on("POST", `${DRIVE}/files/f1/copy`, { body: { ...file, id: "f9", name: "Copy of Intake" } });
  h.on("POST", `${DRIVE}/files/f1/permissions`, { body: { id: "np" } });
  h.on("PATCH", `${DRIVE}/files/f1`, { body: file });
  const folder = await driveCreateFolder(h.ctx, { ...act, name: "Matters", parentId: "root1" });
  assert.deepEqual(h.hits(`${DRIVE}/files?`, "POST")[0]!.body, { name: "Matters", mimeType: "application/vnd.google-apps.folder", parents: ["root1"] });
  const copy = await driveCopy(h.ctx, { ...act, fileId: "f1", name: "Copy of Intake" });
  assert.deepEqual(h.hits(`${DRIVE}/files/f1/copy`)[0]!.body, { name: "Copy of Intake" });
  assert.equal(copy.file.id, "f9");
  assert.deepEqual(await driveShare(h.ctx, { ...act, fileId: "f1", emails: ["Pat@Acme.test", "kim@acme.test"], role: "reader", notify: false }), { shared: true });
  const shares = h.hits(`${DRIVE}/files/f1/permissions`, "POST");
  assert.deepEqual(shares.map((s) => s.body), [{ type: "user", role: "reader", emailAddress: "pat@acme.test" }, { type: "user", role: "reader", emailAddress: "kim@acme.test" }]);
  assert.ok(shares.every((s) => new URL(s.url).searchParams.get("sendNotificationEmail") === "false"));
  assert.deepEqual(await driveTrash(h.ctx, { ...act, fileId: "f1" }), { trashed: true });
  assert.deepEqual(h.hits(`${DRIVE}/files/f1`, "PATCH")[0]!.body, { trashed: true });
  await assert.rejects(() => driveShare(h.ctx, { ...act, fileId: "f1", emails: ["nope"], role: "reader" }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.hits(`${DRIVE}/files/f1/permissions`, "POST").length, 2);   // the bad address stopped the share before anything was sent
  check("google.drive.create_folder", folder);
  check("google.drive.copy_file", copy);
});

test("Drive changes, watches and channel stops", async () => {
  const h = ready();
  h.on("GET", `${DRIVE}/changes?`, { body: { changes: [{ fileId: "f1", removed: false, file }, { fileId: "f3", removed: true }], newStartPageToken: "t9" } });
  h.on("POST", `${DRIVE}/changes/watch`, { body: { resourceId: "res2", expiration: "1761000000000" } });
  h.on("POST", `${DRIVE}/channels/stop`, { status: 204 });
  const changes = await driveChanges(h.ctx, { ...act, pageToken: "t1", driveId: "d1" });
  assert.deepEqual(changes.changes.map((c) => [c.fileId, c.removed, "file" in c]), [["f1", false, true], ["f3", true, false]]);
  assert.equal(changes.newStartPageToken, "t9");
  const w = await driveWatch(h.ctx, { ...act, pageToken: "t9", channelId: "ch2", address: "https://hooks.vyre.test/hooks/google", driveId: "d1" });
  assert.deepEqual(w, { resourceId: "res2", expiration: 1_761_000_000_000 });
  assert.deepEqual(await driveStopWatch(h.ctx, { ...act, channelId: "ch2", resourceId: "res2" }), { stopped: true });
  check("google.drive.list_changes", changes);
  check("google.drive.watch_changes", w);
});

// ---- Sheets and Docs

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DOCS = "https://docs.googleapis.com/v1/documents";

test("spreadsheets: metadata, values as strings, writes with the right input option, appends, creation into a folder, structure changes", async () => {
  const h = ready();
  h.on("GET", `${SHEETS}/s1?`, { body: { properties: { title: "Pipeline" }, sheets: [{ properties: { sheetId: 0, title: "Leads", gridProperties: { rowCount: 100, columnCount: 8 } } }, { properties: { sheetId: 7, title: "Notes" } }] } });
  h.on("GET", `${SHEETS}/s1/values/`, { body: { values: [["a", 2, true], []] } });
  h.on("PUT", `${SHEETS}/s1/values/`, { body: { updatedCells: 6 } });
  h.on("POST", `${SHEETS}/s1/values/Leads!A1:append`, { body: { updates: { updatedRows: 2 } } });
  h.on("POST", `${SHEETS}/s1:batchUpdate`, { body: { replies: [{}, {}] } });
  h.on("POST", `${SHEETS}`, { body: { spreadsheetId: "s2" } });
  h.on("GET", `${DRIVE}/files/s2`, { body: { parents: ["myroot"] } });
  h.on("PATCH", `${DRIVE}/files/s2`, { body: {} });
  const meta = await sheetGet(h.ctx, { ...act, spreadsheetId: "s1" });
  assert.deepEqual(meta, { title: "Pipeline", sheets: [{ sheetId: 0, title: "Leads", rows: 100, columns: 8 }, { sheetId: 7, title: "Notes" }] });
  const values = await sheetValues(h.ctx, { ...act, spreadsheetId: "s1", range: "Leads!A1:C2" });
  assert.deepEqual(values.values, [["a", "2", "true"], []]);
  assert.ok(h.hits(`${SHEETS}/s1/values/`)[0]!.url.includes("Leads!A1%3AC2"));
  const upd = await sheetUpdate(h.ctx, { ...act, spreadsheetId: "s1", range: "Leads!A1", values: [["x"]] });
  assert.equal(new URL(h.hits(`${SHEETS}/s1/values/`, "PUT")[0]!.url).searchParams.get("valueInputOption"), "USER_ENTERED");
  assert.deepEqual(h.hits(`${SHEETS}/s1/values/`, "PUT")[0]!.body, { range: "Leads!A1", majorDimension: "ROWS", values: [["x"]] });
  assert.equal(upd.updatedCells, 6);
  const app = await sheetAppend(h.ctx, { ...act, spreadsheetId: "s1", range: "Leads!A1", values: [["a"], ["b"]] });
  assert.equal(app.updatedRows, 2);
  const batch = await sheetBatch(h.ctx, { ...act, spreadsheetId: "s1", requests: [{ addSheet: {} }, { updateSheetProperties: {} }] });
  assert.equal(batch.applied, 2);
  const created = await sheetCreate(h.ctx, { ...act, title: "New", parentId: "folder1" });
  assert.deepEqual(created, { spreadsheetId: "s2", url: "https://docs.google.com/spreadsheets/d/s2/edit" });
  const moved = new URL(h.hits(`${DRIVE}/files/s2`, "PATCH")[0]!.url);
  assert.deepEqual([moved.searchParams.get("addParents"), moved.searchParams.get("removeParents")], ["folder1", "myroot"]);
  for (const [cap, out] of [["google.sheets.get_spreadsheet", meta], ["google.sheets.get_values", values], ["google.sheets.update_values", upd], ["google.sheets.append_values", app], ["google.sheets.batch_update", batch], ["google.sheets.create_spreadsheet", created]] as const) check(cap, out);
});

test("documents: read, create (in a folder), and edit with a request list", async () => {
  const h = ready();
  h.on("GET", `${DOCS}/d1`, { body: { title: "Engagement letter", body: { content: [{ paragraph: {} }] } } });
  h.on("POST", `${DOCS}/d1:batchUpdate`, { body: { replies: [{}] } });
  h.on("POST", DOCS, { body: { documentId: "d2" } });
  h.on("GET", `${DRIVE}/files/d2`, { body: {} });
  h.on("PATCH", `${DRIVE}/files/d2`, { body: {} });
  const doc = await docGet(h.ctx, { ...act, documentId: "d1" });
  assert.deepEqual(doc, { title: "Engagement letter", body: { content: [{ paragraph: {} }] } });
  const made = await docCreate(h.ctx, { ...act, title: "Letter", parentId: "folder1" });
  assert.deepEqual(made, { documentId: "d2", url: "https://docs.google.com/document/d/d2/edit" });
  assert.equal(new URL(h.hits(`${DRIVE}/files/d2`, "PATCH")[0]!.url).searchParams.get("removeParents"), null);
  const batch = await docBatch(h.ctx, { ...act, documentId: "d1", requests: [{ insertText: {} }] });
  assert.equal(batch.applied, 1);
  for (const [cap, out] of [["google.docs.get_document", doc], ["google.docs.create_document", made], ["google.docs.batch_update", batch]] as const) check(cap, out);
});

// ---- Meet

const MEET = "https://meet.googleapis.com/v2";

test("Meet: records in a time range, recordings, transcripts and entries; names are checked before they reach a URL", async () => {
  const h = ready();
  h.on("GET", `${MEET}/conferenceRecords?`, { body: { conferenceRecords: [{ name: "conferenceRecords/c1", startTime: "2026-10-25T09:00:00Z", endTime: "2026-10-25T09:30:00Z", space: "spaces/s1" }, { name: "conferenceRecords/c2", startTime: "2026-10-25T10:00:00Z" }], nextPageToken: "n2" } });
  h.on("GET", `${MEET}/conferenceRecords/c1/recordings`, { body: { recordings: [{ name: "conferenceRecords/c1/recordings/r1", state: "FILE_GENERATED", driveDestination: { file: "files/drv1" } }, { name: "conferenceRecords/c1/recordings/r2", state: "STARTED" }] } });
  h.on("GET", `${MEET}/conferenceRecords/c1/transcripts`, { body: { transcripts: [{ name: "conferenceRecords/c1/transcripts/t1", state: "FILE_GENERATED", docsDestination: { document: "doc1" } }] } });
  h.on("GET", `${MEET}/conferenceRecords/c1/transcripts/t1/entries`, { body: { transcriptEntries: [{ participant: "conferenceRecords/c1/participants/p1", text: "Hello", startTime: "2026-10-25T09:01:00Z" }, { text: "Bye" }], nextPageToken: "e2" } });
  const records = await meetRecords(h.ctx, { ...act, from: "2026-10-25T00:00:00Z", to: "2026-10-26T00:00:00Z" });
  assert.equal(new URL(h.hits(`${MEET}/conferenceRecords?`)[0]!.url).searchParams.get("filter"), 'start_time>="2026-10-25T00:00:00Z" AND start_time<="2026-10-26T00:00:00Z"');
  assert.deepEqual(records.records[0], { name: "conferenceRecords/c1", startTime: "2026-10-25T09:00:00Z", endTime: "2026-10-25T09:30:00Z", space: "spaces/s1" });
  assert.deepEqual(records.records[1], { name: "conferenceRecords/c2", startTime: "2026-10-25T10:00:00Z" });
  const recs = await meetRecordings(h.ctx, { ...act, conferenceRecord: "conferenceRecords/c1" });
  assert.deepEqual(recs.recordings, [{ name: "conferenceRecords/c1/recordings/r1", state: "FILE_GENERATED", driveFileId: "drv1" }, { name: "conferenceRecords/c1/recordings/r2", state: "STARTED" }]);
  const trs = await meetTranscripts(h.ctx, { ...act, conferenceRecord: "conferenceRecords/c1" });
  assert.deepEqual(trs.transcripts, [{ name: "conferenceRecords/c1/transcripts/t1", state: "FILE_GENERATED", docsDocumentId: "doc1" }]);
  const entries = await meetEntries(h.ctx, { ...act, transcript: "conferenceRecords/c1/transcripts/t1" });
  assert.deepEqual(entries.entries, [{ participant: "conferenceRecords/c1/participants/p1", text: "Hello", startTime: "2026-10-25T09:01:00Z" }, { text: "Bye" }]);
  assert.equal(entries.nextPageToken, "e2");
  for (const [cap, out] of [["google.meet.list_conference_records", records], ["google.meet.list_recordings", recs], ["google.meet.list_transcripts", trs], ["google.meet.get_transcript_entries", entries]] as const) check(cap, out);
  const before = h.requests.length;
  await assert.rejects(() => meetRecordings(h.ctx, { ...act, conferenceRecord: "conferenceRecords/../admin" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => meetEntries(h.ctx, { ...act, transcript: "conferenceRecords/c1" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => meetRecords(h.ctx, { ...act, from: '2026" OR 1=1' }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.requests.length, before);
});

test("a Meet subscription needs the Pub/Sub topic from Gmail push", async () => {
  const h = ready();
  h.on("POST", "https://workspaceevents.googleapis.com/v1/subscriptions", { body: { name: "operations/op1", response: { name: "subscriptions/sub1", expireTime: "2026-10-26T00:00:00Z" } } });
  await assert.rejects(() => meetSubscribe(h.ctx, { ...act, target: "//meet.googleapis.com/spaces/s1", eventTypes: ["google.workspace.meet.recording.v2.fileGenerated"] }), (e) => codeOf(e) === "validation.precondition_failed");
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, MAYA, CONN, null, null, null, null, "projects/p/topics/gmail", null);
  const sub = await meetSubscribe(h.ctx, { ...act, target: "//meet.googleapis.com/spaces/s1", eventTypes: ["google.workspace.meet.recording.v2.fileGenerated"] });
  assert.deepEqual(sub, { subscription: "subscriptions/sub1", expiration: Date.parse("2026-10-26T00:00:00Z") });
  assert.deepEqual((h.hits("https://workspaceevents.googleapis.com/v1/subscriptions")[0]!.body as { notificationEndpoint: unknown }).notificationEndpoint, { pubsubTopic: "projects/p/topics/gmail" });
  check("google.meet.subscribe", sub);
});

// ---- the module

test("the handler map covers exactly the capabilities the google manifest declares", () => {
  const declared = registry.capabilities.filter((c) => c.module === "google").map((c) => c.name).sort();
  assert.deepEqual(Object.keys(handlers).sort(), declared);
  assert.equal(declared.length, 59);
});
