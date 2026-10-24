// /hooks/twilio/voice, /sms, /status, /recording. The X-Twilio-Signature header is HMAC-SHA1 of the URL plus sorted form fields.
import { decideVoice, fail, numberByE164, voiceTwiml, asRow, strCell } from "./numbers.ts";
import type { Db, NumberCtx } from "./numbers.ts";

export type HookKind = "voice" | "sms" | "status" | "recording";
export type HookEvent =
  | "twilio.voice_received"
  | "twilio.sms_received"
  | "twilio.status_received"
  | "twilio.recording_received";

export interface TwilioCtx extends NumberCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  now(): number;
  emit(name: HookEvent, subject: string, payload: { dedupeKey: string; sid: string }): unknown;
  http(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string> }>;
  log: { debug(msg: string, attrs?: Record<string, unknown>): void; info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void; error(msg: string, attrs?: Record<string, unknown>): void };
}

export interface TwilioAccount {
  accountSid: string;
  authToken: string;
  apiKeySid: string | null;
  apiKeySecret: string | null;
  twimlAppSid: string | null;
  voiceUrl: string | null;
}

export interface HookRequest {
  kind: HookKind;
  url: string;
  params: Record<string, string>;
  signature: string | undefined;
}

export interface HookResult {
  status: number;
  contentType: string;
  body: string;
  accepted: boolean;
}

export interface WebhookIn {
  kind: HookKind;
  dedupeKey: string;
  sid: string;
  params: Record<string, string>;
}

const EVENT: Record<HookKind, HookEvent> = {
  voice: "twilio.voice_received",
  sms: "twilio.sms_received",
  status: "twilio.status_received",
  recording: "twilio.recording_received",
};

const XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
const SMS_TWIML = `${XML}<Response></Response>`;
const text = new TextEncoder();

export function webhookIdentity(kind: HookKind, params: Record<string, string>): { sid: string; dedupeKey: string } {
  if (kind === "voice") {
    const sid = params.CallSid ?? "";
    return { sid, dedupeKey: `${sid}:${params.CallStatus ?? "ringing"}` };
  }
  if (kind === "sms") {
    const sid = params.MessageSid ?? params.SmsSid ?? "";
    return { sid, dedupeKey: `${sid}:${params.SmsStatus ?? params.MessageStatus ?? "received"}` };
  }
  if (kind === "recording") {
    const sid = params.RecordingSid ?? "";
    return { sid, dedupeKey: `${sid}:${params.RecordingStatus ?? "completed"}` };
  }
  const sid = params.CallSid ?? params.MessageSid ?? params.SmsSid ?? "";
  const status = params.CallStatus ?? params.MessageStatus ?? params.SmsStatus ?? "status";
  return { sid, dedupeKey: `${sid}:${status}` };
}

export async function twilioSignature(url: string, params: Record<string, string>, authToken: string): Promise<string> {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) data += k + (params[k] ?? "");
  const key = await crypto.subtle.importKey("raw", text.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, text.encode(data)));
  return Buffer.from(mac).toString("base64");
}

