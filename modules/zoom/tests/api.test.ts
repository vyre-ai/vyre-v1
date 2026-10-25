// @reads /modules/zoom/impl.ts
// The Zoom connector (P-L5_10; spec 2.18; ARCH 8, 8.3): Server-to-Server OAuth, meetings, cloud recordings and transcripts, and the /hooks/zoom events, replayed against recorded Zoom bodies (no socket is opened).
// Meetings, files and runs are scripted capabilities, each call checked against its frozen contract.
// @reads /modules/zoom/migrations/0001_zoom.sql
// @reads /modules/zoom/handlers/api.ts
// @reads /modules/zoom/handlers/hooks.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as z from "../handlers/index.ts";
import { BASIC, MAYA, RECORDED, START, WEBHOOK, ZOOM_ID, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const TOKEN_URL = "POST zoom.us/oauth/token";
const ok = (h: Harness): void => h.on(`${TOKEN_URL}?grant_type=account_credentials&account_id=acct_not_real`, { status: 200, body: RECORDED.token });

test("Server-to-Server OAuth: the token is asked for with the account and the client secret, used as a bearer, cached, and asked for again a minute before it ends", async () => {
  const h = harness();
  ok(h);
  h.on("GET api.zoom.us/v2/users/me", { status: 200, body: RECORDED.me });
  const me = out(await z.usersMe(h.ctx));
  assert.deepEqual(contractErrors("zoom.users.me", "out", me), []);
  assert.deepEqual(me, { id: "u_host1", email: "dana@firm.example", accountId: "acct_not_real" });
  const tokenCall = h.requests[0];
  assert.deepEqual([tokenCall?.method, tokenCall?.path, tokenCall?.headers.authorization], ["POST", "/oauth/token?grant_type=account_credentials&account_id=acct_not_real", BASIC]);
  assert.equal(h.api()[0]?.headers.authorization, "Bearer tok-1");

  await z.usersMe(h.ctx);
  assert.equal(h.requests.filter((r) => r.path.startsWith("/oauth")).length, 1, "cached");
  h.advance(3600_000 - 30_000);
  h.on(`${TOKEN_URL}?grant_type=account_credentials&account_id=acct_not_real`, { status: 200, body: RECORDED.token2 });
  await z.usersMe(h.ctx);
  assert.equal(h.requests.filter((r) => r.path.startsWith("/oauth")).length, 2, "asked again inside the last minute");
  assert.equal(h.api().at(-1)?.headers.authorization, "Bearer tok-2");
  assert.ok(!JSON.stringify(h.rows(`SELECT * FROM zoom_state`)).includes("secret_not_real"), "the client secret is never kept");
});

test("a 401 gets one retry with a fresh token; a refused account, a Zoom outage and a rate limit are mapped to the error catalogue", async () => {
  const h = harness();
  h.on(`${TOKEN_URL}?grant_type=account_credentials&account_id=acct_not_real`, { status: 200, body: RECORDED.token }, { status: 200, body: RECORDED.token2 });
  h.on("GET api.zoom.us/v2/users/me", { status: 401, body: { code: 124, message: "Invalid access token." } }, { status: 200, body: RECORDED.me });
  assert.equal(out(await z.usersMe(h.ctx)).id, "u_host1");
  assert.deepEqual(h.api().map((r) => r.headers.authorization), ["Bearer tok-1", "Bearer tok-2"]);

  h.on("GET api.zoom.us/v2/users/me", { status: 401, body: {} });
  assert.equal(await refusedWith(z.usersMe(h.ctx)), "provider.auth_failed", "still 401 on the fresh token");
  h.on("GET api.zoom.us/v2/users/me", { status: 403, body: { code: 4711, message: "scope missing; user@private.example" } });
  try { await z.usersMe(h.ctx); } catch (e) { assert.ok(!JSON.stringify(e).includes("private.example"), "Zoom's own words are not passed on"); }
  h.on("GET api.zoom.us/v2/users/me", { status: 429, body: {} });
  assert.equal(await refusedWith(z.usersMe(h.ctx)), "provider.rate_limited");
  h.on("GET api.zoom.us/v2/users/me", { status: 503, body: {} });
  assert.equal(await refusedWith(z.usersMe(h.ctx)), "provider.unavailable");
  h.on("GET api.zoom.us/v2/users/me", { throws: true });
  assert.equal(await refusedWith(z.usersMe(h.ctx)), "provider.network");
  h.on("GET api.zoom.us/v2/users/me", { status: 200, body: { id: "u", email: "not-an-email" } });
  assert.equal(await refusedWith(z.usersMe(h.ctx)), "provider.bad_response");

  const bad = harness();
  bad.on(`${TOKEN_URL}?grant_type=account_credentials&account_id=acct_not_real`, { status: 400, body: { reason: "Invalid client_id or client_secret", error: "invalid_client" } });
  assert.equal(await refusedWith(z.usersMe(bad.ctx)), "provider.auth_failed");
  const down = harness();
  down.on(`${TOKEN_URL}?grant_type=account_credentials&account_id=acct_not_real`, { status: 502, body: {} });
  assert.equal(await refusedWith(z.usersMe(down.ctx)), "provider.unavailable");
  assert.equal(await refusedWith(z.usersMe(harness({ noHost: true }).ctx)), "internal.unavailable", "no Zoom set up on this server");
});

test("health: healthy when the account answers, down with a plain reason when it does not, degraded when Zoom asks us to slow down", async () => {
  const h = harness();
  ok(h);
  h.on("GET api.zoom.us/v2/users/me", { status: 200, body: RECORDED.me });
  const good = out(await z.health(h.ctx));
  assert.deepEqual(contractErrors("zoom.health", "out", good), []);
  assert.equal(good.state, "healthy");
  h.on("GET api.zoom.us/v2/users/me", { status: 403, body: {} });
  const bad = out(await z.health(h.ctx));
  assert.deepEqual([bad.state, /Zoom_S2S/.test(String(bad.detail))], ["down", true]);
  h.on("GET api.zoom.us/v2/users/me", { status: 429, body: {} });
  assert.equal(out(await z.health(h.ctx)).state, "degraded");
  h.on("GET api.zoom.us/v2/users/me", { status: 500, body: {} });
  assert.equal(out(await z.health(h.ctx)).state, "down");
});

test("meetings: create, list, get, update and delete map Zoom's fields to the contract", async () => {
  const h = harness();
  ok(h);
  h.on("POST api.zoom.us/v2/users/me/meetings", { status: 201, body: RECORDED.meeting });
  const made = out(await z.meetingsCreate(h.ctx, { topic: " Estate consult ", startTime: Date.parse(START), durationMinutes: 60, timezone: "America/New_York", agenda: "Goals" }));
  assert.deepEqual(contractErrors("zoom.meetings.create", "out", made), []);
  assert.deepEqual(made.meeting, { id: ZOOM_ID, uuid: "abc==", topic: "Estate consult", startTime: Date.parse(START), durationMinutes: 60, joinUrl: "https://us02web.zoom.us/j/81234567890?pwd=abc", password: "123456", hostEmail: "dana@firm.example", timezone: "America/New_York" });
  assert.deepEqual(h.api()[0]?.body, { topic: "Estate consult", type: 2, settings: { auto_recording: "cloud", join_before_host: false, waiting_room: true }, start_time: "2025-10-09T10:00:00Z", duration: 60, timezone: "America/New_York", agenda: "Goals" });
  h.on("POST api.zoom.us/v2/users/rob%40firm.example/meetings", { status: 201, body: RECORDED.meeting });
  await z.meetingsCreate(h.ctx, { topic: "Instant", hostEmail: "rob@firm.example", autoRecord: "none" });
  assert.equal(h.api()[1]?.path, "/v2/users/rob%40firm.example/meetings");
  assert.deepEqual([(h.api()[1]?.body as Json).type, ((h.api()[1]?.body as Json).settings as Json).auto_recording], [1, "none"]);

  h.on("GET api.zoom.us/v2/users/me/meetings?page_size=30&type=upcoming", { status: 200, body: RECORDED.meetings });
  const listed = out(await z.meetingsList(h.ctx, { type: "upcoming" }));
  assert.deepEqual(contractErrors("zoom.meetings.list", "out", listed), []);
  assert.deepEqual([(listed.meetings as Json[]).map((m) => m.id), listed.nextPageToken, (listed.meetings as Json[])[1]?.startTime], [[ZOOM_ID, "81234567891"], "np1", undefined]);
  h.on("GET api.zoom.us/v2/users/me/meetings?page_size=30&next_page_token=np1", { status: 200, body: { meetings: [] } });
  assert.equal(out(await z.meetingsList(h.ctx, { pageToken: "np1" })).nextPageToken, undefined);

  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}`, { status: 200, body: RECORDED.meeting });
  assert.equal(out(out(await z.meetingsGet(h.ctx, { meetingId: ZOOM_ID })).meeting).topic, "Estate consult");
  h.on("GET api.zoom.us/v2/meetings/81234567899", { status: 404, body: { code: 3001, message: "Meeting does not exist" } });
  assert.equal(await refusedWith(z.meetingsGet(h.ctx, { meetingId: "81234567899" })), "validation.not_found");

  h.on(`PATCH api.zoom.us/v2/meetings/${ZOOM_ID}`, { status: 204 });
  const upd = out(await z.meetingsUpdate(h.ctx, { meetingId: ZOOM_ID, topic: "Moved", startTime: Date.parse(START) + 3_600_000, durationMinutes: 30 }));
  assert.deepEqual(contractErrors("zoom.meetings.update", "out", upd), []);
  assert.deepEqual(h.api().find((r) => r.method === "PATCH")?.body, { topic: "Moved", start_time: "2025-10-09T11:00:00Z", duration: 30 });
  h.on(`DELETE api.zoom.us/v2/meetings/${ZOOM_ID}`, { status: 204 });
  assert.deepEqual(await z.meetingsDelete(h.ctx, { meetingId: ZOOM_ID }), { deleted: true });

  for (const run of [
    () => z.meetingsCreate(h.ctx, { topic: " " }), () => z.meetingsCreate(h.ctx, { topic: "x", durationMinutes: 0 }), () => z.meetingsCreate(h.ctx, { topic: "x", hostEmail: "nope" }),
    () => z.meetingsCreate(h.ctx, { topic: "x", autoRecord: "everything" }), () => z.meetingsCreate(h.ctx, { topic: "x", startTime: 1.5 }), () => z.meetingsList(h.ctx, { type: "old" }),
    () => z.meetingsList(h.ctx, { limit: 301 }), () => z.meetingsGet(h.ctx, { meetingId: "abc" }), () => z.meetingsUpdate(h.ctx, { meetingId: ZOOM_ID }), () => z.meetingsDelete(h.ctx, { meetingId: "1" }),
  ]) assert.equal(await refusedWith(run()), "validation.bad_input");
});

test("recordings: list by date, the files of one meeting, and the transcript text", async () => {
  const h = harness();
  ok(h);
  h.on("GET api.zoom.us/v2/users/me/recordings?from=2025-10-01&to=2025-10-09", { status: 200, body: RECORDED.recordingList });
  const l = out(await z.recordingsList(h.ctx, { from: "2025-10-01", to: "2025-10-09" }));
  assert.deepEqual(contractErrors("zoom.recordings.list", "out", l), []);
  assert.deepEqual((l.meetings as Json[])[0], { meetingId: ZOOM_ID, uuid: "abc==", topic: "Estate consult", startTime: Date.parse(START), files: [{ id: "REC0000MP4", fileType: "MP4", fileSize: 5000, downloadUrl: "https://us02web.zoom.us/rec/download/mp4", status: "completed" }] });
  assert.equal(l.nextPageToken, undefined, "an empty page token is the last page");
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: RECORDED.recordings });
  const g = out(await z.recordingsGet(h.ctx, { meetingId: ZOOM_ID }));
  assert.deepEqual(contractErrors("zoom.recordings.get", "out", g), []);
  assert.deepEqual([(g.files as Json[]).map((f) => f.fileType), g.shareUrl], [["MP4", "TRANSCRIPT"], "https://us02web.zoom.us/rec/share/xyz"]);
  assert.equal(await refusedWith(z.recordingsList(h.ctx, { from: "yesterday", to: "2025-10-09" })), "validation.bad_input");
  assert.equal(await refusedWith(z.recordingsList(h.ctx, { from: "2025-10-09", to: "2025-10-01" })), "validation.bad_input");

  h.on("GET us02web.zoom.us/rec/download/vtt", { status: 200, body: RECORDED.vtt });
  const t = out(await z.transcriptsGet(h.ctx, { meetingId: ZOOM_ID }));
  assert.deepEqual(contractErrors("zoom.transcripts.get", "out", t), []);
  assert.equal(t.vtt, RECORDED.vtt);
  assert.equal(h.requests.at(-1)?.headers.authorization, "Bearer tok-1");
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: { ...RECORDED.recordings, recording_files: [RECORDED.recordings.recording_files[0]] } });
  assert.equal(await refusedWith(z.transcriptsGet(h.ctx, { meetingId: ZOOM_ID })), "validation.not_found", "no transcript file");
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: RECORDED.recordings });
  h.on("GET us02web.zoom.us/rec/download/vtt", { status: 404, body: "" });
  assert.equal(await refusedWith(z.transcriptsGet(h.ctx, { meetingId: ZOOM_ID })), "validation.not_found");
  h.on("GET us02web.zoom.us/rec/download/vtt", { status: 500, body: "" });
  assert.equal(await refusedWith(z.transcriptsGet(h.ctx, { meetingId: ZOOM_ID })), "provider.unavailable");
});

test("a recording download is a Run: the file is pulled with the account token into a blob, saved in Files, the Run says which file, and the same file again is the same Run", async () => {
  const h = harness();
  ok(h);
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: RECORDED.recordings });
  const first = out(await z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC0000MP4", folderId: "fld_meeting01" }));
  assert.deepEqual(contractErrors("zoom.recordings.download", "out", first), []);
  assert.deepEqual(h.downloads, [{ url: "https://us02web.zoom.us/rec/download/mp4", bearer: "tok-1", mime: "video/mp4" }]);
  const made = h.calls("files.create")[0]?.input as Json;
  assert.deepEqual([made.folderId, made.mime, made.kind, made.content, made.idempotencyKey], ["fld_meeting01", "video/mp4", "video", { blobId: `blb_${"0".repeat(31)}1` }, "zoom:rec:REC0000MP4"]);
  assert.equal(made.name, "2025-10-09 Estate consult shared_screen_with_speaker_view 000MP4.mp4");
  const done = h.calls("runs.finish")[0]?.input;
  assert.deepEqual([done?.runId, done?.status, done?.summary], [first.runId, "succeeded", "file:fil_zrec1"]);
  assert.deepEqual(h.rows(`SELECT * FROM zoom_download`).map((r) => [r.recordingFileId, r.fileId, r.runId]), [["REC0000MP4", "fil_zrec1", first.runId]]);

  const again = out(await z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC0000MP4" }));
  assert.equal(again.runId, first.runId);
  assert.equal(h.downloads.length, 1, "nothing downloaded twice");
  assert.equal(h.calls("files.create").length, 1);

  // no folder given: the first folder root, the person's own
  await z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC0000VTT" });
  assert.equal((h.calls("files.create")[1]?.input as Json).folderId, "fld_personal1");
  assert.deepEqual([(h.calls("files.create")[1]?.input as Json).mime, (h.calls("files.create")[1]?.input as Json).kind], ["text/vtt", "text"]);
});

test("a download that fails ends its Run failed with the error and reaches the caller: unknown file, no address, Zoom or Files refusing", async () => {
  const h = harness();
  ok(h);
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: RECORDED.recordings });
  assert.equal(await refusedWith(z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC9999NOPE" })), "validation.not_found");
  assert.deepEqual([h.calls("runs.finish")[0]?.input.status, (h.calls("runs.finish")[0]?.input.error as Json).code], ["failed", "validation.not_found"]);
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: { ...RECORDED.recordings, recording_files: [{ id: "REC0000BAD", file_type: "MP4", download_url: "https://evil.example/x" }] } });
  assert.equal(await refusedWith(z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC0000BAD" })), "provider.bad_response", "only Zoom's own addresses are fetched");
  assert.equal(h.downloads.length, 0);
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}/recordings`, { status: 200, body: RECORDED.recordings });
  h.script("files.create", () => { throw h.err("validation.too_large", "too big"); });
  assert.equal(await refusedWith(z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC0000MP4", folderId: "fld_meeting01" })), "validation.too_large");
  assert.equal(h.rows(`SELECT * FROM zoom_download`).length, 0, "a failed download is tried again next time");
  assert.equal(await refusedWith(z.recordingsDownload(h.ctx, { meetingId: "abc", recordingFileId: "REC0000MP4" })), "validation.bad_input");
  assert.equal(await refusedWith(z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "x" })), "validation.bad_input");
  assert.equal(await refusedWith(z.recordingsDownload(h.ctx, { meetingId: ZOOM_ID, recordingFileId: "REC0000MP4", folderId: "folder" })), "validation.bad_input");
});

