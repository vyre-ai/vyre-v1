// Recordings, transcripts and summaries of a Meeting (spec 2.18 Meetings; ARCH 8.3): attach_recording, transcript.get, summarize and set_summary. There is no meeting bot in v1 (lead ruling 50):
// every recording comes from the provider's own cloud (Zoom through the zoom connector) or from a file the person or the Google and Microsoft connectors already put in Files (Meet, Teams, upload).
// DECISION: attach_recording is a Run (kind meeting_recording): it starts the Run, does the work in the call and finishes the Run succeeded or failed with the error, so Runs shows what happened.
// A repeat of the same attach (same meeting, source and file or provider id) finds the Run and the file it made and answers the same Run: nothing is downloaded twice.
// DECISION: a Zoom recording is downloaded by zoom.recordings.download into the meeting's folder (Meetings, then one folder per meeting, inside shared knowledge) and the file id comes back in that
// Run's summary (`file:<id>`). A recording that came as a file (Meet, Teams, upload) stays where it is: it is attached, not copied.
// DECISION: a transcript is kept two ways: the plain text on the Meeting (field transcript, Confidential) and the timed segments in meetings_segment for meetings.transcript.get. A WebVTT text keeps its
// times and speakers; plain text becomes one segment per paragraph with no times.
// DECISION: meetings.summarize does not call a model. It starts the Run (kind meeting_summary) and puts a task on the agent (or the asker) with the meeting attached; the agent calls meetings.set_summary,
// which writes the summary and decisions, says meeting.summary_ready and finishes the Run. This is the hook the meeting_ended Automation template uses.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, codeOf as callCodeOf, ensure, first, getState, isId, linkFor, list, meetingRecord, num, obj, paging, pageOf, patchMeeting, refuse, rowsOf, saveLink, setState, str, strOrUndef, text } from "../projections.ts";
import type { Json, Link, MeetCtx, SourceKind } from "../projections.ts";

const SOURCES = ["zoom", "meet", "teams", "upload"] as const;
const MAX_TRANSCRIPT = 2_000_000;

export interface Segment { startMs: number; endMs: number; speaker?: string; text: string }

const toMs = (t: string): number => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(t.trim());
  if (!m) return 0;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, "0"));
};

/** WebVTT keeps its times and speakers ("Name: words"); anything else is one segment per paragraph. */
export function parseTranscript(raw: string): Segment[] {
  const body = raw.replace(/\r\n?/g, "\n").trim();
  const out: Segment[] = [];
  const speakerOf = (line: string): { speaker?: string; text: string } => {
    const m = /^([^:\n]{1,60}):\s+(.+)$/.exec(line);
    return m ? { speaker: m[1]!.trim(), text: m[2]!.trim() } : { text: line.trim() };
  };
  if (/^WEBVTT/.test(body)) {
    for (const block of body.split(/\n{2,}/)) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) continue;
      const [a, b] = lines[at]!.split("-->");
      const words = lines.slice(at + 1).join(" ").replace(/<[^>]+>/g, "");
      if (!words) continue;
      out.push({ startMs: toMs(a ?? ""), endMs: toMs((b ?? "").trim().split(/\s+/)[0] ?? ""), ...speakerOf(words) });
    }
    return out;
  }
  for (const para of body.split(/\n{2,}/)) {
    const words = para.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
    if (words) out.push({ startMs: 0, endMs: 0, ...speakerOf(words) });
  }
  return out;
}

const plain = (segs: Segment[]): string => segs.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join("\n");

function storeSegments(ctx: MeetCtx, recordId: string, segs: Segment[]): void {
  ctx.db.run(`DELETE FROM meetings_segment WHERE "recordId" = ?`, recordId);
  segs.forEach((s, i) => ctx.db.run(`INSERT INTO meetings_segment ("id", "recordId", "idx", "startMs", "endMs", "speaker", "text") VALUES (?, ?, ?, ?, ?, ?, ?)`, `${recordId}:${i}`, recordId, i, s.startMs, s.endMs, s.speaker ?? null, s.text));
}

// ---- the Files folder of a meeting