async function signatureOk(url: string, params: Record<string, string>, authToken: string, got: string | undefined): Promise<boolean> {
  if (!got) return false;
  const expected = await twilioSignature(url, params, authToken);
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function loadAccount(ctx: TwilioCtx): TwilioAccount | null {
  const rows = ctx.db.all(
    "SELECT account_sid, auth_token, api_key_sid, api_key_secret, twiml_app_sid, voice_url FROM twilio_account WHERE space_id = ?",
    ctx.space,
  );
  const row = asRow(rows[0]);
  if (!row) return null;
  const accountSid = strCell(row, "account_sid");
  const authToken = strCell(row, "auth_token");
  if (!accountSid || !authToken) return null;
  return {
    accountSid,
    authToken,
    apiKeySid: strCell(row, "api_key_sid"),
    apiKeySecret: strCell(row, "api_key_secret"),
    twimlAppSid: strCell(row, "twiml_app_sid"),
    voiceUrl: strCell(row, "voice_url"),
  };
}

export function saveAccount(ctx: TwilioCtx, account: TwilioAccount): void {
  if (loadAccount(ctx)) {
    ctx.db.run(
      "UPDATE twilio_account SET account_sid = ?, auth_token = ?, api_key_sid = ?, api_key_secret = ?, twiml_app_sid = ?, voice_url = ? WHERE space_id = ?",
      account.accountSid, account.authToken, account.apiKeySid, account.apiKeySecret, account.twimlAppSid, account.voiceUrl, ctx.space,
    );
    return;
  }
  ctx.db.run(
    "INSERT INTO twilio_account (space_id, account_sid, auth_token, api_key_sid, api_key_secret, twiml_app_sid, voice_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ctx.space, account.accountSid, account.authToken, account.apiKeySid, account.apiKeySecret, account.twimlAppSid, account.voiceUrl,
  );
}

export function requireAccount(ctx: TwilioCtx): TwilioAccount {
  const account = loadAccount(ctx);
  if (!account) throw fail(ctx, "provider.auth_failed", "Twilio_Account and Twilio_Auth are not set for this Space.");
  return account;
}

function hookAction(url: string | undefined): string {
  if (!url) return "/hooks/twilio/voice?step=after-dial";
  const u = new URL(url);
  u.search = "";
  u.searchParams.set("step", "after-dial");
  return u.toString();
}

function voiceFor(ctx: TwilioCtx, params: Record<string, string>, url: string | undefined): string {
  const step = url ? new URL(url).searchParams.get("step") : null;
  const to = params.To ?? params.Called ?? "";
  const number = to ? numberByE164(ctx, to) : null;
  if (step === "after-dial") {
    const dial = params.DialCallStatus ?? "";
    if (dial === "completed" || dial === "answered") return `${XML}<Response></Response>`;
    if (number?.route.voicemail) return voiceTwiml({ action: "voicemail", transcript: number.route.voicemailTranscript }, "");
    return `${XML}<Response><Hangup/></Response>`;
  }
  if (!number) return `${XML}<Response><Say>This number is not set up.</Say><Hangup/></Response>`;
  return voiceTwiml(decideVoice(number.route, number.hours, ctx.now()), hookAction(url));
}

function seen(ctx: NumberCtx, dedupeKey: string): boolean {
  return ctx.db.all("SELECT dedupe_key FROM twilio_seen WHERE dedupe_key = ?", dedupeKey).length > 0;
}

export async function recordWebhook(ctx: TwilioCtx, input: WebhookIn, url?: string): Promise<{ accepted: boolean; twiml?: string }> {
  if (!input.sid || !input.dedupeKey) throw fail(ctx, "validation.bad_input", "A webhook needs a sid and a dedupe key.");
  const replay = seen(ctx, input.dedupeKey);
  if (!replay) {
    ctx.db.run("INSERT INTO twilio_seen (dedupe_key, kind, sid, seen_at) VALUES (?, ?, ?, ?)", input.dedupeKey, input.kind, input.sid, ctx.now());
    ctx.emit(EVENT[input.kind], input.sid, { dedupeKey: input.dedupeKey, sid: input.sid });
    ctx.log.info("twilio webhook", { kind: input.kind, sid: input.sid });
  }
  if (input.kind === "voice") return { accepted: !replay, twiml: voiceFor(ctx, input.params, url) };
  if (input.kind === "sms") return { accepted: !replay, twiml: SMS_TWIML };
  return { accepted: !replay };
}

export async function handleHook(ctx: TwilioCtx, req: HookRequest): Promise<HookResult> {
  const account = loadAccount(ctx);
  const ok = account ? await signatureOk(req.url, req.params, account.authToken, req.signature) : false;
  if (!ok) return { status: 403, contentType: "text/plain", body: "", accepted: false };
  const id = webhookIdentity(req.kind, req.params);
  if (!id.sid) return { status: 422, contentType: "text/plain", body: "", accepted: false };
  const out = await recordWebhook(ctx, { kind: req.kind, dedupeKey: id.dedupeKey, sid: id.sid, params: req.params }, req.url);
  if (req.kind === "voice" || req.kind === "sms") {
    return { status: 200, contentType: "text/xml", body: out.twiml ?? SMS_TWIML, accepted: out.accepted };
  }
  return { status: 200, contentType: "text/plain", body: "", accepted: out.accepted };
}

export type { Db };
