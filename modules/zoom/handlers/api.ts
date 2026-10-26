// The Zoom REST API as capabilities (spec 2.18; ARCH 8, 8.3): meetings (create, list, get, update, delete), cloud recordings (list, get, download into Files), transcripts, the account user and the
// health probe. Server-to-Server OAuth only; the Space's account id, client id and secret come from the Vault through the host seam and are never kept here.
// DECISION: a recording download is a Run (kind zoom_recording_download) that does the work in the call: it pulls the file with the account token into a blob (the host seam), makes the Files file in
// the folder asked for (else the first folder root) and finishes the Run with `file:<fileId>` as its summary, which is how meetings.attach_recording finds the file. The same recording file again
// answers the same Run: nothing is downloaded twice.
// DECISION: Zoom's times are ISO strings; the contract's are epoch milliseconds. A meeting with no start time (an instant or recurring-with-no-fixed-time meeting) has none in the answer.
// DECISION: transcripts are the recording file of type TRANSCRIPT (WebVTT); a meeting without one is validation.not_found, which meetings.attach_recording treats as "no words yet".
import { fail } from "../../../host/src/routes/errors.ts";
import { api, accessToken, bad, codeOf, ensure, first, intOrUndef, list, meetingIdOf, needHost, obj, strOrUndef, text } from "../projections.ts";
import type { Json, ZoomCtx } from "../projections.ts";

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ms = (v: unknown): number | undefined => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};
const host = (email: string | undefined): string => (email === undefined ? "me" : encodeURIComponent(email));

function meetingOut(j: Json): Json {
  const out: Json = { id: text(j["id"]), topic: text(j["topic"]), joinUrl: text(j["join_url"]) };
  if (strOrUndef(j["uuid"])) out["uuid"] = text(j["uuid"]);
  const start = ms(j["start_time"]);
  if (start !== undefined) out["startTime"] = start;
  const d = intOrUndef(j["duration"]);
  if (d !== undefined) out["durationMinutes"] = d;
  if (strOrUndef(j["password"])) out["password"] = text(j["password"]);
  if (strOrUndef(j["host_email"]) && EMAIL.test(text(j["host_email"]))) out["hostEmail"] = text(j["host_email"]);
  if (strOrUndef(j["timezone"])) out["timezone"] = text(j["timezone"]);
  return out;
}

function fileOut(f: Json): Json {
  const out: Json = { id: text(f["id"]), fileType: text(f["file_type"]) };
  if (strOrUndef(f["recording_type"])) out["recordingType"] = text(f["recording_type"]);
  const size = intOrUndef(f["file_size"]);
  if (size !== undefined) out["fileSize"] = size;
  if (strOrUndef(f["download_url"])) out["downloadUrl"] = text(f["download_url"]);
  if (strOrUndef(f["status"])) out["status"] = text(f["status"]);
  return out;
}

function emailOk(ctx: ZoomCtx, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "string" && EMAIL.test(v) ? v : bad(ctx, "The host email is not valid.");
}

// ---- meetings

export async function meetingsCreate(ctx: ZoomCtx, input: { topic: string; startTime?: number; durationMinutes?: number; timezone?: string; agenda?: string; hostEmail?: string; autoRecord?: string }) {
  ensure(ctx);
  if (typeof input.topic !== "string" || input.topic.trim() === "" || input.topic.length > 200) bad(ctx, "A meeting topic is 1 to 200 characters.");
  if (input.startTime !== undefined && !Number.isSafeInteger(input.startTime)) bad(ctx, "The start time is a time.");
  if (input.durationMinutes !== undefined && (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440)) bad(ctx, "A meeting lasts 1 to 1440 minutes.");
  if (input.autoRecord !== undefined && !["none", "local", "cloud"].includes(input.autoRecord)) bad(ctx, "Auto record is none, local or cloud.");
  if (input.agenda !== undefined && (typeof input.agenda !== "string" || input.agenda.length > 2000)) bad(ctx, "The agenda is up to 2000 characters.");
  const hostEmail = emailOk(ctx, input.hostEmail);
  const body: Json = { topic: input.topic.trim(), type: input.startTime === undefined ? 1 : 2, settings: { auto_recording: input.autoRecord ?? "cloud", join_before_host: false, waiting_room: true } };
  if (input.startTime !== undefined) body["start_time"] = iso(input.startTime);
  if (input.durationMinutes !== undefined) body["duration"] = input.durationMinutes;
  if (input.timezone !== undefined) body["timezone"] = input.timezone;
  if (input.agenda !== undefined) body["agenda"] = input.agenda;
  const j = await api(ctx, { method: "POST", path: `/users/${host(hostEmail)}/meetings`, body });
  if (!text(j["id"]) || !text(j["join_url"])) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Zoom did not return the meeting." });
  return { meeting: meetingOut({ ...j, ...(hostEmail ? { host_email: hostEmail } : {}) }) };
}

