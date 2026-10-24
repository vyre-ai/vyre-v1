// The Twilio hooks and the live side of calls and texts (spec 2.18; ARCH 8): the four webhooks (/hooks/twilio/voice, /sms, /status, /recording) with the request
// signature checked and every delivery applied once, the TwiML a call is answered with, the Voice JS access token, and the calls, recordings and texts placed
// through the account. Nothing here decides whether to call or text anyone: telephony applies consent, suppression, windows and the Gate before it calls these.
// DECISION: the signature is checked by `acceptHook`, which the host's webhook route calls first (the connector sources say `verify: 'signature'`); only an accepted
// delivery reaches twilio.receive_webhook. Twilio signs with the account auth token, which is the item stored as Twilio_Auth.
// DECISION: a delivery is remembered by a key built from the Sid plus the status; a replay gets the same TwiML back and nothing is landed twice.
// DECISION: a softphone ring goes to `<Client>` with the target's id; the telephony module hands over person and agent ids, and expands groups itself.
import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../../../host/src/routes/errors.ts";
import { acct, api, bad, ensure, first, HANDLE, intOrUndef, list, needHost, obj, phone, sid, strOrUndef, text } from "../projections.ts";
import type { Json, TwilioCtx } from "../projections.ts";
import { hookUrls, twimlAppOf } from "./numbers.ts";

export type HookKind = "voice" | "sms" | "status" | "recording";
export const HOOK_KINDS: readonly HookKind[] = ["voice", "sms", "status", "recording"];
const pathPart = (v: string): string => encodeURIComponent(v);

// ---- the signature

