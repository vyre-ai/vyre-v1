// recording, screenshots, the live view source and the session timeline of an agent computer (spec 2.7): record while you take over, what to do with a recording, a picture of the screen,
// a ticket for the live view, a frame per step, and a skill from a step.
// A recording is a folder under the agent's Files folder (work/recordings/<id>/{events.jsonl,network.har,video.mp4}). The host (agentd) writes the video; the events and the network log pass
// through here first, so a password typed, an Authorization header or a token in a request body never reaches disk, and neither does any value the computer filled from the Vault.
import {
  actorOf, addStep, agentFolder, clean, ensure, hostOf, mintId, mintTicket, needComputer, needTeam, raise, recordingBy, recordingFiles, recordingOf, recordingOut, rowsOf, setComputer, stepOf, stepOut,
} from "../projections.ts";
import type { CompCtx, ComputerHost, ComputerRow, RecordingRow, RecordResult } from "../projections.ts";

const pageOf = <T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } => {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  return { page: items.slice(start, start + size), ...(start + size < items.length ? { next: String(start + size) } : {}), total: items.length };
};

// ---- masking

export const MASK = "[masked]";
/** Names of things a recording must never keep the value of. */
const SENSITIVE = /pass(word|wd|phrase|code)?\b|secret|token|api[-_ ]?key|auth|otp|cvv|cvc|card[-_ ]?(number|no)?|ssn|session|cookie|credential|signature/i;
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;

/** A JSON value with the value of every sensitive key replaced, at any depth. */
export function maskValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SENSITIVE.test(k) && (typeof x === "string" || typeof x === "number") ? MASK : maskValue(x);
    return out;
  }
  return v;
}