async function rootFolder(ctx: MeetCtx): Promise<string> {
  const cached = getState(ctx, "meetings_folder");
  if (cached) return cached;
  const roots = list(obj(await ctx.call("files.tree", {}))["roots"]).map(obj).filter((r) => r["kind"] === "folder" && typeof r["folderId"] === "string");
  const root = roots.find((r) => r["key"] === "shared_knowledge") ?? roots.find((r) => r["key"] === "knowledge") ?? roots[0];
  if (!root) return refuse(ctx, "There is no Files folder to keep meeting recordings in.");
  let id: string;
  try {
    id = text(obj(obj(await ctx.call("files.folder.create", { parentId: text(root["folderId"]), name: "Meetings", idempotencyKey: "meetings:root-folder" }))["folder"])["folderId"]);
  } catch (e) {
    if (callCodeOf(e) !== "validation.duplicate") throw e;
    id = text(obj(await ctx.call("files.resolve", { path: `${text(root["title"])}/Meetings` }))["folderId"]);
  }
  if (!id) throw fail("internal.unexpected", ctx.trace.traceId, { message: "The Meetings folder could not be found." });
  setState(ctx, "meetings_folder", id);
  return id;
}

async function meetingFolder(ctx: MeetCtx, link: Link, title: string): Promise<string> {
  if (link.folderId) return link.folderId;
  const root = await rootFolder(ctx);
  const day = new Date(link.startsAt).toISOString().slice(0, 10);
  const name = `${day} ${title.replace(/[\\/\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "Meeting"}`;
  let id: string;
  try {
    id = text(obj(obj(await ctx.call("files.folder.create", { parentId: root, name, idempotencyKey: `meetings:folder:${link.recordId}` }))["folder"])["folderId"]);
  } catch (e) {
    if (callCodeOf(e) !== "validation.duplicate") throw e;
    id = text(obj(obj(await ctx.call("files.folder.create", { parentId: root, name: `${name} (${link.recordId.slice(-6)})`, idempotencyKey: `meetings:folder2:${link.recordId}` }))["folder"])["folderId"]);
  }
  if (!id) throw fail("internal.unexpected", ctx.trace.traceId, { message: "The meeting folder could not be made." });
  return id;
}

// ---- runs

async function startRun(ctx: MeetCtx, recordId: string, kind: "recording" | "summary", name: string, key: string): Promise<string> {
  const started = obj(await ctx.call("runs.start", { kind: "other", name, owner: ctx.principal.id, subject: { type: "record", id: recordId }, idempotencyKey: key }));
  const runId = text(started["runId"]);
  if (!isId("run", runId)) throw new Error("runs.start answered no id");
  if (!first(ctx.db.all(`SELECT * FROM meetings_run WHERE "runId" = ?`, runId))) ctx.db.run(`INSERT INTO meetings_run ("runId", "recordId", "kind", "at") VALUES (?, ?, ?, ?)`, runId, recordId, kind, ctx.now());
  return runId;
}

async function finishRun(ctx: MeetCtx, runId: string, ok: { summary: string } | { code: string; message: string }): Promise<void> {
  await ctx.call("runs.finish", "summary" in ok ? { runId, status: "succeeded", summary: ok.summary } : { runId, status: "failed", error: { code: ok.code, message: ok.message } });
  ctx.db.run(`DELETE FROM meetings_run WHERE "runId" = ?`, runId);
}

// ---- meetings.attach_recording

interface AttachIn { meetingId: string; source: string; providerRef?: string; fileId?: string; transcriptText?: string }

