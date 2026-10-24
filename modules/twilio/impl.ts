// twilio (lane L5): one handler per capability of manifests/twilio.ts. Handlers are the only place logic lives.
import { VyreErr } from "../../host/src/routes/errors.ts";
import { recordWebhook, requireAccount, saveAccount } from "./handlers/hooks.ts";
import type { TwilioAccount, TwilioCtx, WebhookIn } from "./handlers/hooks.ts";
import {
  asRow, defaultHours, defaultRoute, deleteNumber, fail, getNumber, listNumbers, numberByE164, saveNumber, strCell,
} from "./handlers/numbers.ts";
import type { StoredNumber } from "./handlers/numbers.ts";

const API = "https://api.twilio.com/2010-04-01";
const MSG = "https://messaging.twilio.com/v1";
const textEnc = new TextEncoder();

interface HttpResult { status: number; json: Record<string, unknown>; text: string }

function formBody(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function basic(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return asRow(v);
}

async function request(ctx: TwilioCtx, account: TwilioAccount, method: string, url: string, pairs?: [string, string][]): Promise<HttpResult> {
  const headers: Record<string, string> = { Authorization: basic(account.accountSid, account.authToken), Accept: "application/json" };
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (pairs && pairs.length > 0) {
    init.body = formBody(pairs);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  let res: { status: number; text(): Promise<string> };
  try { res = await ctx.http(url, init); } catch { throw fail(ctx, "provider.network", "Twilio could not be reached."); }
  const body = await res.text();
  let json: Record<string, unknown> = {};
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const parsed = JSON.parse(body) as unknown;
      json = rec(parsed) ?? {};
    } catch { throw fail(ctx, "provider.bad_response", "Twilio answered in an unexpected way."); }
  }
  return { status: res.status, json, text: body };
}

function raise(ctx: TwilioCtx, res: HttpResult): void {
  if (res.status === 401 || res.status === 403) throw fail(ctx, "provider.auth_failed", "Twilio rejected the Account SID or auth token.");
  if (res.status === 429) throw fail(ctx, "provider.rate_limited", "Twilio is rate limiting.");
  if (res.status >= 400) throw fail(ctx, "provider.bad_response", "Twilio answered in an unexpected way.");
}

async function twilio(ctx: TwilioCtx, account: TwilioAccount, method: string, url: string, pairs?: [string, string][]): Promise<Record<string, unknown>> {
  const res = await request(ctx, account, method, url, pairs);
  raise(ctx, res);
  return res.json;
}

async function once<T>(ctx: TwilioCtx, cap: string, key: string, run: () => Promise<T>): Promise<T> {
  const idemKey = `${ctx.space}:${cap}:${key}`;
  const hit = asRow(ctx.db.all("SELECT result_json FROM twilio_idem WHERE idem_key = ?", idemKey)[0]);
  const cached = hit ? strCell(hit, "result_json") : null;
  if (cached) return JSON.parse(cached) as T;
  const result = await run();
  ctx.db.run("INSERT INTO twilio_idem (idem_key, result_json) VALUES (?, ?)", idemKey, JSON.stringify(result));
  return result;
}

function capsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  const o = rec(v);
  if (!o) return [];
  const out: string[] = [];
  for (const key of ["voice", "sms", "mms"]) if (o[key] === true || o[key.toUpperCase()] === true) out.push(key);
  return out;
}

interface OwnedOut {
  sid: string;
  e164: string;
  friendlyName?: string;
  capabilities: string[];
  voiceUrl?: string;
  smsUrl?: string;
  statusUrl?: string;
}

function ownedOut(n: StoredNumber): OwnedOut {
  const out: OwnedOut = { sid: n.sid, e164: n.e164, capabilities: n.capabilities };
  if (n.friendlyName) out.friendlyName = n.friendlyName;
  if (n.voiceUrl) out.voiceUrl = n.voiceUrl;
  if (n.smsUrl) out.smsUrl = n.smsUrl;
  if (n.statusUrl) out.statusUrl = n.statusUrl;
  return out;
}

