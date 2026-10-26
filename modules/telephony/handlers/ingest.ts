// The inbound pipeline of telephony (spec 2.18 Calls and SMS, Call routing and recording; 3.3 flow 3): what the twilio connector hands over after the signature check and dedupe.
//   ingest_voice      lands a call and answers with the instruction for the number: who rings, for how long, voicemail, reject, whether to record and say so.
//   ingest_sms        lands a text; STOP and the other opt-out words suppress the sender (contacts.apply_optout) and the text is linked to the contact's conversation.
//   ingest_status     applies a call or text status callback: answered, ended, missed, delivered, undelivered, failed.
//   ingest_recording  downloads a finished recording or voicemail into Files and attaches it to the call.
// DECISION: a hook for a Sid the module already knows is a replay: the stored call is answered again and nothing is landed twice. A hook for a call this Space placed (dial) finds it by its Sid and rings the dialer.
// DECISION: a number that is not in this Space, or was released, refuses the hook (validation.not_found); Twilio then plays its own error rather than ringing a stranger.
// DECISION: texts with pictures are stored without them: the pictures live behind Twilio's address and need its credentials, which only the twilio module holds.
// DECISION: a call that could not ring anyone and was not sent to voicemail is `missed` at once; one sent to voicemail stays `voicemail` until the recording arrives or the caller hangs up.
import { fail } from "../../../host/src/routes/errors.ts";
import { codeOf, bad, callMeta, DEFAULT_HOURS, DEFAULT_ROUTE, ensure, first, getState, list, liveCall, localTime, newId, num, numberByE164, numOrNull, obj, parseJson, patch, phone, rowsOf, setMeta, setState, setting, str, strOrNull, strOrUndef, text, refuse } from "../projections.ts";
import type { HoursCfg, Json, Party, Row, RouteCfg, TelCtx } from "../projections.ts";
import { eventBase, finishCall, linkCall } from "./calls.ts";
import { insertSms } from "./sms.ts";

const ANNOUNCEMENT = "This call may be recorded.";
const GREETING = "Please leave a message after the tone.";
const DEFAULT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const stringsOk = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const live = (r: Row): boolean => r.deleted_at === null || r.deleted_at === undefined;
const pad = (n: number): string => String(n).padStart(2, "0");

export interface Instruction { action: "ring" | "voicemail" | "reject" | "agent"; targets: Party[]; ringSeconds?: number; greeting?: string; record: boolean; announcement?: string }

/** Are we inside the hours of the number? A number with no hours listed is always open. */
export function hoursOpen(h: HoursCfg, now: number): boolean {
  if (h.weekly.length === 0) return true;
  const t = localTime(now, h.zone);
  const hm = `${pad(t.hour)}:${pad(t.minute)}`;
  return h.weekly.some((w) => w.day === t.day && w.start <= hm && hm < w.end);
}

/** Groups become their people and agents; a group that is gone rings nobody. */
async function expand(ctx: TelCtx, parties: Party[]): Promise<Party[]> {
  const out: Party[] = [];
  const add = (p: Party): void => {
    if (!out.some((o) => o.kind === p.kind && o.id === p.id)) out.push(p);
  };
  for (const p of parties) {
    if (p.kind !== "group") { add(p); continue; }
    try {
      const members = list(obj(obj(await ctx.call("access.groups.get", { groupId: p.id })).group).members).map(obj);
      for (const m of members) if (m.kind === "person" || m.kind === "agent") add({ kind: m.kind, id: text(m.id) });
    } catch (e) {
      if (codeOf(e) !== "validation.not_found") throw e;
    }
  }
  return out;
}

function ringTargets(n: Row, route: RouteCfg): Party[] {
  if (route.ring.length > 0) return route.ring;
  const kind = str(n, "assigneeKind");
  return kind === "person" || kind === "agent" ? [{ kind, id: str(n, "assigneeId") }] : [];
}

