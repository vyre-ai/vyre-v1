// @reads /modules/meetings/impl.ts
// Recordings, transcripts and summaries of a Meeting (P-L5_10; spec 2.18 Meetings, Meeting sources in v1; ARCH 8.3): a Zoom recording is pulled into the meeting's Files folder and its transcript stored on the
// Meeting, where the Inbox conversation reads it; Meet, Teams and uploads attach a file already in Files; no bot ever joins a call; the summary hook starts a Run and a task and set_summary closes it.
// Zoom, records, files, runs and tasks are scripted capabilities, each call checked against its frozen contract.
// @reads /modules/meetings/migrations/0001_meetings.sql
// @reads /modules/meetings/handlers/attach.ts
// @reads /modules/meetings/handlers/meetings.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../handlers/index.ts";
import { parseTranscript } from "../handlers/index.ts";
import { AGENT, JOIN, MAYA, NOW, PAT, START, ZOOM_ID, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;

async function zoomMeeting(h: Harness): Promise<string> {
  const r = out(await m.ingest(h.ctx, { source: "zoom", providerRef: ZOOM_ID, title: "Estate consult", startsAt: START, endsAt: START + 3_600_000, joinUrl: JOIN, attendees: [{ email: "dana@firm.example" }, { email: "pat@client.example" }] }));
  return String(r.meetingId);
}

test("a Zoom recording lands in the meeting folder and its transcript on the Meeting; the Inbox conversation reads both", async () => {
  const h = harness();
  h.contacts.set("pat@client.example", PAT);
  const id = await zoomMeeting(h);
  const done = out(await m.attachRecording(h.ctx, { meetingId: id, source: "zoom" }));
  assert.match(String(done.runId), /^run_/);
  assert.deepEqual(contractErrors("meetings.attach_recording", "out", done), []);

  // the file: asked of Zoom, into the meeting's own folder under shared knowledge
  const folders = h.calls("files.folder.create").map((c) => c.input);
  assert.deepEqual(folders.map((f) => [f.parentId === "fld_knowledge1" ? "root" : "meeting", f.name]), [["root", "Meetings"], ["meeting", "2025-10-09 Estate consult"]]);
  const dl = h.calls("zoom.recordings.download")[0]?.input;
  assert.deepEqual([dl?.meetingId, dl?.recordingFileId], [ZOOM_ID, "REC0000MP4"]);
  assert.match(String(dl?.folderId), /^fld_mf/, "into the meeting's own folder");
  assert.equal(h.fields(id)["recording_state"], "attached");
  assert.deepEqual(h.fields(id)["recording"], ["fil_zoomrec1"]);
  assert.deepEqual(h.named("meeting.recording_attached")[0]?.payload, { meetingId: id, fileId: "fil_zoomrec1", source: "zoom" });

  // the transcript: text on the Meeting, segments with their times and speakers
  assert.equal(h.fields(id)["transcript"], "Dana Wine: Thanks for joining.\nPat Lee: Glad to be here.");
  const segs = out(await m.transcriptGet(h.ctx, { meetingId: id }));
  assert.deepEqual(contractErrors("meetings.transcript.get", "out", segs), []);
  assert.deepEqual(segs.segments, [{ startMs: 1000, endMs: 4500, speaker: "Dana Wine", text: "Thanks for joining." }, { startMs: 5000, endMs: 9000, speaker: "Pat Lee", text: "Glad to be here." }]);
  assert.deepEqual(h.named("meeting.transcript_ready")[0]?.payload, { meetingId: id, source: "zoom" });

  // what the conversation (inbox) reads: meetings.get and meetings.list say there is a recording and words
  const got = out(await m.get(h.ctx, { meetingId: id }));
  assert.deepEqual(contractErrors("meetings.get", "out", got), []);
  assert.deepEqual([out(got.meeting).recordingState, out(got.meeting).hasTranscript, got.recordingFileId, got.transcript], ["attached", true, "fil_zoomrec1", "Dana Wine: Thanks for joining.\nPat Lee: Glad to be here."]);
  const listed = out(await m.listMeetings(h.ctx, { contactId: PAT }));
  assert.equal((listed.meetings as Json[])[0]?.hasTranscript, true);

  // the Run says what happened
  const run = h.runs.get(String(done.runId));
  assert.deepEqual([run?.kind, run?.status, run?.summary], ["other", "succeeded", "recording fil_zoomrec1 and transcript"]);
  assert.deepEqual(h.calls("runs.start")[0]?.input, { kind: "other", name: "Attach the zoom recording", owner: MAYA, subject: { type: "record", id }, idempotencyKey: `meeting_recording:${id}:zoom:${ZOOM_ID}` });
});

test("nothing joins a call: without a provider file or text there is nothing to attach, and a Zoom meeting needs its Zoom id", async () => {
  const h = harness();
  const id = await zoomMeeting(h);
  const e = await m.ingest(h.ctx, { source: "calendar", providerRef: "cev_evt00009", calendarEventId: "cev_evt00009", title: "Call", startsAt: START + 86_400_000, attendees: [{ email: "x@y.example" }] });
  const calOnly = String(out(e).meetingId);
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: calOnly, source: "meet" })), "validation.precondition_failed", "Meet needs its file or its text");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: calOnly, source: "teams" })), "validation.precondition_failed");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: calOnly, source: "zoom" })), "validation.precondition_failed", "no Zoom id on a calendar-only meeting");
  assert.equal(h.calls("runs.start").length, 0, "no Run for work that cannot start");
  assert.deepEqual(h.calls("zoom.recordings.get"), []);
  assert.ok(!h.called.some((c) => /join|bot/i.test(c.cap)), "no capability that joins a call is ever called");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: id, source: "skype" })), "validation.bad_input");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: id, source: "upload", fileId: "file" })), "validation.bad_input");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: id, source: "upload", transcriptText: " " })), "validation.bad_input");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: "rec_nope", source: "upload", fileId: "fil_x0000001" })), "validation.not_found");
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: "nope", source: "upload", fileId: "fil_x0000001" })), "validation.bad_input");
});

