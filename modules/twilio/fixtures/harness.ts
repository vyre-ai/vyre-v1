// Test harness for the twilio handlers: an in-memory database, a recording ctx, a scripted Twilio (recorded responses matched by method and path, no socket is
// opened) and a fake host seam (made-up credentials, downloads in memory). Every call the module makes to another capability is checked against that capability's
// frozen input schema, as the invoke pipeline would, and every answer a handler gives is checked against its frozen output schema by the tests.
// The recorded bodies follow Twilio's API documentation as of the recording (incoming numbers, available numbers, applications, calls, recordings, messages, Trust Hub
// and A2P registrations, and the four webhook posts). Live-account proof waits on the owner's accounts (lead ruling 15); until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { setTwilioHost } from "../projections.ts";
import type { TwilioCtx, TwilioHost } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const ACCOUNT = "AC00000000000000000000000000000001";
export const AUTH = "auth-token-not-real";
export const API_KEY = "SK00000000000000000000000000000002"; // secret-scan: fake
export const PUBLIC_URL = "https://space.example.test";
export const BASIC_ACCOUNT = `Basic ${Buffer.from(`${ACCOUNT}:${AUTH}`).toString("base64")}`;
export const BASIC_KEY = `Basic ${Buffer.from(`${API_KEY}:${AUTH}`).toString("base64")}`;
export const REST = `/2010-04-01/Accounts/${ACCOUNT}`;
export const NUMBER_SID = "PN00000000000000000000000000000003";
export const APP_SID = "AP00000000000000000000000000000004";
export const CALL_SID = "CA00000000000000000000000000000005";
export const REC_SID = "RE00000000000000000000000000000006";
export const BRAND_SID = "BN00000000000000000000000000000007";
export const SERVICE_SID = "MG00000000000000000000000000000008";
export const CAMPAIGN_SID = "QE00000000000000000000000000000009";

const incoming = (over: Record<string, unknown> = {}) => ({
  sid: NUMBER_SID, phone_number: "+14155550123", friendly_name: "Main line", capabilities: { voice: true, sms: true, mms: false, fax: false },
  voice_url: `${PUBLIC_URL}/hooks/twilio/voice`, sms_url: `${PUBLIC_URL}/hooks/twilio/sms`, status_callback: `${PUBLIC_URL}/hooks/twilio/status`, ...over,
});

export const RECORDED = {
  incoming,
  numbersPage1: { incoming_phone_numbers: [incoming(), incoming({ sid: "PN00000000000000000000000000000010", phone_number: "+14155550124", friendly_name: "", voice_url: "", sms_url: null })], next_page_uri: `${REST}/IncomingPhoneNumbers.json?PageSize=1000&Page=1&PageToken=x` },
  numbersPage2: { incoming_phone_numbers: [incoming({ sid: "PN00000000000000000000000000000011", phone_number: "+14155550125", capabilities: { voice: true, sms: true, mms: true } })], next_page_uri: null },
  available: {
    available_phone_numbers: [
      { phone_number: "+14155550199", locality: "San Francisco", region: "CA", capabilities: { voice: true, sms: true, mms: true } },
      { phone_number: "+14155550198", locality: null, region: "CA", capabilities: { voice: true, sms: false, mms: false } },
    ],
  },
  noApp: { applications: [] },
  app: { applications: [{ sid: APP_SID, friendly_name: "Vyre spc_twilio", voice_url: "https://old.example.test/voice" }] },
  appCreated: { sid: APP_SID, friendly_name: "Vyre spc_twilio", voice_url: `${PUBLIC_URL}/hooks/twilio/voice` },
  call: { sid: CALL_SID, status: "queued", from: "+14155550123", to: "+14155550177", duration: null },
  callDone: { sid: CALL_SID, status: "completed", from: "+14155550123", to: "+14155550177", duration: "42" },
  recording: { sid: REC_SID, call_sid: CALL_SID, status: "in-progress", duration: "17" },
  message: { sid: "SM00000000000000000000000000000012", status: "queued" },
  account: { sid: ACCOUNT, status: "active", friendly_name: "Test" },
  endUser: { sid: "IT00000000000000000000000000000013" },
  profile: { sid: "BU00000000000000000000000000000014", status: "draft" },
  product: { sid: "BU00000000000000000000000000000015", status: "draft" },
  assignment: { sid: "BV00000000000000000000000000000016" },
  brand: { sid: BRAND_SID, status: "PENDING", failure_reason: null },
  brandFailed: { sid: BRAND_SID, status: "FAILED", failure_reason: "Business name does not match the EIN" },
  service: { sid: SERVICE_SID, friendly_name: "Vyre spc_twilio" },
  campaign: { sid: CAMPAIGN_SID, campaign_status: "IN_PROGRESS" },
  campaignList: { compliance: [{ sid: CAMPAIGN_SID, campaign_status: "VERIFIED", errors: [] }] },
  campaignFailed: { compliance: [{ sid: CAMPAIGN_SID, campaign_status: "FAILED", errors: [{ description: "Sample messages missing opt-out language" }] }] },
} as const;