async function instructionFor(ctx: TelCtx, n: Row, o: { record: boolean }): Promise<Instruction> {
  const route: RouteCfg = { ...DEFAULT_ROUTE, ...parseJson<Partial<RouteCfg>>(n.route, {}) };
  const hours: HoursCfg = { ...DEFAULT_HOURS, ...parseJson<Partial<HoursCfg>>(n.hours, {}) };
  const voicemail = (): Instruction => (route.voicemail ? { action: "voicemail", targets: [], greeting: GREETING, record: true } : { action: "reject", targets: [], record: false });
  if (str(n, "state") !== "active") return { action: "reject", targets: [], record: false };
  const open = hoursOpen(hours, ctx.now());
  if (!open && hours.outsideHours === "reject") return { action: "reject", targets: [], record: false };
  if (!open && hours.outsideHours === "voicemail") return voicemail();
  const targets = await expand(ctx, ringTargets(n, route));
  if (targets.length === 0) return voicemail();
  const announce = o.record && str(n, "recording") === "announce";
  return {
    action: targets.every((t) => t.kind === "agent") ? "agent" : "ring", targets, ringSeconds: route.ringSeconds, record: announce,
    ...(announce ? { announcement: ANNOUNCEMENT } : {}),
  };
}

const numberBySid = (ctx: TelCtx, table: string, sid: string): Row | null => rowsOf(ctx.db.all(`SELECT * FROM ${table} WHERE "twilioSid" = ?`, sid)).find(live) ?? null;

// ---- ingest_voice

