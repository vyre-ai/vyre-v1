// Teams transcripts into Meetings: an ended Teams meeting on a member's calendar, organized by a mapped and included member and with a transcript, lands as a Meeting on its join link and
// hands over the transcript with its speakers; one with no transcript yet is looked at again; an excluded or outside organizer's meeting is never read; Graph is asked at most every ten minutes.
import test from "node:test";
import assert from "node:assert/strict";
import { onlineMeetingId, pullTeams, speakers, TEAMS_EVERY_MS } from "../handlers/teams.ts";
import { receiveNotification } from "../handlers/index.ts";
import { ensure } from "../projections.ts";
import { CONN, harness, NOW, seedConsent } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const SAM = "sam@vyre.test";
const G = "https://graph.microsoft.com/v1.0";
const OID = "11111111-2222-3333-4444-555555555555";
const THREAD = "19:meeting_ZWQ0NzY1M2MtMDAx@thread.v2";
const JOIN = `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(THREAD)}/0?context=${encodeURIComponent(JSON.stringify({ Tid: "t", Oid: OID }))}`;
const MID = Buffer.from(`1*${OID}*0**${THREAD}`).toString("base64");
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Maya Rivera>Thanks for joining.</v>\n\n00:00:04.500 --> 00:00:07.000\n<v Guest Priya>Happy to be here.</v>\n";

const stamp = (ms: number): string => new Date(ms).toISOString().replace("Z", "0000");
const event = (o: Record<string, unknown> = {}) => ({
  id: "ev1", subject: "Intake call", isCancelled: false, start: { dateTime: stamp(NOW - 3_600_000), timeZone: "UTC" }, end: { dateTime: stamp(NOW - 1_800_000), timeZone: "UTC" },
  organizer: { emailAddress: { address: MAYA, name: "Maya Rivera" } }, attendees: [{ emailAddress: { address: SAM, name: "Sam" } }, { emailAddress: { address: "client@other.test", name: "Client" } }],
  onlineMeeting: { joinUrl: JOIN }, ...o,
});

function world(o: { events?: unknown[]; transcripts?: unknown[]; excluded?: string[] } = {}): Harness {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedConsent(h, { members: [{ email: MAYA, userId: "usr_maya01", ...(o.excluded?.includes(MAYA) ? { excluded: true } : {}) }, { email: SAM, userId: "usr_sam01", ...(o.excluded?.includes(SAM) ? { excluded: true } : {}) }] });
  h.on("GET", `${G}/users/${encodeURIComponent(SAM)}/calendar/calendarView`, { body: { value: o.events ?? [event()] } });
  h.on("GET", `${G}/users/${encodeURIComponent(MAYA)}/calendar/calendarView`, { body: { value: o.events ?? [event()] } });
  h.on("GET", `${G}/users/${encodeURIComponent(MAYA)}/onlineMeetings/${encodeURIComponent(MID)}/transcripts`, { body: { value: o.transcripts ?? [{ id: "tr1", createdDateTime: "2026-10-29T10:00:00Z" }] } });
  h.on("GET", `${G}/users/${encodeURIComponent(MAYA)}/onlineMeetings/${encodeURIComponent(MID)}/transcripts/tr1/content`, { body: VTT });
  return h;
}

test("the online meeting id is read from the join link, and only a Teams meeting-join link has one", () => {
  assert.deepEqual(onlineMeetingId(JOIN), { id: MID, organizerOid: OID });
  for (const bad of ["", "not a url", "https://example.com/l/meetup-join/x/0", `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent("19:notmeeting@thread.v2")}/0?context={}`, JOIN.replace("http", "ftp"), `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(THREAD)}/0`]) {
    assert.equal(onlineMeetingId(bad), null, bad);
  }
});

test("Teams speaker tags become 'Name: words'", () => {
  assert.equal(speakers("<v Maya Rivera>Hello: there</v>"), "Maya Rivera: Hello: there");
  assert.equal(speakers("plain"), "plain");
});