test("Meet, Teams and uploads attach a file already in Files, with or without a transcript text", async () => {
  const h = harness();
  const id = String(out(await m.ingest(h.ctx, { source: "calendar", providerRef: "cev_evt00002", calendarEventId: "cev_evt00002", title: "Intake call", startsAt: START, joinUrl: "https://meet.google.com/abc-defg-hij", attendees: [{ email: "pat@client.example" }] })).meetingId);
  assert.equal(h.fields(id)["provider"], "meet");
  const ran = out(await m.attachRecording(h.ctx, { meetingId: id, source: "meet", fileId: "fil_meetrec01", transcriptText: "Pat: I want a trust.\n\nDana: We can do that." }));
  assert.match(String(ran.runId), /^run_/);
  assert.deepEqual([h.fields(id)["recording"], h.fields(id)["recording_state"]], [["fil_meetrec01"], "attached"]);
  assert.equal(h.calls("zoom.recordings.get").length + h.calls("files.folder.create").length, 0, "a file that is already in Files is attached, not copied");
  assert.deepEqual(h.named("meeting.recording_attached")[0]?.payload, { meetingId: id, fileId: "fil_meetrec01", source: "meet" });
  assert.deepEqual(out(await m.transcriptGet(h.ctx, { meetingId: id })).segments, [{ startMs: 0, endMs: 0, speaker: "Pat", text: "I want a trust." }, { startMs: 0, endMs: 0, speaker: "Dana", text: "We can do that." }]);
  assert.equal(h.fields(id)["transcript"], "Pat: I want a trust.\nDana: We can do that.");

  // the same attach again is the same Run, and nothing is stored twice
  const again = out(await m.attachRecording(h.ctx, { meetingId: id, source: "meet", fileId: "fil_meetrec01" }));
  assert.equal(again.runId, ran.runId);
  assert.equal(h.named("meeting.recording_attached").length, 1);

  // a transcript with no recording, from Teams
  const t = String(out(await m.ingest(h.ctx, { source: "teams", providerRef: "teams-1", title: "Teams sync", startsAt: START + 5 * 3_600_000, attendees: [] })).meetingId);
  await m.attachRecording(h.ctx, { meetingId: t, source: "teams", transcriptText: "Rob: Short call." });
  assert.deepEqual([h.fields(t)["recording_state"], h.fields(t)["transcript"]], ["none", "Rob: Short call."]);
  assert.equal(h.named("meeting.recording_attached").length, 1);
  assert.equal(h.named("meeting.transcript_ready").length, 2);
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: t, source: "teams", transcriptText: "x".repeat(2_000_001) })), "validation.too_large");
  assert.equal(h.runs.size, 2, "one Run for the Meet attach (the repeat reused it) and one for the Teams transcript; the refused oversize transcript started none");
});