/** A request or response body: JSON by key, a form by field, anything else as it is (the known-secret scrub runs over the whole file afterwards). */
function maskBody(text: string, mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("json") || /^\s*[{[]/.test(text)) {
    try { return JSON.stringify(maskValue(JSON.parse(text))); } catch { /* not JSON after all */ }
  }
  if (m.includes("x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    for (const k of [...params.keys()]) if (SENSITIVE.test(k)) params.set(k, MASK);
    return params.toString();
  }
  return text;
}

interface HarHeader { name?: string; value?: string }
const maskHeaders = (h: unknown): unknown => (Array.isArray(h) ? (h as HarHeader[]).map((x) => (typeof x.name === "string" && SENSITIVE_HEADERS.test(x.name) ? { ...x, value: MASK } : x)) : h);

/** The network log of a recording (HAR 1.2) with every credential and every sensitive body field masked. A log that cannot be read is replaced by an empty one rather than kept unmasked. */
export function maskHar(computerId: string, text: string): { text: string; readable: boolean } {
  let har: { log?: { entries?: Array<Record<string, any>> } };
  try { har = JSON.parse(text) as typeof har; } catch { return { text: JSON.stringify({ log: { version: "1.2", entries: [] } }), readable: false }; }
  for (const e of har.log?.entries ?? []) {
    const req = e["request"] as Record<string, any> | undefined;
    const res = e["response"] as Record<string, any> | undefined;
    if (req) {
      req["headers"] = maskHeaders(req["headers"]);
      if (Array.isArray(req["cookies"])) req["cookies"] = (req["cookies"] as Array<Record<string, unknown>>).map((c) => ({ ...c, value: MASK }));
      if (Array.isArray(req["queryString"])) req["queryString"] = (req["queryString"] as Array<{ name?: string; value?: string }>).map((q) => (typeof q.name === "string" && SENSITIVE.test(q.name) ? { ...q, value: MASK } : q));
      if (typeof req["url"] === "string") {
        try {
          const u = new URL(req["url"]);
          for (const k of [...u.searchParams.keys()]) if (SENSITIVE.test(k)) u.searchParams.set(k, MASK);
          req["url"] = u.toString().replace(/%5Bmasked%5D/gi, MASK);
        } catch { /* keep a URL that does not parse; the scrub below still runs */ }
      }
      const post = req["postData"] as Record<string, any> | undefined;
      if (post) {
        if (typeof post["text"] === "string") post["text"] = maskBody(post["text"], String(post["mimeType"] ?? ""));
        if (Array.isArray(post["params"])) post["params"] = (post["params"] as Array<{ name?: string; value?: string }>).map((q) => (typeof q.name === "string" && SENSITIVE.test(q.name) ? { ...q, value: MASK } : q));
      }
    }
    if (res) {
      res["headers"] = maskHeaders(res["headers"]);
      if (Array.isArray(res["cookies"])) res["cookies"] = (res["cookies"] as Array<Record<string, unknown>>).map((c) => ({ ...c, value: MASK }));
      const content = res["content"] as Record<string, any> | undefined;
      if (content && typeof content["text"] === "string") content["text"] = maskBody(content["text"], String(content["mimeType"] ?? ""));
    }
  }
  return { text: clean(computerId, JSON.stringify(har)), readable: true };
}

/** The recorded clicks and keys, one JSON object per line. What is typed into a password field, or a field named like a secret, is masked; known Vault values are scrubbed from every line. */
export function maskEvents(computerId: string, jsonl: string): string {
  const out: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let kept = line;
    try {
      const ev = JSON.parse(line) as Record<string, any>;
      const el = (ev["element"] ?? {}) as Record<string, unknown>;
      const hidden = [el["type"], el["autocomplete"], el["name"], el["id"], el["label"], el["ariaLabel"], el["placeholder"]].some((x) => typeof x === "string" && (x === "password" || SENSITIVE.test(x)));
      if (hidden) for (const k of ["text", "key", "value", "data"]) if (typeof ev[k] === "string") ev[k] = MASK;
      kept = JSON.stringify(maskValue(ev));
    } catch { /* a line that is not JSON is kept only after the scrub */ }
    out.push(clean(computerId, kept));
  }
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

// ---- record

const minutesOf = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
};

export async function recordStart(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const me = actorOf(ctx);
  const c = needComputer(ctx, input.computerId);
  if (c.state !== "takeover") raise(ctx, "validation.precondition_failed", "Take over the computer to record.");
  if (c.takeoverBy !== me) raise(ctx, "validation.precondition_failed", "Only the person at the controls can record.", { takeoverBy: c.takeoverBy });
  if (c.recordingId) raise(ctx, "validation.precondition_failed", "A recording is already running.", { recordingId: c.recordingId });
  const recordingId = mintId("rcd", ctx.now());
  const folderPath = `work/recordings/${recordingId}`;
  try {
    await hostOf(ctx).record({ computerId: c.computerId, recordingId, action: "start" });
  } catch {
    raise(ctx, "internal.unexpected", "The computer could not start recording. Try again.");
  }
  ctx.db.run(
    "INSERT INTO computers_recordings (recording_id, computer_id, agent_id, started_at, ended_at, duration_ms, folder_path, state, intents, by_person, task_id) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'recording', '[]', ?, NULL)",
    recordingId, c.computerId, c.agentId, ctx.now(), folderPath, me,
  );
  setComputer(ctx.db, c.computerId, { recording_id: recordingId });
  ctx.emit("computer.recording_started", c.computerId, { computerId: c.computerId, personId: me, recordingId });
  return { recordingId };
}

/** Stop the recording of a computer, mask what it captured, save it and add the step. Also used when the controls are given back with a recording still running. */
export async function finishRecording(ctx: CompCtx, c: ComputerRow): Promise<RecordingRow> {
  const id = c.recordingId;
  const rec = id ? recordingBy(ctx.db, id) : null;
  if (!id || !rec) raise(ctx, "validation.bad_input", "No recording is running on this computer.");
  const host = hostOf(ctx);
  let got: RecordResult;
  try {
    got = await host.record({ computerId: c.computerId, recordingId: id, action: "stop" });
  } catch {
    raise(ctx, "internal.unexpected", "The computer could not stop recording. Try again.");
  }
  const events = maskEvents(c.computerId, got.events ?? "");
  const har = maskHar(c.computerId, got.har ?? JSON.stringify({ log: { version: "1.2", entries: [] } }));
  if (!har.readable) ctx.log.warn("the network log of a recording could not be read and was not kept", { recordingId: id });
  try {
    await host.saveRecording({ computerId: c.computerId, recordingId: id, folderPath: rec.folderPath, events, har: har.text });
  } catch {
    raise(ctx, "internal.unexpected", "The recording could not be saved. Try again.");
  }
  const now = ctx.now();
  const durationMs = got.durationMs ?? Math.max(0, now - rec.startedAt);
  ctx.db.run("UPDATE computers_recordings SET state = 'saved', ended_at = ?, duration_ms = ? WHERE recording_id = ?", now, durationMs, id);
  setComputer(ctx.db, c.computerId, { recording_id: null });
  addStep(ctx.db, c.computerId, now, { by: "person", caption: `You recorded ${minutesOf(durationMs)}`, tool: "record" });
  ctx.emit("computer.recording_saved", c.computerId, { computerId: c.computerId, recordingId: id, durationMs });
  return recordingBy(ctx.db, id) ?? rec;
}

export async function recordStop(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  if (!c.recordingId) raise(ctx, "validation.bad_input", "No recording is running on this computer.");
  const me = actorOf(ctx);
  if (c.takeoverBy !== me && ctx.authorize({ perm: "computers.use", level: "manage" }, { type: "computer", id: c.computerId }).effect !== "allow") {
    raise(ctx, "permission.no_grant", "Only the person at the controls, or someone who manages computers, can stop the recording.");
  }
  return { recording: recordingOut(await finishRecording(ctx, c)) };
}

// ---- recordings

/** A recording follows the access of the agent's folder it is stored in. */
async function mayOpen(ctx: CompCtx, agentId: string): Promise<void> {
  const folder = await agentFolder(ctx, agentId);
  if (folder && ctx.authorize({ perm: null, level: "view" }, { type: "folder", id: folder }).effect !== "allow") raise(ctx, "permission.no_grant", "You cannot open this agent's recordings.");
}

export async function recordingsList(ctx: CompCtx, input: { computerId: string; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  await mayOpen(ctx, c.agentId);
  const rows = rowsOf(ctx.db, "SELECT * FROM computers_recordings WHERE computer_id = ? ORDER BY started_at DESC, recording_id", c.computerId).map(recordingOf);
  const p = pageOf(rows, input.cursor, input.limit);
  return { recordings: p.page.map(recordingOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

function needRecording(ctx: CompCtx, recordingId: string): RecordingRow {
  const r = recordingBy(ctx.db, recordingId);
  if (!r) raise(ctx, "validation.bad_input", "There is no such recording.", { recordingId });
  return r;
}

export async function recordingGet(ctx: CompCtx, input: { recordingId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const r = needRecording(ctx, input.recordingId);
  await mayOpen(ctx, r.agentId);
  return { recording: recordingOut(r), ...recordingFiles(r.folderPath) };
}

const INTENT_LINE: Readonly<Record<string, string>> = {
  make_skill: "Make a skill from it.",
  learn_routine: "Learn a routine from it: the steps, to replay.",
  work_out_backend_calls: "Work out the app's backend calls from the network log and keep them as a site recipe note.",
  learn_workflow: "Learn this person's workflow in this app and repeat it as it is.",
};
const INTENT_TITLE: Readonly<Record<string, string>> = {
  make_skill: "Make a skill from a recording", learn_routine: "Learn a routine from a recording", work_out_backend_calls: "Work out an app's backend calls from a recording", learn_workflow: "Learn a workflow from a recording",
};

export async function recordingProcess(ctx: CompCtx, input: { recordingId: string; intents: string[]; idempotencyKey: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const r = needRecording(ctx, input.recordingId);
  await mayOpen(ctx, r.agentId);
  if (r.state === "recording") raise(ctx, "validation.bad_input", "The recording is still running.");
  const intents = [...new Set(input.intents)];
  if (intents.length === 0) raise(ctx, "validation.bad_input", "Say what the agent should do with the recording.");
  const files = recordingFiles(r.folderPath);
  const summary = [`The recording is in ${r.folderPath}: events in ${files.eventsPath}, the network log in ${files.harPath}, the video in ${files.videoPath}.`, ...intents.map((i) => INTENT_LINE[i] ?? i)].join("\n");
  let taskId: string;
  try {
    const out = (await ctx.call("tasks.create", {
      title: intents.length === 1 ? INTENT_TITLE[intents[0]!] ?? "Learn from a recording" : "Learn from a recording", assigned: { id: r.agentId, kind: "agent" }, kind: "work", summary,
      source: { kind: "manual", id: r.recordingId }, idempotencyKey: input.idempotencyKey,
    })) as { task?: { id?: string } };
    if (!out.task?.id) throw new Error("no task");
    taskId = out.task.id;
  } catch {
    raise(ctx, "internal.unexpected", "The task for the agent could not be created. Nothing was changed.");
  }
  ctx.db.run("UPDATE computers_recordings SET state = 'processed', intents = ?, task_id = ? WHERE recording_id = ?", JSON.stringify(intents), taskId, r.recordingId);
  ctx.emit("computer.recording_processed", r.recordingId, { recordingId: r.recordingId, intents, taskId });
  return { taskId };
}

export async function recordingDelete(ctx: CompCtx, input: { recordingId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const r = recordingBy(ctx.db, input.recordingId);
  if (!r) return { deleted: false };
  await mayOpen(ctx, r.agentId);
  if (r.state === "recording") raise(ctx, "validation.bad_input", "The recording is still running.");
  try {
    await hostOf(ctx).removeRecording({ computerId: r.computerId, recordingId: r.recordingId, folderPath: r.folderPath });
  } catch {
    raise(ctx, "internal.unexpected", "The recording could not be deleted. Try again.");
  }
  ctx.db.run("DELETE FROM computers_recordings WHERE recording_id = ?", r.recordingId);
  return { deleted: true };
}

// ---- screenshot, live view

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function screenshot(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  if (c.state !== "working" && c.state !== "takeover") raise(ctx, "validation.bad_input", "The computer is asleep. Wake it to take a picture.");
  const folderId = await agentFolder(ctx, c.agentId);
  if (!folderId) raise(ctx, "validation.bad_input", "The agent has no folder to keep the picture in.");
  let shot: Awaited<ReturnType<ComputerHost["screenshot"]>>;
  try {
    shot = await hostOf(ctx).screenshot(c.computerId);
  } catch {
    raise(ctx, "internal.unexpected", "The computer did not give a picture. Try again.");
  }
  const at = ctx.now();
  const made = (await ctx.call("files.create", {
    folderId, name: `screenshot-${new Date(at).toISOString().replace(/[:.]/g, "-")}.png`, kind: "image", mime: "image/png", content: { base64: base64(shot.bytes) }, idempotencyKey: `cmpshot:${c.computerId}:${at}`,
  })) as { file: { fileId: string } };
  setComputer(ctx.db, c.computerId, { last_frame_at: at, last_frame_file: made.file.fileId });
  return { fileId: made.file.fileId, width: shot.width, height: shot.height, at };
}

export async function stream(ctx: CompCtx, input: { computerId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  if (c.state !== "working" && c.state !== "takeover") raise(ctx, "validation.bad_input", "The computer is asleep. Wake it to watch it.");
  const t = await mintTicket(ctx.db, "stream", c.computerId, actorOf(ctx), ctx.now());
  let target: Awaited<ReturnType<ComputerHost["stream"]>>;
  try {
    target = await hostOf(ctx).stream({ computerId: c.computerId, ticket: t.ticket });
  } catch {
    raise(ctx, "internal.unexpected", "The live view could not be opened. Try again.");
  }
  return { transport: target.transport, url: target.url, ticket: t.ticket, expiresAt: t.expiresAt };
}

// ---- timeline

export async function timeline(ctx: CompCtx, input: { computerId: string; runId?: string; threadId?: string; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  const args: unknown[] = [c.computerId];
  let sql = "SELECT * FROM computers_timeline WHERE computer_id = ?";
  if (input.runId) { sql += " AND run_id = ?"; args.push(input.runId); }
  if (input.threadId) { sql += " AND thread_id = ?"; args.push(input.threadId); }
  sql += " ORDER BY idx";
  const p = pageOf(rowsOf(ctx.db, sql, ...args).map(stepOf), input.cursor, input.limit);
  return { steps: p.page.map(stepOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function timelineStep(ctx: CompCtx, input: { computerId: string; stepId: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  const r = rowsOf(ctx.db, "SELECT * FROM computers_timeline WHERE computer_id = ? AND step_id = ?", c.computerId, input.stepId)[0];
  if (!r) raise(ctx, "validation.not_found", "There is no such step.", { stepId: input.stepId });
  return { step: stepOut(stepOf(r)) };
}

export async function skillFromStep(ctx: CompCtx, input: { computerId: string; stepId: string; name?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  needTeam(ctx);
  const c = needComputer(ctx, input.computerId);
  const r = rowsOf(ctx.db, "SELECT * FROM computers_timeline WHERE computer_id = ? AND step_id = ?", c.computerId, input.stepId)[0];
  if (!r) raise(ctx, "validation.not_found", "There is no such step.", { stepId: input.stepId });
  const step = stepOf(r);
  const name = input.name?.trim();
  const prior = rowsOf(ctx.db, "SELECT caption, idx FROM computers_timeline WHERE computer_id = ? AND idx <= ? ORDER BY idx", c.computerId, step.idx).map((x) => `${Number(x["idx"]) + 1}. ${String(x["caption"])}`);
  let taskId: string;
  try {
    const out = (await ctx.call("tasks.create", {
      title: name ? `Make a skill: ${name}` : "Make a skill from a session", assigned: { id: c.agentId, kind: "agent" }, kind: "work",
      summary: `Write a skill into your folder from this point in the session on your computer, step ${step.idx + 1} (${step.caption}).\nWhat happened up to here:\n${prior.slice(-20).join("\n")}`,
      ...(step.frameFileId ? { fileIds: [step.frameFileId] } : {}), source: { kind: "manual", id: step.stepId }, idempotencyKey: input.idempotencyKey,
    })) as { task?: { id?: string } };
    if (!out.task?.id) throw new Error("no task");
    taskId = out.task.id;
  } catch {
    raise(ctx, "internal.unexpected", "The task for the agent could not be created. Nothing was changed.");
  }
  ctx.emit("computer.skill_requested", c.computerId, { computerId: c.computerId, stepId: step.stepId, taskId });
  return { taskId };
}