test("the webhook signature is Zoom's v0 scheme, and the URL check is answered with the encrypted token", async () => {
  const body = JSON.stringify({ event: "meeting.started", payload: { object: { id: ZOOM_ID } } });
  const sig = await z.signatureOf(WEBHOOK, "1760000000", body);
  assert.match(sig, /^v0=[0-9a-f]{64}$/);
  assert.equal(await z.signatureMatches(WEBHOOK, "1760000000", body, sig), true);
  assert.equal(await z.signatureMatches(WEBHOOK, "1760000001", body, sig), false, "a different timestamp");
  assert.equal(await z.signatureMatches(WEBHOOK, "1760000000", body + " ", sig), false, "a different body");
  assert.equal(await z.signatureMatches("another secret", "1760000000", body, sig), false);
  assert.equal(await z.signatureMatches(WEBHOOK, "1760000000", body, sig.slice(0, -1)), false);
  assert.equal(await z.signatureMatches(WEBHOOK, "1760000000", body, ""), false);

  const h = harness();
  const plain = "qgg8vlvZRS6UYooatFL8Aw";
  const res = out(await z.receiveWebhook(h.ctx, { eventId: "validate-1", type: "endpoint.url_validation", plainToken: plain, at: 1 }));
  assert.deepEqual(contractErrors("zoom.receive_webhook", "out", res), []);
  assert.deepEqual([res.accepted, res.encryptedToken], [true, await z.encryptedTokenOf(WEBHOOK, plain)]);
  assert.match(String(res.encryptedToken), /^[0-9a-f]{64}$/);
  assert.equal(h.rows(`SELECT * FROM zoom_event`).length, 0, "the check is not an event");
  assert.equal(await refusedWith(z.receiveWebhook(h.ctx, { eventId: "v2", type: "endpoint.url_validation", at: 1 })), "validation.bad_input");
  assert.equal(await refusedWith(z.receiveWebhook(harness({ noHost: true }).ctx, { eventId: "v3", type: "endpoint.url_validation", plainToken: plain, at: 1 })), "internal.unavailable");
});