/** What Twilio signs: the full address, then each parameter name followed by its value, names in order. */
export function signatureOf(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + (params[k] ?? ""), url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function signatureMatches(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const want = Buffer.from(signatureOf(authToken, url, params));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface HookIn {
  kind: HookKind;
  dedupeKey: string;
  sid: string;
  params: Record<string, string>;
}

/** A delivery as the host's route got it: refused unless the signature is Twilio's, else the input of twilio.receive_webhook. */
export async function acceptHook(
  ctx: TwilioCtx, a: { kind: string; url: string; params: Record<string, string>; signature: string | undefined },
): Promise<HookIn> {
  if (!HOOK_KINDS.includes(a.kind as HookKind)) bad(ctx, "Twilio sends voice, sms, status and recording hooks.");
  const token = await needHost(ctx).secret(ctx, HANDLE.auth);
  if (!a.signature || !signatureMatches(token, a.url, a.params, a.signature)) {
    throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request was not signed by Twilio." });
  }
  return hookInput(ctx, a.kind as HookKind, a.params);
}

/** The Sid that names a delivery, and the key that makes a replay a no-op. */
export function hookInput(ctx: Pick<TwilioCtx, "trace">, kind: HookKind, params: Record<string, string>): HookIn {
  const p = (k: string): string => text(params[k]);
  if (kind === "voice") {
    if (!p("CallSid")) bad(ctx, "A voice hook names its CallSid.");
    return { kind, sid: p("CallSid"), dedupeKey: `voice:${p("CallSid")}`, params };
  }
  if (kind === "sms") {
    if (!p("MessageSid")) bad(ctx, "A text hook names its MessageSid.");
    return { kind, sid: p("MessageSid"), dedupeKey: `sms:${p("MessageSid")}`, params };
  }
  if (kind === "status") {
    const s = p("CallSid") || p("MessageSid");
    const status = p("CallStatus") || p("MessageStatus") || p("SmsStatus");
    if (!s || !status) bad(ctx, "A status hook names its Sid and the status.");
    return { kind, sid: s, dedupeKey: `status:${s}:${status}`, params };
  }
  if (!p("RecordingSid") || !p("CallSid")) bad(ctx, "A recording hook names its RecordingSid and CallSid.");
  return { kind, sid: p("RecordingSid"), dedupeKey: `recording:${p("RecordingSid")}:${p("RecordingStatus") || "completed"}`, params };
}

// ---- TwiML

const xml = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const respond = (...verbs: string[]): string => `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.join("")}</Response>`;
export const EMPTY_TWIML = respond();

interface Instruction {
  action: string;
  targets: { kind: string; id: string }[];
  ringSeconds?: number;
  greeting?: string;
  record: boolean;
  announcement?: string;
}

/** The answer to a call from the instruction telephony gave: ring the people, take a message, or turn the caller away. */
export function voiceTwiml(instruction: Instruction, o: { callerId: string; recordingUrl: string }): string {
  const say = (s: string | undefined): string[] => (s ? [`<Say>${xml(s)}</Say>`] : []);
  const voicemail = (): string => respond(
    ...say(instruction.greeting),
    `<Record maxLength="120" playBeep="true" recordingStatusCallback="${xml(o.recordingUrl)}" recordingStatusCallbackMethod="POST"/>`,
    "<Hangup/>",
  );
  if (instruction.action === "reject") return respond("<Reject/>");
  if (instruction.action === "voicemail" || instruction.targets.length === 0) return voicemail();
  const recording = instruction.record ? ` record="record-from-answer-dual" recordingStatusCallback="${xml(o.recordingUrl)}" recordingStatusCallbackMethod="POST"` : "";
  const timeout = Math.min(120, Math.max(5, instruction.ringSeconds ?? 20));
  const clients = instruction.targets.map((t) => `<Client>${xml(t.id)}</Client>`).join("");
  return respond(...say(instruction.announcement), `<Dial timeout="${timeout}" callerId="${xml(o.callerId)}"${recording}>${clients}</Dial>`);
}

// ---- twilio.receive_webhook

export async function receiveWebhook(ctx: TwilioCtx, input: HookIn): Promise<{ accepted: boolean; twiml?: string }> {
  ensure(ctx);
  if (!HOOK_KINDS.includes(input.kind)) bad(ctx, "Twilio sends voice, sms, status and recording hooks.");
  if (typeof input.dedupeKey !== "string" || input.dedupeKey === "" || typeof input.sid !== "string" || input.sid === "") bad(ctx, "A delivery needs its key and its Sid.");
  const params = obj(input.params) as Record<string, string>;
  const seen = first(ctx.db.all(`SELECT "twiml" FROM twilio_hook_log WHERE "dedupeKey" = ?`, input.dedupeKey));
  if (seen) return typeof seen.twiml === "string" ? { accepted: true, twiml: seen.twiml } : { accepted: true };   // sent twice: applied once
  const p = (k: string): string => text(params[k]);
  let twiml: string | undefined;

  if (input.kind === "voice") {
    const to = phone(ctx, p("To"), "The number called");
    const call: Json = { callSid: input.sid, from: p("From"), to, status: p("CallStatus") || "ringing" };
    if (p("CallerName")) call.callerName = p("CallerName");
    if (p("ForwardedFrom")) call.forwardedFrom = p("ForwardedFrom");
    const landed = obj(await ctx.call("telephony.ingest_voice", call));
    const inst = obj(landed.instruction);
    const hooks = await hookUrls(ctx);
    twiml = voiceTwiml({
      action: text(inst.action), targets: list(inst.targets).map((t) => ({ kind: text(obj(t).kind), id: text(obj(t).id) })).filter((t) => t.id !== ""),
      ...(intOrUndef(inst.ringSeconds) !== undefined ? { ringSeconds: intOrUndef(inst.ringSeconds) as number } : {}),
      ...(strOrUndef(inst.greeting) ? { greeting: strOrUndef(inst.greeting) as string } : {}),
      record: inst.record === true, ...(strOrUndef(inst.announcement) ? { announcement: strOrUndef(inst.announcement) as string } : {}),
    }, { callerId: to, recordingUrl: hooks.recording });
  } else if (input.kind === "sms") {
    const media: string[] = [];
    const count = intOrUndef(p("NumMedia")) ?? 0;
    for (let i = 0; i < Math.min(count, 10); i++) if (p(`MediaUrl${i}`)) media.push(p(`MediaUrl${i}`));
    const msg: Json = { messageSid: input.sid, from: phone(ctx, p("From"), "The sender"), to: phone(ctx, p("To"), "The number texted"), body: p("Body"), at: ctx.now() };
    if (media.length) msg.mediaUrls = media;
    await ctx.call("telephony.ingest_sms", msg);
    twiml = EMPTY_TWIML;   // Twilio answers STOP and START itself; a reply, if any, goes out through telephony.send_sms
  } else if (input.kind === "status") {
    const isCall = p("CallSid") !== "";
    const status: Json = { sid: input.sid, kind: isCall ? "call" : "sms", status: p("CallStatus") || p("MessageStatus") || p("SmsStatus"), at: ctx.now() };
    if (p("ErrorCode")) status.errorCode = p("ErrorCode");
    const duration = intOrUndef(p("CallDuration"));
    if (isCall && duration !== undefined) status.durationSec = duration;
    await ctx.call("telephony.ingest_status", status);
  } else if (p("RecordingStatus") === "" || p("RecordingStatus") === "completed") {
    const rec: Json = { callSid: p("CallSid"), recordingSid: input.sid, url: p("RecordingUrl") };
    if (!rec.url) bad(ctx, "A finished recording names its RecordingUrl.");
    const duration = intOrUndef(p("RecordingDuration"));
    if (duration !== undefined) rec.durationSec = duration;
    await ctx.call("telephony.ingest_recording", rec);
  }

  ctx.db.run(`INSERT OR IGNORE INTO twilio_hook_log ("dedupeKey", kind, sid, twiml, "at") VALUES (?, ?, ?, ?, ?)`, input.dedupeKey, input.kind, input.sid, twiml ?? null, ctx.now());
  ctx.emit(`twilio.${input.kind}_received`, `entity/${input.sid}`, { dedupeKey: input.dedupeKey, sid: input.sid });
  return twiml ? { accepted: true, twiml } : { accepted: true };
}

// ---- twilio.access_token (the Voice JS SDK)

const b64url = (v: Buffer | string): string => Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function accessToken(ctx: TwilioCtx, input: { identity: string; ttlSec?: number }): Promise<{ token: string; expiresAt: number }> {
  if (typeof input.identity !== "string" || !/^[A-Za-z0-9_]{1,121}$/.test(input.identity)) bad(ctx, "The identity is letters, digits and underscores, up to 121 characters.");
  const ttl = input.ttlSec ?? 3600;
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86400) bad(ctx, "The token lifetime is 60 seconds to 24 hours.");
  const h = needHost(ctx);
  const account = await h.secret(ctx, HANDLE.account);
  const keySid = await h.optionalSecret(ctx, HANDLE.apiKey);
  if (!keySid) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The softphone needs an API key. Add Twilio_API_Key to the Vault, with its secret in Twilio_Auth." });
  const secret = await h.secret(ctx, HANDLE.auth);
  const app = await twimlAppOf(ctx);
  const iat = Math.floor(ctx.now() / 1000);
  const exp = iat + ttl;
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const claims = { jti: `${keySid}-${iat}`, iss: keySid, sub: account, iat, exp, grants: { identity: input.identity, voice: { incoming: { allow: true }, outgoing: { application_sid: app } } } };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const token = `${body}.${b64url(createHmac("sha256", secret).update(body).digest())}`;
  return { token, expiresAt: exp * 1000 };
}

// ---- calls

export async function callCreate(
  ctx: TwilioCtx, input: { from: string; to: string; url?: string; record?: boolean; statusCallback?: string },
): Promise<{ sid: string }> {
  const from = phone(ctx, input.from, "The caller number");
  const to = phone(ctx, input.to, "The number to call");
  for (const [k, v] of [["url", input.url], ["statusCallback", input.statusCallback]] as const) if (v !== undefined && (typeof v !== "string" || !/^https:\/\/\S+$/.test(v))) bad(ctx, `${k} must be an https address.`);
  const hooks = await hookUrls(ctx);
  const form: [string, string][] = [
    ["From", from], ["To", to], ["Url", input.url ?? hooks.voice], ["Method", "POST"], ["StatusCallback", input.statusCallback ?? hooks.status], ["StatusCallbackMethod", "POST"],
    ["StatusCallbackEvent", "initiated"], ["StatusCallbackEvent", "ringing"], ["StatusCallbackEvent", "answered"], ["StatusCallbackEvent", "completed"],
  ];
  if (input.record === true) form.push(["Record", "true"], ["RecordingStatusCallback", hooks.recording], ["RecordingStatusCallbackMethod", "POST"]);
  const j = await api(ctx, { method: "POST", url: await acct(ctx, "/Calls.json"), form }, { send: true });
  const s = strOrUndef(j.sid);
  if (!s) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the call." });
  return { sid: s };
}

export async function callGet(ctx: TwilioCtx, input: { sid: string }): Promise<{ status: string; durationSec?: number; from: string; to: string }> {
  const j = await api(ctx, { url: await acct(ctx, `/Calls/${pathPart(sid(ctx, input.sid, "The call"))}.json`) });
  const out: { status: string; durationSec?: number; from: string; to: string } = { status: text(j.status), from: text(j.from), to: text(j.to) };
  const d = intOrUndef(j.duration);
  if (d !== undefined) out.durationSec = d;
  return out;
}

const HOLD_TWIML = respond('<Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3</Play>');

export async function callUpdate(
  ctx: TwilioCtx, input: { sid: string; action: "hangup" | "hold" | "resume" | "redirect"; targetUrl?: string },
): Promise<{ status: string }> {
  const s = sid(ctx, input.sid, "The call");
  if ((input.action === "redirect" || input.action === "resume") && (typeof input.targetUrl !== "string" || !/^https:\/\/\S+$/.test(input.targetUrl))) {
    bad(ctx, `${input.action === "redirect" ? "Redirect" : "Resume"} needs the https address to send the call to.`);
  }
  const form: [string, string][] = [];
  if (input.action === "hangup") form.push(["Status", "completed"]);
  else if (input.action === "hold") form.push(["Twiml", HOLD_TWIML]);
  else if (input.action === "redirect" || input.action === "resume") form.push(["Url", input.targetUrl as string], ["Method", "POST"]);
  else bad(ctx, "The action is hangup, hold, resume or redirect.");
  const j = await api(ctx, { method: "POST", url: await acct(ctx, `/Calls/${pathPart(s)}.json`), form });
  return { status: text(j.status) };
}

// ---- recordings

export async function recordingStart(ctx: TwilioCtx, input: { callSid: string; announced: boolean }): Promise<{ recordingSid: string }> {
  const call = sid(ctx, input.callSid, "The call");
  if (input.announced !== true) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Recording starts only after the call has been told it is being recorded." });
  const hooks = await hookUrls(ctx);
  const j = await api(ctx, {
    method: "POST", url: await acct(ctx, `/Calls/${pathPart(call)}/Recordings.json`),
    form: [["RecordingStatusCallback", hooks.recording], ["RecordingStatusCallbackMethod", "POST"], ["RecordingChannels", "dual"]],
  });
  const r = strOrUndef(j.sid);
  if (!r) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the recording." });
  return { recordingSid: r };
}

export async function recordingStop(ctx: TwilioCtx, input: { callSid: string; recordingSid: string }): Promise<{ stopped: boolean }> {
  const call = sid(ctx, input.callSid, "The call");
  const rec = sid(ctx, input.recordingSid, "The recording");
  await api(ctx, { method: "POST", url: await acct(ctx, `/Calls/${pathPart(call)}/Recordings/${pathPart(rec)}.json`), form: [["Status", "stopped"]] });
  return { stopped: true };
}

export async function recordingDownload(ctx: TwilioCtx, input: { recordingSid: string }): Promise<{ blobId: string; size: number; durationSec?: number }> {
  const rec = sid(ctx, input.recordingSid, "The recording");
  const meta = await api(ctx, { url: await acct(ctx, `/Recordings/${pathPart(rec)}.json`) });
  const blob = await needHost(ctx).download(ctx, { url: await acct(ctx, `/Recordings/${pathPart(rec)}.mp3`), mime: "audio/mpeg" });
  const d = intOrUndef(meta.duration);
  return d !== undefined ? { blobId: blob.blobId, size: blob.size, durationSec: d } : { blobId: blob.blobId, size: blob.size };
}

export async function recordingDelete(ctx: TwilioCtx, input: { recordingSid: string }): Promise<{ deleted: boolean }> {
  await api(ctx, { method: "DELETE", url: await acct(ctx, `/Recordings/${pathPart(sid(ctx, input.recordingSid, "The recording"))}.json`) });
  return { deleted: true };
}

// ---- texts

export async function smsSend(
  ctx: TwilioCtx, input: { from: string; to: string; body: string; mediaUrls?: string[]; statusCallback?: string },
): Promise<{ sid: string; status: string }> {
  const from = phone(ctx, input.from, "The sending number");
  const to = phone(ctx, input.to, "The number to text");
  if (typeof input.body !== "string" || (input.body === "" && !(input.mediaUrls ?? []).length) || input.body.length > 1600) bad(ctx, "A text is 1 to 1600 characters, or carries a picture.");
  const media = list(input.mediaUrls);
  if (media.length > 10 || media.some((m) => typeof m !== "string" || !/^https:\/\/\S+$/.test(m))) bad(ctx, "Pictures are up to ten https addresses.");
  if (input.statusCallback !== undefined && (typeof input.statusCallback !== "string" || !/^https:\/\/\S+$/.test(input.statusCallback))) bad(ctx, "statusCallback must be an https address.");
  const hooks = await hookUrls(ctx);
  const form: [string, string][] = [["From", from], ["To", to], ["StatusCallback", input.statusCallback ?? hooks.status]];
  if (input.body) form.push(["Body", input.body]);
  for (const m of media) form.push(["MediaUrl", m as string]);
  const j = await api(ctx, { method: "POST", url: await acct(ctx, "/Messages.json"), form }, { send: true });
  const s = strOrUndef(j.sid);
  if (!s) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the text." });
  return { sid: s, status: text(j.status) || "queued" };
}