export async function attachRecording(ctx: MeetCtx, input: AttachIn) {
  ensure(ctx);
  if (!SOURCES.includes(input.source as never)) bad(ctx, "A recording comes from Zoom, Meet, Teams or an upload.");
  if (input.fileId !== undefined && !isId("fil", input.fileId)) bad(ctx, "The file id is not valid.");
  if (input.providerRef !== undefined && (typeof input.providerRef !== "string" || input.providerRef === "")) bad(ctx, "The provider id is text.");
  if (input.transcriptText !== undefined && (typeof input.transcriptText !== "string" || input.transcriptText.trim() === "")) bad(ctx, "The transcript is text.");
  if (input.transcriptText !== undefined && input.transcriptText.length > MAX_TRANSCRIPT) throw fail("validation.too_large", ctx.trace.traceId, { message: "A transcript is up to 2 million characters." });
  const rec = await meetingRecord(ctx, input.meetingId);
  const link = linkFor(ctx, input.meetingId);
  if (!link) return refuse(ctx, "This meeting has no calendar or provider details to attach a recording to.");
  const source = input.source as SourceKind;
  const ref = input.providerRef ?? (source === "zoom" ? link.providerRef ?? undefined : undefined);
  if (source === "zoom" && !ref) refuse(ctx, "There is no Zoom meeting id for this meeting. Give the provider id.");
  if (source !== "zoom" && !input.fileId && !input.transcriptText) refuse(ctx, "Give the recording file or the transcript text: Vyre does not join the call.");

  const key = `meeting_recording:${input.meetingId}:${source}:${ref ?? input.fileId ?? "text"}`;
  const runId = await startRun(ctx, input.meetingId, "recording", `Attach the ${source} recording`, key);
  const hasWords = rowsOf(ctx.db.all(`SELECT * FROM meetings_segment WHERE "recordId" = ?`, input.meetingId)).length > 0;
  if (link.recordingFileId && (source === "zoom" || link.recordingFileId === input.fileId) && input.transcriptText === undefined && text(rec.fields["recording_state"]) === "attached" && (hasWords || source !== "zoom")) {
    return { runId };   // the same attach again: the file and the words are there (a Zoom transcript can come after the recording, so Zoom asks again until it has words)
  }
  try {
    let fileId = input.fileId;
    let transcript = input.transcriptText;
    if (source === "zoom") {
      const files = list(obj(await ctx.call("zoom.recordings.get", { meetingId: ref as string }))["files"]).map(obj).filter((f) => text(f["status"]) === "" || text(f["status"]) === "completed");
      const media = files.find((f) => text(f["fileType"]).toUpperCase() === "MP4") ?? files.find((f) => text(f["fileType"]).toUpperCase() === "M4A");
      if (media && !fileId && !link.recordingFileId) {
        const folderId = await meetingFolder(ctx, link, text(rec.fields["title"]));
        const dl = obj(await ctx.call("zoom.recordings.download", { meetingId: ref as string, recordingFileId: text(media["id"]), folderId }));
        const run = obj(obj(await ctx.call("runs.get", { runId: text(dl["runId"]) }))["run"]);
        const made = /^file:(fil_[a-z0-9]+)$/.exec(text(run["summary"]));
        if (!made) throw fail("provider.unavailable", ctx.trace.traceId, { message: "Zoom did not hand over the recording file. Try again in a few minutes." });
        fileId = made[1];
        saveLink(ctx, { ...link, folderId });
      }
      if (transcript === undefined) {
        try {
          transcript = text(obj(await ctx.call("zoom.transcripts.get", { meetingId: ref as string }))["vtt"]) || undefined;
        } catch (e) {
          if (callCodeOf(e) !== "validation.not_found") throw e;   // Zoom made no transcript for this one
        }
      }
      if (!fileId && !link.recordingFileId && transcript === undefined) {
        await patchMeeting(ctx, input.meetingId, { recording_state: "unavailable" });
        await finishRun(ctx, runId, { summary: "Zoom has no recording or transcript for this meeting yet." });
        return { runId };
      }
    }
    if (fileId && fileId !== link.recordingFileId) {
      const fresh = linkFor(ctx, input.meetingId) as Link;
      saveLink(ctx, { ...fresh, recordingFileId: fileId });
      await patchMeeting(ctx, input.meetingId, { recording: [fileId], recording_state: "attached" });
      ctx.emit("meeting.recording_attached", `record/${input.meetingId}`, { meetingId: input.meetingId, fileId, source });
    }
    if (transcript !== undefined) {
      const segs = parseTranscript(transcript);
      if (segs.length === 0) bad(ctx, "That transcript has no words in it.");
      storeSegments(ctx, input.meetingId, segs);
      await patchMeeting(ctx, input.meetingId, { transcript: plain(segs) });
      ctx.emit("meeting.transcript_ready", `record/${input.meetingId}`, { meetingId: input.meetingId, source });
    }
    await finishRun(ctx, runId, { summary: [fileId && fileId !== link.recordingFileId ? `recording ${fileId}` : link.recordingFileId ? `recording ${link.recordingFileId}` : "", transcript !== undefined ? "transcript" : ""].filter(Boolean).join(" and ") });
    return { runId };
  } catch (e) {
    await finishRun(ctx, runId, { code: callCodeOf(e) || "internal.unexpected", message: (e as { error?: { message?: string } } | null)?.error?.message ?? "The recording could not be attached." });
    throw e;
  }
}