function fromRemote(ctx: TwilioCtx, json: Record<string, unknown>, prev: StoredNumber | null): StoredNumber {
  const sid = str(json.sid);
  const e164 = str(json.phone_number) ?? prev?.e164;
  if (!sid || !e164) throw fail(ctx, "provider.bad_response", "Twilio did not return a number.");
  return {
    sid,
    e164,
    friendlyName: str(json.friendly_name) ?? prev?.friendlyName ?? null,
    capabilities: capsOf(json.capabilities).length ? capsOf(json.capabilities) : (prev?.capabilities ?? ["voice", "sms"]),
    voiceUrl: str(json.voice_url) ?? prev?.voiceUrl ?? null,
    smsUrl: str(json.sms_url) ?? prev?.smsUrl ?? null,
    statusUrl: str(json.status_callback) ?? prev?.statusUrl ?? null,
    twimlAppSid: str(json.voice_application_sid) ?? prev?.twimlAppSid ?? null,
    route: prev?.route ?? defaultRoute(ctx.principal.id),
    hours: prev?.hours ?? defaultHours(),
  };
}

interface A2pRow {
  brandSid: string | null;
  brandStatus: string | null;
  campaignSid: string | null;
  campaignStatus: string | null;
  rejectedReason: string | null;
  messagingServiceSid: string | null;
}

function loadA2p(ctx: TwilioCtx): A2pRow | null {
  const row = asRow(ctx.db.all(
    "SELECT brand_sid, brand_status, campaign_sid, campaign_status, rejected_reason, messaging_service_sid FROM twilio_a2p WHERE space_id = ?",
    ctx.space,
  )[0]);
  if (!row) return null;
  return {
    brandSid: strCell(row, "brand_sid"),
    brandStatus: strCell(row, "brand_status"),
    campaignSid: strCell(row, "campaign_sid"),
    campaignStatus: strCell(row, "campaign_status"),
    rejectedReason: strCell(row, "rejected_reason"),
    messagingServiceSid: strCell(row, "messaging_service_sid"),
  };
}

function saveA2p(ctx: TwilioCtx, row: A2pRow): void {
  if (loadA2p(ctx)) {
    ctx.db.run(
      "UPDATE twilio_a2p SET brand_sid = ?, brand_status = ?, campaign_sid = ?, campaign_status = ?, rejected_reason = ?, messaging_service_sid = ? WHERE space_id = ?",
      row.brandSid, row.brandStatus, row.campaignSid, row.campaignStatus, row.rejectedReason, row.messagingServiceSid, ctx.space,
    );
    return;
  }
  ctx.db.run(
    "INSERT INTO twilio_a2p (space_id, brand_sid, brand_status, campaign_sid, campaign_status, rejected_reason, messaging_service_sid) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ctx.space, row.brandSid, row.brandStatus, row.campaignSid, row.campaignStatus, row.rejectedReason, row.messagingServiceSid,
  );
}