export async function meetingsList(ctx: ZoomCtx, input: { hostEmail?: string; type?: string; pageToken?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const hostEmail = emailOk(ctx, input.hostEmail);
  if (input.type !== undefined && !["scheduled", "live", "upcoming", "previous"].includes(input.type)) bad(ctx, "That meeting type is not known.");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 300)) bad(ctx, "The limit is 1 to 300.");
  const query: Record<string, string> = { page_size: String(input.limit ?? 30) };
  if (input.type) query["type"] = input.type;
  const token = input.pageToken ?? input.cursor;
  if (token) query["next_page_token"] = token;
  const j = await api(ctx, { path: `/users/${host(hostEmail)}/meetings`, query });
  const next = strOrUndef(j["next_page_token"]);
  return { meetings: list(j["meetings"]).map(obj).map(meetingOut), ...(next ? { nextPageToken: next } : {}) };
}

export async function meetingsGet(ctx: ZoomCtx, input: { meetingId: string }) {
  ensure(ctx);
  return { meeting: meetingOut(await api(ctx, { path: `/meetings/${meetingIdOf(ctx, input.meetingId)}` })) };
}

export async function meetingsUpdate(ctx: ZoomCtx, input: { meetingId: string; topic?: string; startTime?: number; durationMinutes?: number; agenda?: string }) {
  ensure(ctx);
  const id = meetingIdOf(ctx, input.meetingId);
  const body: Json = {};
  if (input.topic !== undefined) { if (typeof input.topic !== "string" || input.topic.trim() === "" || input.topic.length > 200) bad(ctx, "A meeting topic is 1 to 200 characters."); body["topic"] = input.topic.trim(); }
  if (input.startTime !== undefined) { if (!Number.isSafeInteger(input.startTime)) bad(ctx, "The start time is a time."); body["start_time"] = iso(input.startTime); }
  if (input.durationMinutes !== undefined) { if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) bad(ctx, "A meeting lasts 1 to 1440 minutes."); body["duration"] = input.durationMinutes; }
  if (input.agenda !== undefined) { if (typeof input.agenda !== "string" || input.agenda.length > 2000) bad(ctx, "The agenda is up to 2000 characters."); body["agenda"] = input.agenda; }
  if (Object.keys(body).length === 0) bad(ctx, "Change at least one thing.");
  await api(ctx, { method: "PATCH", path: `/meetings/${id}`, body });
  return { meeting: meetingOut(await api(ctx, { path: `/meetings/${id}` })) };
}

export async function meetingsDelete(ctx: ZoomCtx, input: { meetingId: string }) {
  ensure(ctx);
  await api(ctx, { method: "DELETE", path: `/meetings/${meetingIdOf(ctx, input.meetingId)}` });
  return { deleted: true };
}

// ---- recordings