// ---- meetings.transcript.get

export async function transcriptGet(ctx: MeetCtx, input: { meetingId: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  await meetingRecord(ctx, input.meetingId);
  const rows = rowsOf(ctx.db.all(`SELECT * FROM meetings_segment WHERE "recordId" = ?`, input.meetingId)).sort((a, b) => num(a, "idx") - num(b, "idx"));
  const p = pageOf(rows, cursor, limit);
  return {
    segments: p.page.map((r) => ({ startMs: num(r, "startMs"), endMs: num(r, "endMs"), ...(strOrUndef(r["speaker"]) ? { speaker: str(r, "speaker") } : {}), text: str(r, "text") })),
    ...(p.next ? { next: p.next } : {}), total: p.total,
  };
}

// ---- summaries

export async function summarize(ctx: MeetCtx, input: { meetingId: string; agentId?: string; pullDecisions?: boolean }) {
  ensure(ctx);
  if (input.agentId !== undefined && !isId("agt", input.agentId)) bad(ctx, "The agent id is not valid.");
  if (input.pullDecisions !== undefined && typeof input.pullDecisions !== "boolean") bad(ctx, "pullDecisions is true or false.");
  const rec = await meetingRecord(ctx, input.meetingId);
  const transcript = text(rec.fields["transcript"]);
  if (!transcript) refuse(ctx, "There is no transcript to summarise yet.");
  const key = `meeting_summary:${input.meetingId}:${transcript.length}:${input.agentId ?? ctx.principal.id}`;
  const runId = await startRun(ctx, input.meetingId, "summary", `Summarise ${text(rec.fields["title"]) || "the meeting"}`, key);
  await ctx.call("tasks.create", {
    title: `Summarise ${text(rec.fields["title"]) || "the meeting"}`,
    why: input.pullDecisions === false ? "Write the summary with meetings.set_summary." : "Write the summary and the decisions with meetings.set_summary, and link what was decided to its records.",
    assigned: input.agentId ? { kind: "agent", id: input.agentId } : { kind: "person", id: ctx.principal.id }, recordId: input.meetingId, source: { kind: "manual", id: runId }, idempotencyKey: `${key}:task`,
  });
  return { runId };
}

export async function setSummary(ctx: MeetCtx, input: { meetingId: string; summary?: string; decisions?: string }) {
  ensure(ctx);
  if (input.summary === undefined && input.decisions === undefined) bad(ctx, "Send a summary, decisions or both.");
  for (const [k, v] of [["summary", input.summary], ["decisions", input.decisions]] as const) if (v !== undefined && (typeof v !== "string" || v.length > 100_000)) bad(ctx, `The ${k} is text, up to 100,000 characters.`);
  const rec = await meetingRecord(ctx, input.meetingId);
  const patch: Json = {};
  if (input.summary !== undefined && input.summary !== text(rec.fields["summary"])) patch["summary"] = input.summary;
  if (input.decisions !== undefined && input.decisions !== text(rec.fields["decisions"])) patch["decisions"] = input.decisions;
  const open = rowsOf(ctx.db.all(`SELECT * FROM meetings_run WHERE "recordId" = ?`, input.meetingId)).filter((r) => str(r, "kind") === "summary");
  if (Object.keys(patch).length === 0 && open.length === 0) return { meetingId: input.meetingId };
  if (Object.keys(patch).length) await patchMeeting(ctx, input.meetingId, patch);
  ctx.emit("meeting.summary_ready", `record/${input.meetingId}`, { meetingId: input.meetingId, ...(ctx.principal.kind === "agent" ? { byAgent: ctx.principal.id } : {}) });
  for (const r of open) await finishRun(ctx, str(r, "runId"), { summary: "summary written" });
  return { meetingId: input.meetingId };
}