function blankA2p(): A2pRow {
  return { brandSid: null, brandStatus: null, campaignSid: null, campaignStatus: null, rejectedReason: null, messagingServiceSid: null };
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signJwt(header: unknown, payload: unknown, secret: string): Promise<string> {
  const h = b64url(textEnc.encode(JSON.stringify(header)));
  const p = b64url(textEnc.encode(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const key = await crypto.subtle.importKey("raw", textEnc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, textEnc.encode(data)));
  return `${data}.${b64url(mac)}`;
}

async function ensureApp(ctx: TwilioCtx, voiceUrl: string): Promise<string> {
  const account = requireAccount(ctx);
  if (account.twimlAppSid) return account.twimlAppSid;
  const name = `vyre-${ctx.space}`;
  const listed = await twilio(ctx, account, "GET", `${API}/Accounts/${account.accountSid}/Applications.json?FriendlyName=${encodeURIComponent(name)}`);
  const apps = Array.isArray(listed.applications) ? listed.applications : [];
  for (const item of apps) {
    const app = rec(item);
    if (app && str(app.friendly_name) === name && str(app.sid)) {
      saveAccount(ctx, { ...account, twimlAppSid: str(app.sid), voiceUrl });
      return str(app.sid)!;
    }
  }
  const made = await twilio(ctx, account, "POST", `${API}/Accounts/${account.accountSid}/Applications.json`, [
    ["FriendlyName", name], ["VoiceUrl", voiceUrl], ["VoiceMethod", "POST"],
  ]);
  const sid = str(made.sid);
  if (!sid) throw fail(ctx, "provider.bad_response", "Twilio did not return a TwiML app.");
  saveAccount(ctx, { ...requireAccount(ctx), twimlAppSid: sid, voiceUrl });
  return sid;
}

function accountBase(account: TwilioAccount): string {
  return `${API}/Accounts/${account.accountSid}`;
}

export const handlers = {
  "twilio.number.list_owned": async (ctx: TwilioCtx): Promise<{ numbers: OwnedOut[] }> => {
    const account = requireAccount(ctx);
    const json = await twilio(ctx, account, "GET", `${accountBase(account)}/IncomingPhoneNumbers.json`);
    const remote = Array.isArray(json.incoming_phone_numbers) ? json.incoming_phone_numbers : [];
    for (const item of remote) {
      const row = rec(item);
      if (!row || !str(row.sid)) continue;
      const prev = getNumber(ctx, str(row.sid)!);
      saveNumber(ctx, fromRemote(ctx, row, prev));
    }
    return { numbers: listNumbers(ctx).map(ownedOut) };
  },

  "twilio.number.search": async (ctx: TwilioCtx, input: { country: string; areaCode?: string; contains?: string; capabilities?: Array<"voice" | "sms" | "mms">; limit?: number }): Promise<{ available: Array<{ e164: string; locality?: string; region?: string; capabilities: string[] }> }> => {
    const account = requireAccount(ctx);
    const u = new URL(`${accountBase(account)}/AvailablePhoneNumbers/${encodeURIComponent(input.country)}/Local.json`);
    u.searchParams.set("PageSize", String(input.limit ?? 20));
    if (input.areaCode) u.searchParams.set("AreaCode", input.areaCode);
    if (input.contains) u.searchParams.set("Contains", input.contains);
    for (const cap of input.capabilities ?? []) {
      if (cap === "voice") u.searchParams.set("VoiceEnabled", "true");
      if (cap === "sms") u.searchParams.set("SmsEnabled", "true");
      if (cap === "mms") u.searchParams.set("MmsEnabled", "true");
    }
    const json = await twilio(ctx, account, "GET", u.toString());
    const items = Array.isArray(json.available_phone_numbers) ? json.available_phone_numbers : [];
    const available: Array<{ e164: string; locality?: string; region?: string; capabilities: string[] }> = [];
    for (const item of items) {
      const row = rec(item);
      const e164 = row ? str(row.phone_number) : null;
      if (!row || !e164) continue;
      const one: { e164: string; locality?: string; region?: string; capabilities: string[] } = { e164, capabilities: capsOf(row.capabilities) };
      const locality = str(row.locality);
      const region = str(row.region);
      if (locality) one.locality = locality;
      if (region) one.region = region;
      available.push(one);
    }
    return { available };
  },

  "twilio.number.buy": async (ctx: TwilioCtx, input: { e164: string; friendlyName?: string; idempotencyKey: string }): Promise<{ number: OwnedOut }> => once(ctx, "twilio.number.buy", input.idempotencyKey, async () => {
    if (numberByE164(ctx, input.e164)) throw fail(ctx, "validation.duplicate", "That number is already in this Space.");
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [["PhoneNumber", input.e164]];
    if (input.friendlyName) pairs.push(["FriendlyName", input.friendlyName]);
    const json = await twilio(ctx, account, "POST", `${accountBase(account)}/IncomingPhoneNumbers.json`, pairs);
    const number = fromRemote(ctx, json, null);
    if (input.friendlyName) number.friendlyName = input.friendlyName;
    saveNumber(ctx, number);
    return { number: ownedOut(number) };
  }),

  "twilio.number.release": async (ctx: TwilioCtx, input: { sid: string; idempotencyKey: string }): Promise<{ released: boolean }> => once(ctx, "twilio.number.release", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const res = await request(ctx, account, "DELETE", `${accountBase(account)}/IncomingPhoneNumbers/${encodeURIComponent(input.sid)}.json`);
    if (res.status === 404) throw fail(ctx, "validation.not_found", "Twilio does not have that number.");
    raise(ctx, res);
    deleteNumber(ctx, input.sid);
    return { released: true };
  }),

  "twilio.number.configure": async (ctx: TwilioCtx, input: { sid: string; voiceUrl?: string; smsUrl?: string; statusUrl?: string; twimlAppSid?: string; idempotencyKey: string }): Promise<{ number: OwnedOut }> => once(ctx, "twilio.number.configure", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [];
    if (input.voiceUrl) pairs.push(["VoiceUrl", input.voiceUrl]);
    if (input.smsUrl) pairs.push(["SmsUrl", input.smsUrl]);
    if (input.statusUrl) pairs.push(["StatusCallback", input.statusUrl]);
    if (input.twimlAppSid) pairs.push(["VoiceApplicationSid", input.twimlAppSid]);
    const json = await twilio(ctx, account, "POST", `${accountBase(account)}/IncomingPhoneNumbers/${encodeURIComponent(input.sid)}.json`, pairs);
    const prev = getNumber(ctx, input.sid);
    const number = fromRemote(ctx, { ...json, sid: str(json.sid) ?? input.sid }, prev);
    if (input.voiceUrl) number.voiceUrl = input.voiceUrl;
    if (input.smsUrl) number.smsUrl = input.smsUrl;
    if (input.statusUrl) number.statusUrl = input.statusUrl;
    if (input.twimlAppSid) number.twimlAppSid = input.twimlAppSid;
    saveNumber(ctx, number);
    return { number: ownedOut(number) };
  }),

  "twilio.twiml_app.ensure": async (ctx: TwilioCtx, input: { voiceUrl: string; idempotencyKey: string }): Promise<{ appSid: string }> => once(ctx, "twilio.twiml_app.ensure", input.idempotencyKey, async () => {
    return { appSid: await ensureApp(ctx, input.voiceUrl) };
  }),

  "twilio.access_token": async (ctx: TwilioCtx, input: { identity: string; ttlSec?: number }): Promise<{ token: string; expiresAt: number }> => {
    const account = requireAccount(ctx);
    const appSid = account.twimlAppSid ?? await ensureApp(ctx, account.voiceUrl ?? "https://example.test/hooks/twilio/voice");
    const ttl = input.ttlSec ?? 3600;
    const nowSec = Math.floor(ctx.now() / 1000);
    const exp = nowSec + ttl;
    const iss = account.apiKeySid ?? account.accountSid;
    const token = await signJwt(
      { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" },
      {
        jti: `${iss}-${nowSec}`,
        iss,
        sub: account.accountSid,
        nbf: nowSec,
        exp,
        grants: { identity: input.identity, voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } } },
      },
      account.apiKeySecret ?? account.authToken,
    );
    return { token, expiresAt: exp * 1000 };
  },

  "twilio.call.create": async (ctx: TwilioCtx, input: { from: string; to: string; url?: string; record?: boolean; statusCallback?: string; idempotencyKey: string }): Promise<{ sid: string }> => once(ctx, "twilio.call.create", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [["From", input.from], ["To", input.to]];
    if (input.url) pairs.push(["Url", input.url]);
    if (input.record !== undefined) pairs.push(["Record", input.record ? "true" : "false"]);
    if (input.statusCallback) pairs.push(["StatusCallback", input.statusCallback]);
    const json = await twilio(ctx, account, "POST", `${accountBase(account)}/Calls.json`, pairs);
    const sid = str(json.sid);
    if (!sid) throw fail(ctx, "provider.bad_response", "Twilio did not return a call.");
    return { sid };
  }),

  "twilio.call.get": async (ctx: TwilioCtx, input: { sid: string }): Promise<{ status: string; durationSec?: number; from: string; to: string }> => {
    const account = requireAccount(ctx);
    const res = await request(ctx, account, "GET", `${accountBase(account)}/Calls/${encodeURIComponent(input.sid)}.json`);
    if (res.status === 404) throw fail(ctx, "validation.not_found", "Twilio does not have that call.");
    raise(ctx, res);
    const from = str(res.json.from);
    const to = str(res.json.to);
    const status = str(res.json.status);
    if (!from || !to || !status) throw fail(ctx, "provider.bad_response", "Twilio did not return the call.");
    const out: { status: string; durationSec?: number; from: string; to: string } = { status, from, to };
    const duration = str(res.json.duration) ?? (typeof res.json.duration === "number" ? String(res.json.duration) : null);
    if (duration !== null && Number.isInteger(Number(duration))) out.durationSec = Number(duration);
    return out;
  },

  "twilio.call.update": async (ctx: TwilioCtx, input: { sid: string; action: "hangup" | "hold" | "resume" | "redirect"; targetUrl?: string; idempotencyKey: string }): Promise<{ status: string }> => once(ctx, "twilio.call.update", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [];
    if (input.action === "hangup") pairs.push(["Status", "completed"]);
    else if (input.action === "hold") pairs.push(["Twiml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Enqueue>hold</Enqueue></Response>"]);
    else if (input.action === "resume") pairs.push(["Twiml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Dial><Queue>hold</Queue></Dial></Response>"]);
    else if (!input.targetUrl) throw fail(ctx, "validation.precondition_failed", "A redirect needs a target URL.");
    else pairs.push(["Url", input.targetUrl]);
    const json = await twilio(ctx, account, "POST", `${accountBase(account)}/Calls/${encodeURIComponent(input.sid)}.json`, pairs);
    return { status: str(json.status) ?? input.action };
  }),

  "twilio.recording.start": async (ctx: TwilioCtx, input: { callSid: string; announced: boolean; idempotencyKey: string }): Promise<{ recordingSid: string }> => once(ctx, "twilio.recording.start", input.idempotencyKey, async () => {
    if (!input.announced) throw fail(ctx, "validation.precondition_failed", "Recording stays off until the announcement has played.");
    const account = requireAccount(ctx);
    const json = await twilio(ctx, account, "POST", `${accountBase(account)}/Calls/${encodeURIComponent(input.callSid)}/Recordings.json`);
    const recordingSid = str(json.sid);
    if (!recordingSid) throw fail(ctx, "provider.bad_response", "Twilio did not return a recording.");
    return { recordingSid };
  }),

  "twilio.recording.stop": async (ctx: TwilioCtx, input: { callSid: string; recordingSid: string; idempotencyKey: string }): Promise<{ stopped: boolean }> => once(ctx, "twilio.recording.stop", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    await twilio(ctx, account, "POST", `${accountBase(account)}/Calls/${encodeURIComponent(input.callSid)}/Recordings/${encodeURIComponent(input.recordingSid)}.json`, [["Status", "stopped"]]);
    return { stopped: true };
  }),

  "twilio.recording.download": async (ctx: TwilioCtx, input: { recordingSid: string }): Promise<{ blobId: string; size: number; durationSec?: number }> => {
    const account = requireAccount(ctx);
    const meta = await request(ctx, account, "GET", `${accountBase(account)}/Recordings/${encodeURIComponent(input.recordingSid)}.json`);
    if (meta.status === 404) throw fail(ctx, "validation.not_found", "Twilio does not have that recording.");
    raise(ctx, meta);
    const media = await request(ctx, account, "GET", `${accountBase(account)}/Recordings/${encodeURIComponent(input.recordingSid)}.mp3`);
    raise(ctx, media);
    const bytes = Buffer.from(media.text);
    const id = blobId();
    const duration = str(meta.json.duration) ?? (typeof meta.json.duration === "number" ? String(meta.json.duration) : null);
    const durationSec = duration !== null && Number.isInteger(Number(duration)) ? Number(duration) : null;
    ctx.db.run("INSERT INTO twilio_blob (id, size, duration_sec, bytes_b64) VALUES (?, ?, ?, ?)", id, bytes.length, durationSec, bytes.toString("base64"));
    const out: { blobId: string; size: number; durationSec?: number } = { blobId: id, size: bytes.length };
    if (durationSec !== null) out.durationSec = durationSec;
    return out;
  },

  "twilio.recording.delete": async (ctx: TwilioCtx, input: { recordingSid: string; idempotencyKey: string }): Promise<{ deleted: boolean }> => once(ctx, "twilio.recording.delete", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const res = await request(ctx, account, "DELETE", `${accountBase(account)}/Recordings/${encodeURIComponent(input.recordingSid)}.json`);
    if (res.status === 404) throw fail(ctx, "validation.not_found", "Twilio does not have that recording.");
    raise(ctx, res);
    return { deleted: true };
  }),

  "twilio.sms.send": async (ctx: TwilioCtx, input: { from: string; to: string; body: string; mediaUrls?: string[]; statusCallback?: string; idempotencyKey: string }): Promise<{ sid: string; status: string }> => once(ctx, "twilio.sms.send", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [["From", input.from], ["To", input.to], ["Body", input.body]];
    for (const media of input.mediaUrls ?? []) pairs.push(["MediaUrl", media]);
    if (input.statusCallback) pairs.push(["StatusCallback", input.statusCallback]);
    const json = await twilio(ctx, account, "POST", `${accountBase(account)}/Messages.json`, pairs);
    const sid = str(json.sid);
    const status = str(json.status);
    if (!sid || !status) throw fail(ctx, "provider.bad_response", "Twilio did not return a message.");
    return { sid, status };
  }),

  "twilio.a2p.create_brand": async (ctx: TwilioCtx, input: { legalName: string; ein?: string; website?: string; vertical?: string; address?: { line1: string; city: string; region: string; postal: string; country: string }; contactName?: string; contactEmail?: string; idempotencyKey: string }): Promise<{ brandSid: string; status: string }> => once(ctx, "twilio.a2p.create_brand", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [["FriendlyName", input.legalName]];
    if (input.ein) pairs.push(["Ein", input.ein]);
    if (input.website) pairs.push(["Website", input.website]);
    if (input.vertical) pairs.push(["Vertical", input.vertical]);
    if (input.contactName) pairs.push(["ContactName", input.contactName]);
    if (input.contactEmail) pairs.push(["ContactEmail", input.contactEmail]);
    if (input.address) {
      pairs.push(["Street", input.address.line1], ["City", input.address.city], ["Region", input.address.region], ["PostalCode", input.address.postal], ["IsoCountry", input.address.country]);
    }
    const json = await twilio(ctx, account, "POST", `${MSG}/a2p/BrandRegistrations`, pairs);
    const brandSid = str(json.sid);
    if (!brandSid) throw fail(ctx, "provider.bad_response", "Twilio did not return a brand.");
    const status = str(json.status) ?? "pending";
    const prev = loadA2p(ctx) ?? blankA2p();
    saveA2p(ctx, { ...prev, brandSid, brandStatus: status, rejectedReason: str(json.failure_reason) });
    return { brandSid, status };
  }),

  "twilio.a2p.create_campaign": async (ctx: TwilioCtx, input: { brandSid: string; useCase: string; description: string; sampleMessages: string[]; optInDescription?: string; messagingServiceSid?: string; idempotencyKey: string }): Promise<{ campaignSid: string; status: string }> => once(ctx, "twilio.a2p.create_campaign", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    const pairs: [string, string][] = [["BrandSid", input.brandSid], ["UsAppToPersonUsecase", input.useCase], ["Description", input.description]];
    for (const sample of input.sampleMessages) pairs.push(["MessageSamples", sample]);
    if (input.optInDescription) pairs.push(["MessageFlow", input.optInDescription]);
    if (input.messagingServiceSid) pairs.push(["MessagingServiceSid", input.messagingServiceSid]);
    const json = await twilio(ctx, account, "POST", `${MSG}/a2p/Campaigns`, pairs);
    const campaignSid = str(json.sid);
    if (!campaignSid) throw fail(ctx, "provider.bad_response", "Twilio did not return a campaign.");
    const status = str(json.status) ?? "pending";
    const prev = loadA2p(ctx) ?? blankA2p();
    saveA2p(ctx, {
      ...prev,
      brandSid: prev.brandSid ?? input.brandSid,
      campaignSid,
      campaignStatus: status,
      messagingServiceSid: input.messagingServiceSid ?? prev.messagingServiceSid,
      rejectedReason: str(json.failure_reason) ?? prev.rejectedReason,
    });
    return { campaignSid, status };
  }),

  "twilio.a2p.status": async (ctx: TwilioCtx, input: { brandSid?: string; campaignSid?: string }): Promise<{ brand?: string; campaign?: string; rejectedReason?: string }> => {
    const account = requireAccount(ctx);
    const stored = loadA2p(ctx) ?? blankA2p();
    let brand = stored.brandStatus;
    let campaign = stored.campaignStatus;
    let rejected = stored.rejectedReason;
    if (input.brandSid) {
      const res = await request(ctx, account, "GET", `${MSG}/a2p/BrandRegistrations/${encodeURIComponent(input.brandSid)}`);
      if (res.status !== 404) {
        raise(ctx, res);
        brand = str(res.json.status) ?? brand;
        rejected = str(res.json.failure_reason) ?? rejected;
      }
    }
    if (input.campaignSid) {
      const res = await request(ctx, account, "GET", `${MSG}/a2p/Campaigns/${encodeURIComponent(input.campaignSid)}`);
      if (res.status !== 404) {
        raise(ctx, res);
        campaign = str(res.json.status) ?? campaign;
        rejected = str(res.json.failure_reason) ?? rejected;
      }
    }
    saveA2p(ctx, { ...stored, brandSid: input.brandSid ?? stored.brandSid, brandStatus: brand, campaignSid: input.campaignSid ?? stored.campaignSid, campaignStatus: campaign, rejectedReason: rejected });
    const out: { brand?: string; campaign?: string; rejectedReason?: string } = {};
    if (brand) out.brand = brand;
    if (campaign) out.campaign = campaign;
    if (rejected) out.rejectedReason = rejected;
    return out;
  },

  "twilio.a2p.attach_number": async (ctx: TwilioCtx, input: { messagingServiceSid: string; numberSid: string; idempotencyKey: string }): Promise<{ attached: boolean }> => once(ctx, "twilio.a2p.attach_number", input.idempotencyKey, async () => {
    const account = requireAccount(ctx);
    await twilio(ctx, account, "POST", `${MSG}/Services/${encodeURIComponent(input.messagingServiceSid)}/PhoneNumbers`, [["PhoneNumberSid", input.numberSid]]);
    const prev = loadA2p(ctx) ?? blankA2p();
    saveA2p(ctx, { ...prev, messagingServiceSid: input.messagingServiceSid });
    return { attached: true };
  }),

  "twilio.health": async (ctx: TwilioCtx, _input: Record<string, unknown>): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> => {
    const t0 = Date.now();
    try {
      const account = requireAccount(ctx);
      const json = await twilio(ctx, account, "GET", `${accountBase(account)}.json`);
      const detail = str(json.status) ?? "unknown";
      const latencyMs = Math.max(0, Date.now() - t0);
      return { state: detail === "active" ? "healthy" : "degraded", detail, latencyMs };
    } catch (e) {
      if (e instanceof VyreErr && e.error.code === "provider.auth_failed") throw e;
      return { state: "down", detail: "unreachable", latencyMs: Math.max(0, Date.now() - t0) };
    }
  },

  "twilio.receive_webhook": async (ctx: TwilioCtx, input: WebhookIn): Promise<{ accepted: boolean; twiml?: string }> => recordWebhook(ctx, input),
};

function blobId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return `blb_${Buffer.from(b).toString("hex")}`;
}
