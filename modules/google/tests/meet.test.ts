// Meet transcripts into Meetings: a conference that has a transcript is landed through meetings.ingest on its Meet join link and its transcript is handed to
// meetings.attach_recording as WebVTT with speakers and times; one that has none yet is looked at again; nothing is asked of Meet more than every ten minutes; an excluded member's
// conferences are never looked at.
import test from "node:test";
import assert from "node:assert/strict";
import { cueTime, pullMeet, toVtt } from "../handlers/index.ts";
import { receivePush } from "../handlers/index.ts";
import { MEET_EVERY_MS } from "../handlers/meet.ts";
import { ensure } from "../projections.ts";
import { CONN, harness, NOW, seedDelegation } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const M = "https://meet.googleapis.com/v2";
const REC = "conferenceRecords/c1";
const START = NOW - 3_600_000;
const END = NOW - 1_800_000;

function world(o: { transcript?: boolean; excluded?: boolean } = {}): Harness {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01", ...(o.excluded ? { excluded: true } : {}) }] });
  h.on("GET", `${M}/conferenceRecords?`, { body: { conferenceRecords: [{ name: REC, startTime: new Date(START).toISOString(), endTime: new Date(END).toISOString(), space: "spaces/s1" }, { name: "conferenceRecords/live", startTime: new Date(NOW - 60_000).toISOString(), space: "spaces/s2" }] } });
  h.on("GET", `${M}/spaces/s1`, { body: { name: "spaces/s1", meetingUri: "https://meet.google.com/abc-defg-hij", meetingCode: "abc-defg-hij" } });
  h.on("GET", `${M}/${REC}/transcripts`, { body: { transcripts: o.transcript === false ? [] : [{ name: `${REC}/transcripts/t1`, state: "ENDED" }] } });
  h.on("GET", `${M}/${REC}/participants`, { body: { participants: [{ name: `${REC}/participants/p1`, signedinUser: { user: "users/1", displayName: "Maya Rivera" } }, { name: `${REC}/participants/p2`, anonymousUser: { displayName: "Guest: Priya" } }] } });
  h.on("GET", `${M}/${REC}/transcripts/t1/entries`, {
    body: { transcriptEntries: [
      { text: "Thanks for joining.", participant: `${REC}/participants/p1`, startTime: new Date(START + 1000).toISOString() },
      { text: "Happy to be here.", participant: `${REC}/participants/p2`, startTime: new Date(START + 5500).toISOString() },
      { text: "   ", participant: `${REC}/participants/p1`, startTime: new Date(START + 7000).toISOString() },
    ] },
  });
  return h;
}

test("a conference with a transcript lands as a Meeting on its join link and hands over WebVTT with speakers and times", async () => {
  const h = world();
  const out = await pullMeet(h.ctx, { connectionId: CONN, mailbox: MAYA });
  assert.deepEqual(out, { records: 1, attached: 1, waiting: 0 });   // the conference still running is not counted
  const ingest = h.calls("meetings.ingest");
  assert.equal(ingest.length, 1);
  assert.deepEqual(ingest[0]!.input, { source: "meet", providerRef: REC, title: "Google Meet", startsAt: START, endsAt: END, attendees: [], joinUrl: "https://meet.google.com/abc-defg-hij" });
  const attach = h.calls("meetings.attach_recording");
  assert.equal(attach.length, 1);
  assert.equal(attach[0]!.input.meetingId, "rec_meet00001");
  assert.equal(attach[0]!.input.source, "meet");
  assert.equal(attach[0]!.input.providerRef, REC);
  assert.equal(attach[0]!.input.transcriptText, "WEBVTT\n\n00:00:01.000 --> 00:00:05.500\nMaya Rivera: Thanks for joining.\n\n00:00:05.500 --> 00:00:07.000\nGuest  Priya: Happy to be here.\n");
  assert.deepEqual(h.rows(`SELECT record, "meetingId" FROM google_meet_seen`), [{ record: REC, meetingId: "rec_meet00001" }]);
});

test("Meet is asked at most every ten minutes, and a conference already handed over is not handed over again", async () => {
  const h = world();
  await pullMeet(h.ctx, { connectionId: CONN, mailbox: MAYA });
  const before = h.requests.length;
  assert.deepEqual(await pullMeet(h.ctx, { connectionId: CONN, mailbox: MAYA }), { records: 0, attached: 0, waiting: 0 });
  assert.equal(h.requests.length, before);
  h.advance(MEET_EVERY_MS + 1);
  assert.deepEqual(await pullMeet(h.ctx, { connectionId: CONN, mailbox: MAYA }), { records: 1, attached: 0, waiting: 0 });
  assert.equal(h.calls("meetings.attach_recording").length, 1);
});

test("a conference with no transcript yet is looked at again on the next pass", async () => {
  const h = world({ transcript: false });
  assert.deepEqual(await pullMeet(h.ctx, { connectionId: CONN, mailbox: MAYA }), { records: 1, attached: 0, waiting: 1 });
  assert.equal(h.calls("meetings.ingest").length, 0);
  assert.equal(h.rows(`SELECT * FROM google_meet_seen`).length, 0);
  const again = world();
  assert.equal((await pullMeet(again.ctx, { connectionId: CONN, mailbox: MAYA })).attached, 1);
});

test("a Gmail push for a member also looks at their conferences; an excluded member's are never looked at", async () => {
  const h = world();
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, MAYA, CONN, "1000", null, null, null, null, null);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history", { body: { history: [], historyId: "1001" } });
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/messages?", { body: { messages: [] } });
  await receivePush(h.ctx, { kind: "gmail", messageId: "p1", mailbox: MAYA, historyId: "1500" });
  assert.equal(h.calls("meetings.attach_recording").length, 1);

  const x = world({ excluded: true });
  await receivePush(x.ctx, { kind: "gmail", messageId: "p2", mailbox: MAYA, historyId: "1500" });
  assert.equal(x.requests.filter((r) => r.url.startsWith(M)).length, 0);
  assert.equal(x.calls("meetings.ingest").length, 0);
});

test("a Meet failure never fails the mailbox pull", async () => {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedDelegation(h);
  h.ctx.db.run(`INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, MAYA, CONN, "1000", null, null, null, null, null);
  h.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/history", { body: { history: [], historyId: "1001" } });
  h.on("GET", `${M}/conferenceRecords?`, { status: 503, body: {} });
  assert.deepEqual(await receivePush(h.ctx, { kind: "gmail", messageId: "p3", mailbox: MAYA, historyId: "1" }), { accepted: true });
  assert.equal(h.scheduled.length, 1);   // the next poll is still queued
});

test("WebVTT times and speakers", () => {
  assert.equal(cueTime(3_723_004), "01:02:03.004");
  assert.equal(cueTime(-5), "00:00:00.000");
  assert.equal(toVtt([{ text: "Hello" }, { text: "There" }], new Map(), NOW), "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nHello\n\n00:00:03.000 --> 00:00:06.000\nThere\n");
  assert.ok(!toVtt([{ text: "  " }], new Map(), NOW).includes("-->"));
});