test("Zoom: the recording and the transcript can arrive apart; a repeat of the first changes nothing, the second brings the words", async () => {
  const h = harness();
  const id = await zoomMeeting(h);
  h.script("zoom.transcripts.get", () => { throw h.err("validation.not_found", "no transcript yet"); });
  await m.attachRecording(h.ctx, { meetingId: id, source: "zoom" });
  assert.equal(h.fields(id)["recording_state"], "attached");
  assert.equal(h.fields(id)["transcript"], undefined, "Zoom had no transcript yet");
  assert.equal(h.named("meeting.transcript_ready").length, 0);
  assert.equal(h.calls("zoom.recordings.download").length, 1);

  h.script("zoom.transcripts.get", () => ({ vtt: "WEBVTT\n\n1\n00:00:00.500 --> 00:00:02.000\nDana: Hello." }));
  await m.attachRecording(h.ctx, { meetingId: id, source: "zoom" });
  assert.equal(h.fields(id)["transcript"], "Dana: Hello.");
  assert.equal(h.named("meeting.transcript_ready").length, 1);
  assert.equal(h.named("meeting.recording_attached").length, 1, "the file was attached once; the second pass only brought the words");
  assert.equal(h.calls("zoom.recordings.download").length, 1, "and was not downloaded again");

  // once it has both, asking again does nothing
  const before = h.calls("zoom.recordings.get").length;
  await m.attachRecording(h.ctx, { meetingId: id, source: "zoom" });
  assert.equal(h.calls("zoom.recordings.get").length, before);
});

test("Zoom has nothing yet: the state says unavailable and the Run ends without an error; a provider refusal fails the Run and reaches the caller", async () => {
  const h = harness();
  const id = await zoomMeeting(h);
  h.script("zoom.recordings.get", () => ({ files: [] }));
  h.script("zoom.transcripts.get", () => { throw h.err("validation.not_found", "none"); });
  const r = out(await m.attachRecording(h.ctx, { meetingId: id, source: "zoom" }));
  assert.equal(h.fields(id)["recording_state"], "unavailable");
  assert.deepEqual([h.runs.get(String(r.runId))?.status, h.runs.get(String(r.runId))?.summary], ["succeeded", "Zoom has no recording or transcript for this meeting yet."]);

  h.script("zoom.recordings.get", () => { throw h.err("provider.auth_failed", "no"); });
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: id, source: "zoom", providerRef: ZOOM_ID })), "provider.auth_failed");
  const failed = [...h.runs.values()].filter((x) => x.status === "failed");
  assert.equal(failed.length, 1);
  assert.equal((failed[0]?.error as Json).code, "provider.auth_failed");
  assert.deepEqual(h.rows(`SELECT * FROM meetings_run`), [], "no Run is left open");

  // Zoom hands over no file for the download
  h.script("zoom.recordings.get", () => ({ files: [{ id: "REC0000MP4", fileType: "MP4", status: "completed" }] }));
  h.script("zoom.recordings.download", () => ({ runId: "run_zdlbad" }));
  h.runs.set("run_zdlbad", { kind: "other", status: "succeeded", summary: "nothing" });
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: id, source: "zoom", providerRef: ZOOM_ID })), "provider.unavailable");
});