export async function recordingsList(ctx: ZoomCtx, input: { from: string; to: string; hostEmail?: string; pageToken?: string }) {
  ensure(ctx);
  for (const k of ["from", "to"] as const) if (typeof input[k] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input[k])) bad(ctx, `${k} is a date, like 2026-10-01.`);
  if (input.from > input.to) bad(ctx, "from is not after to.");
  const hostEmail = emailOk(ctx, input.hostEmail);
  const query: Record<string, string> = { from: input.from, to: input.to };
  if (input.pageToken) query["next_page_token"] = input.pageToken;
  const j = await api(ctx, { path: `/users/${host(hostEmail)}/recordings`, query });
  const next = strOrUndef(j["next_page_token"]);
  return {
    meetings: list(j["meetings"]).map(obj).map((m) => ({ meetingId: text(m["id"]), uuid: text(m["uuid"]), topic: text(m["topic"]), startTime: ms(m["start_time"]) ?? 0, files: list(m["recording_files"]).map(obj).map(fileOut) })),
    ...(next ? { nextPageToken: next } : {}),
  };
}

export async function recordingsGet(ctx: ZoomCtx, input: { meetingId: string }) {
  ensure(ctx);
  const j = await api(ctx, { path: `/meetings/${meetingIdOf(ctx, input.meetingId)}/recordings` });
  const share = strOrUndef(j["share_url"]);
  return { files: list(j["recording_files"]).map(obj).map(fileOut), ...(share ? { shareUrl: share } : {}) };
}

const MEDIA: Record<string, { ext: string; mime: string; kind: string }> = {
  MP4: { ext: "mp4", mime: "video/mp4", kind: "video" }, M4A: { ext: "m4a", mime: "audio/mp4", kind: "audio" }, TRANSCRIPT: { ext: "vtt", mime: "text/vtt", kind: "text" },
  CC: { ext: "vtt", mime: "text/vtt", kind: "text" }, CHAT: { ext: "txt", mime: "text/plain", kind: "text" }, TIMELINE: { ext: "json", mime: "application/json", kind: "text" },
};