export async function ingestVoice(ctx: TelCtx, input: { callSid: string; from: string; to: string; status: string; callerName?: string; forwardedFrom?: string }) {
  ensure(ctx);
  if (typeof input.callSid !== "string" || input.callSid === "") bad(ctx, "A call names its Sid.");
  if (typeof input.from !== "string" || input.from === "") bad(ctx, "A call names who is calling.");
  const to = phone(ctx, input.to, "The number called");
  const n = numberByE164(ctx, to);
  const seen = numberBySid(ctx, "telephony_call", input.callSid);

  // a call this Space placed (dial): the hook is the far end answering; ring the dialer
  if (seen && str(seen, "direction") === "out") {
    const dialer = parseJson<Party | null>(seen.handledBy, null);
    const callNumber = first(ctx.db.all(`SELECT * FROM telephony_number WHERE id = ?`, str(seen, "numberId")));
    const meta = callMeta(ctx, str(seen, "id"));
    const announce = num(meta, "recording") === 1 && callNumber !== null && str(callNumber, "recording") === "announce";
    const route: RouteCfg = { ...DEFAULT_ROUTE, ...parseJson<Partial<RouteCfg>>(callNumber?.route, {}) };
    const instruction: Instruction = dialer
      ? { action: dialer.kind === "agent" ? "agent" : "ring", targets: [dialer], ringSeconds: route.ringSeconds, record: announce, ...(announce ? { announcement: ANNOUNCEMENT } : {}) }
      : { action: "reject", targets: [], record: false };
    return { callId: str(seen, "id"), instruction };
  }
  if (!n || str(n, "state") !== "active") throw fail("validation.not_found", ctx.trace.traceId, { message: "That number is not in this Space." });
  if (seen) return { callId: str(seen, "id"), instruction: await instructionFor(ctx, n, { record: true }) };

  const now = ctx.now();
  const id = newId("cal", now);
  ctx.db.run(
    `INSERT INTO telephony_call ("id", "numberId", "direction", "from", "to", "state", "startedAt", "consentLogged", "twilioSid", "traceId", "version", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(n, "id"), "in", input.from, to, "ringing", now, 0, input.callSid, ctx.trace.traceId, 0, now,
  );
  const row = liveCall(ctx, id);
  await linkCall(ctx, row, input.from, input.callerName ? `Call from ${input.callerName}` : "Incoming call");
  const contactId = strOrNull(liveCall(ctx, id), "contactId") ?? undefined;
  const instruction = await instructionFor(ctx, n, { record: true });
  if ((instruction.action === "ring" || instruction.action === "agent") && instruction.record) {
    patch(ctx, "telephony_call", id, { consentLogged: 1 });
    setMeta(ctx, id, { recording: 1, consent: JSON.stringify({ policy: "announce", announced: true, at: now }) });
  }
  if (instruction.action === "ring" || instruction.action === "agent") {
    setMeta(ctx, id, { ringing: JSON.stringify(instruction.targets) });
    ctx.emit("call.ringing", `entity/${id}`, { callId: id, numberId: str(n, "id"), from: input.from, ...(contactId ? { contactId } : {}), ringing: instruction.targets }, { vis: "participants" });
  } else if (instruction.action === "voicemail") {
    patch(ctx, "telephony_call", id, { state: "voicemail" });
  } else {
    finishCall(ctx, liveCall(ctx, id), { state: "missed", durationSec: 0, announce: true });
  }
  return { callId: id, instruction };
}

// ---- ingest_sms

export async function ingestSms(ctx: TelCtx, input: { messageSid: string; from: string; to: string; body: string; mediaUrls?: string[]; at: number }) {
  ensure(ctx);
  if (typeof input.messageSid !== "string" || input.messageSid === "") bad(ctx, "A text names its Sid.");
  const from = phone(ctx, input.from, "The sender");
  const to = phone(ctx, input.to, "The number texted");
  if (typeof input.body !== "string") bad(ctx, "A text has a body.");
  if (!Number.isSafeInteger(input.at)) bad(ctx, "A text has the time it arrived.");
  const keywords = await setting<string[]>(ctx, "contacts.optout_keywords", DEFAULT_KEYWORDS, stringsOk);
  const word = input.body.trim().toUpperCase();
  const optOut = keywords.some((k) => k.trim().toUpperCase() === word);

  const seen = numberBySid(ctx, "telephony_sms", input.messageSid);
  if (seen) return smsAnswer(str(seen, "id"), optOut, strOrUndef(seen.contactId));
  const n = numberByE164(ctx, to);
  if (!n || str(n, "state") !== "active") throw fail("validation.not_found", ctx.trace.traceId, { message: "That number is not in this Space." });

  const id = newId("sms", ctx.now());
  insertSms(ctx, id, { n, input: { to, body: input.body }, contactId: undefined, status: "received", at: input.at, direction: "in" });
  // the row says who sent it: from is the sender here, to is the Space's number
  ctx.db.run(`UPDATE telephony_sms SET "from" = ?, "twilioSid" = ? WHERE id = ?`, from, input.messageSid, id);
  let contactId: string | undefined;
  if (optOut) {
    contactId = strOrUndef(obj(await ctx.call("contacts.apply_optout", { channel: "sms", address: from, keyword: word, source: "sms_stop", at: input.at })).contactId);
  }
  const link = obj(await ctx.call("inbox.link_message", {
    channel: "sms", ref: { kind: "sms", id }, address: from, direction: "in", at: input.at, numberId: str(n, "id"), preview: input.body.slice(0, 140),
  }));
  contactId = contactId ?? strOrUndef(link.contactId);
  if (contactId) patch(ctx, "telephony_sms", id, { contactId });
  ctx.emit("sms.received", `entity/${id}`, { smsId: id, numberId: str(n, "id"), from, ...(contactId ? { contactId } : {}), optOut });
  return smsAnswer(id, optOut, contactId, strOrUndef(link.conversationId));
}

const smsAnswer = (smsId: string, optOut: boolean, contactId?: string, conversationId?: string): Json => ({
  smsId, optOut, ...(contactId ? { contactId } : {}), ...(conversationId ? { conversationId } : {}),
});

// ---- ingest_status

/** A provider's callback has a trace of its own, but a call is one piece of work: when the call row knows the trace of the dial that placed it, the callback is applied again on that trace, so its events follow the call end to end. A call the Space did not place keeps the callback's own trace. */
async function onCallTrace(ctx: TelCtx, sid: string, cap: string, input: unknown): Promise<unknown | undefined> {
  const row = numberBySid(ctx, "telephony_call", sid);
  const own = row ? strOrNull(row, "traceId") : null;
  if (!own || own === ctx.trace.traceId) return undefined;
  return ctx.call(cap, input, { traceId: own });
}

const CALL_RANK: Record<string, number> = { ringing: 0, answered: 1, voicemail: 1, completed: 2, missed: 2, failed: 2 };
const SMS_RANK: Record<string, number> = { queued: 0, sent: 1, received: 1, delivered: 2, undelivered: 2, failed: 2 };
/** Errors that mean the number cannot be reached at all: unknown destination, landline, blocked by the carrier, unreachable. */
const HARD = new Set(["30003", "30004", "30005", "30006", "21211", "21614"]);

export async function ingestStatus(ctx: TelCtx, input: { sid: string; kind: string; status: string; errorCode?: string; durationSec?: number; at: number }) {
  ensure(ctx);
  if (typeof input.sid !== "string" || input.sid === "") bad(ctx, "A status names its Sid.");
  if (input.kind !== "call" && input.kind !== "sms") bad(ctx, "A status is for a call or a text.");
  if (typeof input.status !== "string" || input.status === "") bad(ctx, "A status names the status.");
  const status = input.status.toLowerCase();
  if (input.kind === "call") {
    const again = await onCallTrace(ctx, input.sid, "telephony.ingest_status", input);
    if (again) return again as { applied: boolean };
  }
  if (input.kind === "call") return { applied: await applyCall(ctx, input.sid, status, input.durationSec, input.at) };
  return { applied: await applySms(ctx, input.sid, status, input.errorCode) };
}

async function applyCall(ctx: TelCtx, sid: string, status: string, durationSec: number | undefined, at: number): Promise<boolean> {
  const row = numberBySid(ctx, "telephony_call", sid);
  if (!row) return false;
  const state = str(row, "state");
  const inbound = str(row, "direction") === "in";
  const finalState = (s: string): boolean => (CALL_RANK[s] ?? 0) >= 2;
  if (status === "in-progress" || status === "answered") {
    if (state !== "ringing" || numOrNull(row, "answeredAt") !== null) return true;
    // an inbound call is answered by a person through telephony.answer; an outbound one connects when the far end picks up
    if (inbound) return true;
    patch(ctx, "telephony_call", str(row, "id"), { state: "answered", answeredAt: at });
    ctx.emit("call.started", `entity/${str(row, "id")}`, eventBase(row));
    return true;
  }
  if (["queued", "initiated", "ringing"].includes(status)) return true;
  if (finalState(state)) return true;
  if (status === "completed") {
    const answered = numOrNull(row, "answeredAt") !== null;
    if (state === "voicemail") {
      patch(ctx, "telephony_call", str(row, "id"), { endedAt: at, ...(durationSec !== undefined ? { durationSec } : {}) });
    } else if (answered || !inbound) {
      finishCall(ctx, row, { state: "completed", ...(durationSec !== undefined ? { durationSec } : {}), announce: true });
    } else {
      finishCall(ctx, row, { state: "missed", durationSec: 0, announce: true });
    }
    return true;
  }
  if (status === "busy" || status === "no-answer" || status === "canceled") {
    if (inbound) finishCall(ctx, row, { state: state === "voicemail" ? "voicemail" : "missed", durationSec: 0, announce: state !== "voicemail" });
    else finishCall(ctx, row, { state: "failed", durationSec: 0, announce: false });
    return true;
  }
  if (status === "failed") {
    finishCall(ctx, row, { state: "failed", durationSec: 0, announce: false });
    return true;
  }
  return false;
}

async function applySms(ctx: TelCtx, sid: string, status: string, errorCode: string | undefined): Promise<boolean> {
  const row = numberBySid(ctx, "telephony_sms", sid);
  if (!row || str(row, "direction") !== "out") return false;
  const id = str(row, "id");
  const next = status === "delivered" || status === "read" ? "delivered" : status === "undelivered" ? "undelivered" : status === "failed" ? "failed" : status === "sent" ? "sent" : status === "queued" || status === "accepted" || status === "sending" ? "queued" : null;
  if (next === null) return false;
  const have = str(row, "status");
  if ((SMS_RANK[next] ?? 0) <= (SMS_RANK[have] ?? 0) && next !== have) return true;   // a late "sent" never undoes "delivered"
  if (next === have) return true;
  patch(ctx, "telephony_sms", id, { status: next });
  if (next === "delivered") ctx.emit("message.delivered", `entity/${id}`, { messageId: id, channel: "sms" });
  else if (next === "undelivered") {
    const kind = errorCode !== undefined && HARD.has(errorCode) ? "hard" : "soft";
    ctx.emit("message.bounced", `entity/${id}`, { messageId: id, channel: "sms", address: str(row, "to"), kind, ...(errorCode ? { reason: errorCode } : {}) });
    if (kind === "hard") await ctx.call("contacts.suppression.add", { channel: "sms", addresses: [str(row, "to")], reason: "bounce_hard", source: "telephony.status", note: `Twilio error ${errorCode}` });
  } else if (next === "failed") ctx.emit("message.failed", `entity/${id}`, { messageId: id, channel: "sms", reason: errorCode ?? "failed" });
  return true;
}

// ---- ingest_recording

/** The Files folder recordings are kept in: Calls, inside the shared knowledge folder; made on first use. */
async function callsFolder(ctx: TelCtx): Promise<string> {
  const cached = getState(ctx, "recordings_folder");
  if (cached) return cached;
  const tree = obj(await ctx.call("files.tree", {}));
  const roots = list(tree.roots).map(obj).filter((r) => r.kind === "folder" && typeof r.folderId === "string");
  const root = roots.find((r) => r.key === "shared_knowledge") ?? roots.find((r) => r.key === "knowledge") ?? roots[0];
  if (!root) return refuse(ctx, "There is no Files folder to keep recordings in.");
  let folderId: string;
  try {
    folderId = text(obj(obj(await ctx.call("files.folder.create", { parentId: text(root.folderId), name: "Calls", idempotencyKey: "tel:calls-folder" })).folder).folderId);
  } catch (e) {
    if (codeOf(e) !== "validation.duplicate") throw e;
    folderId = text(obj(await ctx.call("files.resolve", { path: `${text(root.title)}/Calls` })).folderId);
  }
  if (folderId === "") throw fail("internal.unexpected", ctx.trace.traceId, { message: "The Calls folder could not be found." });
  setState(ctx, "recordings_folder", folderId);
  return folderId;
}

export async function ingestRecording(ctx: TelCtx, input: { callSid: string; recordingSid: string; url: string; durationSec?: number }) {
  ensure(ctx);
  const again = typeof input.callSid === "string" && input.callSid !== "" ? await onCallTrace(ctx, input.callSid, "telephony.ingest_recording", input) : undefined;
  if (again) return again as { callId: string; fileId: string };
  if (typeof input.callSid !== "string" || input.callSid === "") bad(ctx, "A recording names its call.");
  if (typeof input.recordingSid !== "string" || input.recordingSid === "") bad(ctx, "A recording names its Sid.");
  if (typeof input.url !== "string" || !/^https:\/\/\S+$/.test(input.url)) bad(ctx, "A recording has an https address.");
  const row = numberBySid(ctx, "telephony_call", input.callSid);
  if (!row) throw fail("validation.not_found", ctx.trace.traceId, { message: "That recording belongs to a call this Space does not know." });
  const id = str(row, "id");
  const meta = callMeta(ctx, id);
  if (str(meta, "ingestedSid") === input.recordingSid && strOrNull(row, "recordingFileId")) return { callId: id, fileId: str(row, "recordingFileId") };

  const got = obj(await ctx.call("twilio.recording.download", { recordingSid: input.recordingSid }));
  const voicemail = numOrNull(row, "answeredAt") === null && str(row, "direction") === "in";
  const when = new Date(num(row, "startedAt")).toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  const made = obj(obj(await ctx.call("files.create", {
    folderId: await callsFolder(ctx), name: `${voicemail ? "Voicemail" : "Call"} ${when} ${str(row, str(row, "direction") === "in" ? "from" : "to")} ${input.recordingSid.slice(-6)}.mp3`,
    content: { blobId: text(got.blobId) }, mime: "audio/mpeg", kind: "audio", idempotencyKey: `tel:rec:${input.recordingSid}`,
  })).file);
  const fileId = text(made.fileId);
  if (fileId === "") throw fail("internal.unexpected", ctx.trace.traceId, { message: "The recording was not saved to Files." });
  patch(ctx, "telephony_call", id, { recordingFileId: fileId, ...(voicemail ? { state: "voicemail" } : {}) });
  setMeta(ctx, id, { ingestedSid: input.recordingSid });
  const base = eventBase(row);
  if (voicemail) ctx.emit("call.voicemail_left", `entity/${id}`, { callId: id, numberId: base.numberId, ...(base.contactId ? { contactId: base.contactId } : {}) });
  ctx.emit("call.recording_ready", `entity/${id}`, { callId: id, fileId });
  return { callId: id, fileId };
}