test("transcripts: WebVTT keeps times and speakers, plain text is one segment per paragraph, empty text is refused; pages come in order", async () => {
  assert.deepEqual(parseTranscript("WEBVTT\n\n1\n00:01:02.003 --> 00:01:05.000\n<v Dana>Dana: Hello there</v>\n\n2\n01:00:00.000 --> 01:00:01.500 align:start\nNo speaker here"), [
    { startMs: 62_003, endMs: 65_000, speaker: "Dana", text: "Hello there" }, { startMs: 3_600_000, endMs: 3_601_500, text: "No speaker here" },
  ]);
  assert.deepEqual(parseTranscript("Line one\nsecond line\n\n\nPat: Next para"), [{ startMs: 0, endMs: 0, text: "Line one second line" }, { startMs: 0, endMs: 0, speaker: "Pat", text: "Next para" }]);
  assert.deepEqual(parseTranscript("   \n\n "), []);
  const h = harness();
  const id = await zoomMeeting(h);
  assert.equal(await refusedWith(m.attachRecording(h.ctx, { meetingId: id, source: "upload", transcriptText: "WEBVTT\n\nnothing" })), "validation.bad_input", "a transcript with no words");
  const long = Array.from({ length: 5 }, (_v, i) => `Speaker: line ${i}`).join("\n\n");
  await m.attachRecording(h.ctx, { meetingId: id, source: "upload", transcriptText: long });
  const p1 = out(await m.transcriptGet(h.ctx, { meetingId: id, limit: 2 }));
  assert.deepEqual([(p1.segments as Json[]).map((s) => s.text), p1.next, p1.total], [["line 0", "line 1"], "2", 5]);
  assert.deepEqual((out(await m.transcriptGet(h.ctx, { meetingId: id, limit: 2, cursor: "4" })).segments as Json[]).map((s) => s.text), ["line 4"]);
  assert.equal(await refusedWith(m.transcriptGet(h.ctx, { meetingId: id, limit: 0 })), "validation.bad_input");
  assert.equal(await refusedWith(m.transcriptGet(h.ctx, { meetingId: "rec_nope" })), "validation.not_found");
});

test("the summary hook: summarize starts a Run and puts a task on the agent, set_summary writes the words, says so and closes the Run", async () => {
  const h = harness();
  const id = await zoomMeeting(h);
  assert.equal(await refusedWith(m.summarize(h.ctx, { meetingId: id })), "validation.precondition_failed", "nothing to summarise without a transcript");
  await m.attachRecording(h.ctx, { meetingId: id, source: "zoom" });
  const started = out(await m.summarize(h.ctx, { meetingId: id, agentId: AGENT, pullDecisions: true }));
  assert.deepEqual(contractErrors("meetings.summarize", "out", started), []);
  assert.equal(h.runs.get(String(started.runId))?.status, "running");
  const task = h.calls("tasks.create")[0]?.input;
  assert.deepEqual([task?.title, task?.assigned, task?.recordId, task?.source], ["Summarise Estate consult", { kind: "agent", id: AGENT }, id, { kind: "manual", id: started.runId }]);
  assert.match(String(task?.why), /decisions/);
  assert.equal(out(await m.summarize(h.ctx, { meetingId: id, agentId: AGENT, pullDecisions: true })).runId, started.runId, "asking twice for the same transcript is one Run");

  h.actAs("agent", AGENT);
  assert.deepEqual(await m.setSummary(h.ctx, { meetingId: id, summary: "Dana and Pat agreed to a revocable trust.", decisions: "Draft the trust by Friday." }), { meetingId: id });
  assert.deepEqual([h.fields(id)["summary"], h.fields(id)["decisions"]], ["Dana and Pat agreed to a revocable trust.", "Draft the trust by Friday."]);
  assert.deepEqual(h.named("meeting.summary_ready")[0]?.payload, { meetingId: id, byAgent: AGENT });
  assert.equal(h.runs.get(String(started.runId))?.status, "succeeded");
  assert.deepEqual(h.rows(`SELECT * FROM meetings_run`), []);
  const got = out(await m.get(h.ctx, { meetingId: id }));
  assert.deepEqual([out(got.meeting).hasSummary, got.summary, got.decisions], [true, "Dana and Pat agreed to a revocable trust.", "Draft the trust by Friday."]);

  // a person corrects it: said again, no Run to close; the same words say nothing
  h.actAs("person", MAYA);
  await m.setSummary(h.ctx, { meetingId: id, summary: "Corrected." });
  assert.equal(h.named("meeting.summary_ready").length, 2);
  assert.equal(h.named("meeting.summary_ready")[1]?.payload.byAgent, undefined);
  await m.setSummary(h.ctx, { meetingId: id, summary: "Corrected." });
  assert.equal(h.named("meeting.summary_ready").length, 2, "the same words change nothing");
  assert.equal(await refusedWith(m.setSummary(h.ctx, { meetingId: id })), "validation.bad_input");
  assert.equal(await refusedWith(m.setSummary(h.ctx, { meetingId: id, summary: 5 as unknown as string })), "validation.bad_input");
  assert.equal(await refusedWith(m.summarize(h.ctx, { meetingId: id, agentId: "robot" })), "validation.bad_input");
  assert.equal(await refusedWith(m.summarize(h.ctx, { meetingId: "rec_nope" })), "validation.not_found");
  assert.ok(NOW > 0);
});