/** The posts Twilio makes to the four hooks, as the form fields it sends. */
export const HOOKS = {
  voice: { CallSid: CALL_SID, AccountSid: ACCOUNT, From: "+14155550177", To: "+14155550123", CallStatus: "ringing", Direction: "inbound", CallerName: "LEE PAT" },
  sms: { MessageSid: "SM00000000000000000000000000000020", AccountSid: ACCOUNT, From: "+14155550177", To: "+14155550123", Body: "Can you call me?", NumMedia: "1", MediaUrl0: "https://api.twilio.com/media/ME1" },
  statusCall: { CallSid: CALL_SID, CallStatus: "completed", CallDuration: "42", From: "+14155550177", To: "+14155550123" },
  statusSms: { MessageSid: "SM00000000000000000000000000000021", MessageStatus: "undelivered", ErrorCode: "30003", To: "+14155550177", From: "+14155550123" },
  recording: { CallSid: CALL_SID, RecordingSid: REC_SID, RecordingStatus: "completed", RecordingUrl: `https://api.twilio.com${REST}/Recordings/${REC_SID}`, RecordingDuration: "17" },
} as const;

export interface Reply { status: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; url: string; path: string; headers: Record<string, string>; form: [string, string][] | null }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }

export function harness(o: { apiKey?: boolean; instruction?: Record<string, unknown> } = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const downloads: { url: string; mime?: string }[] = [];
  const scripted = new Map<string, Reply[]>();
  let clock = NOW;
  let ingestFails = false;
  let instruction: Record<string, unknown> = o.instruction ?? { action: "ring", targets: [{ kind: "person", id: "usr_maya0001" }], ringSeconds: 25, record: false };

  const host: TwilioHost = {
    async secret(_ctx, handle) {
      if (handle === "#Twilio_Account") return ACCOUNT;
      if (handle === "#Twilio_Auth") return AUTH;
      throw fail("provider.auth_failed", "0".repeat(32));
    },
    async optionalSecret(_ctx, handle) {
      if (handle !== "#Twilio_API_Key") throw new Error(`unexpected optional secret ${handle}`);
      return o.apiKey ? API_KEY : null;
    },
    async download(_ctx, a) {
      downloads.push(a);
      return { blobId: `blb_${downloads.length}`, size: 2000 + downloads.length, mime: a.mime ?? "application/octet-stream" };
    },
    async publicUrl() { return `${PUBLIC_URL}/`; },
  };
  setTwilioHost(host);

  const ctx: TwilioCtx = {
    space: "spc_twilio",
    principal: { kind: "service", id: "svc_engine01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      if (ingestFails) throw fail("internal.unavailable", ctx.trace.traceId);
      if (cap === "telephony.ingest_voice") return { callId: "cal_1", instruction };
      if (cap === "telephony.ingest_sms") return { smsId: "sms_1", optOut: false };
      if (cap === "telephony.ingest_status") return { applied: true };
      if (cap === "telephony.ingest_recording") return { callId: "cal_1", fileId: "fil_1" };
      throw new Error(`unexpected capability ${cap}`);
    },
    async http(url, init) {
      const method = init?.method ?? "GET";
      const u = new URL(url);
      const path = `${u.pathname}${u.search}`;
      const headers = init?.headers ?? {};
      const form = init?.body !== undefined ? [...new URLSearchParams(init.body).entries()] : null;
      requests.push({ method, url, path, headers, form });
      const queue = scripted.get(`${method} ${u.host}${path}`) ?? scripted.get(`${method} ${u.host}${u.pathname}`);
      if (!queue || queue.length === 0) throw new Error(`unscripted request ${method} ${u.host}${path}`);
      const reply = queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
      if (reply.throws) throw new Error("socket hang up");
      const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { status: reply.status, text: async () => text };
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, requests, downloads, host,
    /** Script what Twilio answers to `METHOD host/path[?query]`; a request that matches the path with its query is preferred; several replies are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    advance(ms: number) { clock += ms; },
    failIngest(on: boolean) { ingestFails = on; },
    setInstruction(i: Record<string, unknown>) { instruction = i; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** The error code of a thrown HostError, or "" for anything else. */
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