test("meeting started and ended land the meeting through meetings and set its state, once per event", async () => {
  const h = harness();
  ok(h);
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}`, { status: 200, body: RECORDED.meeting });
  assert.deepEqual(await z.receiveWebhook(h.ctx, { eventId: "ev-1", type: "meeting.started", meetingId: ZOOM_ID, uuid: "abc==", at: Date.parse(START) }), { accepted: true });
  const ingest = h.calls("meetings.ingest")[0]?.input;
  assert.deepEqual(ingest, {
    source: "zoom", providerRef: ZOOM_ID, title: "Estate consult", startsAt: Date.parse(START), endsAt: Date.parse(START) + 3_600_000, joinUrl: "https://us02web.zoom.us/j/81234567890?pwd=abc",
    attendees: [{ email: "dana@firm.example" }],
  });
  assert.deepEqual(h.calls("meetings.set_state")[0]?.input, { meetingId: "rec_mtg00001", state: "live" });
  assert.deepEqual(h.named("zoom.event_received")[0]?.payload, { eventId: "ev-1", type: "meeting.started", meetingId: ZOOM_ID });
  // Zoom sent it twice: handled once
  await z.receiveWebhook(h.ctx, { eventId: "ev-1", type: "meeting.started", meetingId: ZOOM_ID, at: Date.parse(START) });
  assert.equal(h.calls("meetings.set_state").length, 1);
  assert.equal(h.named("zoom.event_received").length, 1);
  await z.receiveWebhook(h.ctx, { eventId: "ev-2", type: "meeting.ended", meetingId: ZOOM_ID, at: Date.parse(START) + 3_600_000 });
  assert.deepEqual(h.calls("meetings.set_state")[1]?.input, { meetingId: "rec_mtg00001", state: "ended" });

  // Zoom no longer has an ended instant meeting: it is landed with what the event gave
  h.on("GET api.zoom.us/v2/meetings/81234567891", { status: 404, body: { code: 3001 } });
  await z.receiveWebhook(h.ctx, { eventId: "ev-3", type: "meeting.ended", meetingId: "81234567891", at: 1_760_000_000_000 });
  assert.deepEqual(h.calls("meetings.ingest")[2]?.input, { source: "zoom", providerRef: "81234567891", title: "Zoom meeting", startsAt: 1_760_000_000_000, attendees: [] });
});

test("recording and transcript events pull the recording into the meeting; a failure is answered so Zoom retries, and the retry works", async () => {
  const h = harness();
  ok(h);
  h.on(`GET api.zoom.us/v2/meetings/${ZOOM_ID}`, { status: 200, body: RECORDED.meeting });
  h.script("meetings.attach_recording", () => { throw h.err("provider.unavailable", "files down"); });
  assert.equal(await refusedWith(z.receiveWebhook(h.ctx, { eventId: "ev-r1", type: "recording.completed", meetingId: ZOOM_ID, uuid: "abc==", at: 1 })), "provider.unavailable");
  assert.equal(h.rows(`SELECT * FROM zoom_event`).length, 0, "an event that failed is not remembered");
  assert.equal(h.named("zoom.event_received").length, 0);
  h.script("meetings.attach_recording", () => ({ runId: "run_attach001" }));
  assert.deepEqual(await z.receiveWebhook(h.ctx, { eventId: "ev-r1", type: "recording.completed", meetingId: ZOOM_ID, at: 1 }), { accepted: true });
  assert.deepEqual(h.calls("meetings.attach_recording").at(-1)?.input, { meetingId: "rec_mtg00001", source: "zoom", providerRef: ZOOM_ID });
  await z.receiveWebhook(h.ctx, { eventId: "ev-r2", type: "recording.transcript_completed", meetingId: ZOOM_ID, at: 2 });
  assert.equal(h.calls("meetings.attach_recording").length, 3, "the transcript event asks again, and meetings keeps what it has");
  assert.deepEqual(h.named("zoom.event_received").map((e) => e.payload.type), ["recording.completed", "recording.transcript_completed"]);

  assert.equal(await refusedWith(z.receiveWebhook(h.ctx, { eventId: "ev-x", type: "recording.completed", at: 1 })), "validation.bad_input", "no meeting id");
  assert.equal(await refusedWith(z.receiveWebhook(h.ctx, { eventId: "ev-y", type: "meeting.deleted", meetingId: ZOOM_ID, at: 1 })), "validation.bad_input");
  assert.equal(await refusedWith(z.receiveWebhook(h.ctx, { eventId: "", type: "meeting.started", meetingId: ZOOM_ID, at: 1 })), "validation.bad_input");
  assert.equal(await refusedWith(z.receiveWebhook(h.ctx, { eventId: "ev-z", type: "meeting.started", meetingId: ZOOM_ID, at: 1.5 })), "validation.bad_input");
  assert.ok(MAYA.length > 0 && START.length > 0);
});