export async function recordingsDownload(ctx: ZoomCtx, input: { meetingId: string; recordingFileId: string; folderId?: string }) {
  ensure(ctx);
  const meetingId = meetingIdOf(ctx, input.meetingId);
  if (typeof input.recordingFileId !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(input.recordingFileId)) bad(ctx, "The recording file id is not valid.");
  if (input.folderId !== undefined && !/^fld_[a-z0-9]+$/.test(input.folderId)) bad(ctx, "The folder id is not valid.");
  const done = first(ctx.db.all(`SELECT * FROM zoom_download WHERE "recordingFileId" = ?`, input.recordingFileId));
  if (done) return { runId: text(done["runId"]) };
  const runId = text(obj(await ctx.call("runs.start", {
    kind: "other", name: "Download a Zoom recording", owner: ctx.principal.id, subject: { type: "space", id: ctx.space }, idempotencyKey: `zoom_recording_download:${meetingId}:${input.recordingFileId}`,
  }))["runId"]);
  try {
    const meta = obj(await api(ctx, { path: `/meetings/${meetingId}/recordings` }));
    const f = list(meta["recording_files"]).map(obj).find((x) => text(x["id"]) === input.recordingFileId);
    if (!f) throw fail("validation.not_found", ctx.trace.traceId, { message: "That recording file is not on this Zoom meeting." });
    const url = text(f["download_url"]);
    if (!/^https:\/\/([a-z0-9-]+\.)*zoom\.us\//.test(url)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Zoom gave no download address for that file." });
    const type = MEDIA[text(f["file_type"]).toUpperCase()] ?? { ext: "bin", mime: "application/octet-stream", kind: "other" };
    const blob = await needHost(ctx).download(ctx, { url, bearer: await accessToken(ctx), mime: type.mime });
    let folderId = input.folderId;
    if (!folderId) {
      const personal = list(obj(await ctx.call("files.tree", {}))["roots"]).map(obj).find((r) => r["key"] === "personal" && typeof r["folderId"] === "string");
      folderId = text(personal?.["folderId"]) || undefined;
      if (!folderId) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "There is no folder to save the recording in." });
    }
    const day = (ms(meta["start_time"]) !== undefined ? new Date(ms(meta["start_time"]) as number) : new Date(ctx.now())).toISOString().slice(0, 10);
    const topic = text(meta["topic"]).replace(/[\\/\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "Zoom meeting";
    const made = obj(obj(await ctx.call("files.create", {
      folderId, name: `${day} ${topic} ${text(f["recording_type"]) || text(f["file_type"])} ${input.recordingFileId.slice(-6)}.${type.ext}`.replace(/\s+/g, " "),
      content: { blobId: blob.blobId }, mime: type.mime, kind: type.kind, idempotencyKey: `zoom:rec:${input.recordingFileId}`,
    }))["file"]);
    const fileId = text(made["fileId"]);
    if (!/^fil_[a-z0-9]+$/.test(fileId)) throw fail("internal.unexpected", ctx.trace.traceId, { message: "The recording was not saved to Files." });
    ctx.db.run(`INSERT OR IGNORE INTO zoom_download ("recordingFileId", "meetingId", "fileId", "runId", "at") VALUES (?, ?, ?, ?, ?)`, input.recordingFileId, meetingId, fileId, runId, ctx.now());
    await ctx.call("runs.finish", { runId, status: "succeeded", summary: `file:${fileId}` });
    return { runId };
  } catch (e) {
    await ctx.call("runs.finish", { runId, status: "failed", error: { code: codeOf(e) || "internal.unexpected", message: (e as { error?: { message?: string } } | null)?.error?.message ?? "The recording could not be downloaded." } });
    throw e;
  }
}

export async function transcriptsGet(ctx: ZoomCtx, input: { meetingId: string }) {
  ensure(ctx);
  const meetingId = meetingIdOf(ctx, input.meetingId);
  const meta = obj(await api(ctx, { path: `/meetings/${meetingId}/recordings` }));
  const f = list(meta["recording_files"]).map(obj).find((x) => text(x["file_type"]).toUpperCase() === "TRANSCRIPT" || text(x["recording_type"]) === "audio_transcript");
  const url = text(f?.["download_url"]);
  if (!f || !/^https:\/\/([a-z0-9-]+\.)*zoom\.us\//.test(url)) throw fail("validation.not_found", ctx.trace.traceId, { message: "Zoom has no transcript for this meeting." });
  const res = await ctx.http(url, { headers: { authorization: `Bearer ${await accessToken(ctx)}` } });
  if (res.status >= 300) throw res.status === 404 ? fail("validation.not_found", ctx.trace.traceId, { message: "Zoom has no transcript for this meeting." }) : fail("provider.unavailable", ctx.trace.traceId, { message: "Zoom did not hand over the transcript." });
  const vtt = await res.text();
  if (!vtt.trim()) throw fail("validation.not_found", ctx.trace.traceId, { message: "Zoom has no transcript for this meeting." });
  return { vtt, ...(strOrUndef(f["language"]) ? { language: text(f["language"]) } : {}) };
}

// ---- the account

export async function usersMe(ctx: ZoomCtx) {
  ensure(ctx);
  const j = await api(ctx, { path: "/users/me" });
  const email = text(j["email"]);
  if (!text(j["id"]) || !EMAIL.test(email)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Zoom did not describe the account user." });
  return { id: text(j["id"]), email, ...(strOrUndef(j["account_id"]) ? { accountId: text(j["account_id"]) } : {}) };
}

export async function health(ctx: ZoomCtx) {
  ensure(ctx);
  const started = Date.now();
  try {
    await usersMe(ctx);
  } catch (e) {
    const code = codeOf(e);
    const detail = code === "provider.auth_failed" ? "Zoom does not accept the account. Check the Zoom_S2S item in the Vault and that the Zoom app is activated."
      : code === "provider.unavailable" || code === "provider.network" ? "Zoom is not answering right now." : "The Zoom check failed.";
    return { state: code === "provider.rate_limited" ? ("degraded" as const) : ("down" as const), detail, latencyMs: Date.now() - started };
  }
  return { state: "healthy" as const, latencyMs: Date.now() - started };
}