test("an ended meeting with a transcript lands as a Meeting on its join link and hands over the transcript with speakers", async () => {
  const h = world();
  const out = await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM });
  assert.deepEqual(out, { meetings: 1, attached: 1, waiting: 0 });
  const ingest = h.calls("meetings.ingest");
  assert.equal(ingest.length, 1);
  assert.deepEqual(ingest[0]!.input, {
    source: "teams", providerRef: MID, title: "Intake call", startsAt: NOW - 3_600_000, endsAt: NOW - 1_800_000, joinUrl: JOIN,
    attendees: [{ email: SAM, name: "Sam" }, { email: "client@other.test", name: "Client" }],
  });
  const attach = h.calls("meetings.attach_recording");
  assert.equal(attach.length, 1);
  assert.equal(attach[0]!.input.meetingId, "rec_team00001");
  assert.equal(attach[0]!.input.source, "teams");
  assert.match(String(attach[0]!.input.transcriptText), /^WEBVTT\n\n00:00:01\.000 --> 00:00:04\.000\nMaya Rivera: Thanks for joining\./);
  assert.match(String(attach[0]!.input.transcriptText), /Guest Priya: Happy to be here\./);
  assert.deepEqual(h.rows(`SELECT key, "meetingId" FROM microsoft_teams_seen`), [{ key: `${MID}:tr1`, meetingId: "rec_team00001" }]);
  // the transcript was read as the organizer, never as the attendee whose calendar showed it
  assert.ok(h.requests.some((r) => r.url.includes(`/users/${encodeURIComponent(MAYA)}/onlineMeetings/`)));
  assert.ok(!h.requests.some((r) => r.url.includes(`/users/${encodeURIComponent(SAM)}/onlineMeetings/`)));
});

test("Graph is asked at most every ten minutes and a transcript already handed over is not handed over again", async () => {
  const h = world();
  await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM });
  const before = h.requests.length;
  assert.deepEqual(await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM }), { meetings: 0, attached: 0, waiting: 0 });
  assert.equal(h.requests.length, before);
  h.advance(TEAMS_EVERY_MS + 1);
  const again = await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM });
  assert.deepEqual(again, { meetings: 1, attached: 1, waiting: 0 });   // done: nothing waits
  assert.equal(h.calls("meetings.attach_recording").length, 1);
});

test("a meeting with no transcript yet is looked at again, and one still running is not looked at", async () => {
  const h = world({ transcripts: [], events: [event(), event({ id: "ev2", end: { dateTime: stamp(NOW + 600_000), timeZone: "UTC" } }), event({ id: "ev3", isCancelled: true }), event({ id: "ev4", onlineMeeting: { joinUrl: "https://meet.example.com/x" } })] });
  assert.deepEqual(await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM }), { meetings: 1, attached: 0, waiting: 1 });
  assert.equal(h.calls("meetings.ingest").length, 0);
});

test("a meeting organized by an excluded member, or by someone outside, is never read", async () => {
  const h = world({ excluded: [MAYA] });
  assert.deepEqual(await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM }), { meetings: 0, attached: 0, waiting: 0 });
  assert.ok(!h.requests.some((r) => r.url.includes("/onlineMeetings/")));
  const outside = world({ events: [event({ organizer: { emailAddress: { address: "client@other.test" } } })] });
  assert.deepEqual(await pullTeams(outside.ctx, { connectionId: CONN, mailbox: SAM }), { meetings: 0, attached: 0, waiting: 0 });
  assert.ok(!outside.requests.some((r) => r.url.includes("/onlineMeetings/")));
});

test("a refusal for the organizer's online meeting leaves the meeting waiting instead of failing", async () => {
  const h = world();
  h.on("GET", `${G}/users/${encodeURIComponent(MAYA)}/onlineMeetings/${encodeURIComponent(MID)}/transcripts`, { status: 403, body: { error: { code: "Forbidden" } } });
  assert.deepEqual(await pullTeams(h.ctx, { connectionId: CONN, mailbox: SAM }), { meetings: 1, attached: 0, waiting: 1 });
});

test("a notice for a member also looks at their Teams meetings, and a Teams failure never fails the notice", async () => {
  const h = world();
  h.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "sub1", "mail", `users/${SAM}/messages`, SAM, CONN, "https://x.test/hooks/microsoft", "cs", NOW + 3_600_000, 4230, "created");
  h.on("GET", `${G}/users/${encodeURIComponent(SAM)}/mailFolders/inbox/messages/delta`, { body: { value: [], "@odata.deltaLink": `${G}/delta?token=a` } });
  h.on("GET", `${G}/users/${encodeURIComponent(SAM)}/mailFolders/sentitems/messages/delta`, { body: { value: [], "@odata.deltaLink": `${G}/delta?token=b` } });
  const r = await receiveNotification(h.ctx, { notificationId: "n1", subscriptionId: "sub1", resource: `users/${SAM}/messages/A`, changeType: "created", clientStateOk: true });
  assert.deepEqual(r, { accepted: true });
  assert.equal(h.calls("meetings.attach_recording").length, 1);
});
