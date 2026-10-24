// Number routes and hours for the Twilio connector. Spec 2.18: ring the owner, then a list, then voicemail, inside the number's hours.
import { makeError, VyreErr } from "../../../host/src/routes/errors.ts";

export interface TraceCtx { trace: { traceId: string } }
export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface NumberCtx extends TraceCtx { db: Db }

type Code =
  | "provider.auth_failed"
  | "provider.rate_limited"
  | "provider.bad_response"
  | "provider.network"
  | "validation.duplicate"
  | "validation.bad_input"
  | "validation.precondition_failed"
  | "validation.not_found";

export function fail(ctx: TraceCtx, code: Code, message?: string): VyreErr {
  return new VyreErr(makeError(code, ctx.trace.traceId, message ? { message } : {}));
}

export interface Party { kind: "person" | "agent" | "group"; id: string }
export interface NumberRoute {
  ring: Party[];
  ringSeconds: number;
  voicemail: boolean;
  voicemailTranscript: boolean;
}
export interface HourWindow { day: number; start: string; end: string }
export interface NumberHours {
  zone: string;
  weekly: HourWindow[];
  outsideHours: "voicemail" | "ring" | "reject";
}
export type VoiceDecision =
  | { action: "ring"; targets: Party[]; ringSeconds: number; thenVoicemail: boolean; transcript: boolean }
  | { action: "voicemail"; transcript: boolean }
  | { action: "reject" };

export interface StoredNumber {
  sid: string;
  e164: string;
  friendlyName: string | null;
  capabilities: string[];
  voiceUrl: string | null;
  smsUrl: string | null;
  statusUrl: string | null;
  twimlAppSid: string | null;
  route: NumberRoute;
  hours: NumberHours;
}

const WEEKDAY: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const KINDS = new Set(["person", "agent", "group"]);
const XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";

export function defaultRoute(ownerId: string): NumberRoute {
  return { ring: [{ kind: "person", id: ownerId }], ringSeconds: 20, voicemail: true, voicemailTranscript: true };
}

export function defaultHours(): NumberHours {
  const weekly: HourWindow[] = [];
  for (let day = 1; day <= 5; day += 1) weekly.push({ day, start: "09:00", end: "17:00" });
  return { zone: "UTC", weekly, outsideHours: "voicemail" };
}

export function asRow(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function strCell(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" ? v : null;
}

function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function checkRoute(ctx: TraceCtx, route: NumberRoute): void {
  if (!Array.isArray(route.ring) || route.ring.length === 0) throw fail(ctx, "validation.bad_input", "A route rings at least the owner.");
  if (!Number.isInteger(route.ringSeconds) || route.ringSeconds < 5 || route.ringSeconds > 120) {
    throw fail(ctx, "validation.bad_input", "Ring time is between 5 and 120 seconds.");
  }
  for (const p of route.ring) {
    if (!KINDS.has(p.kind) || typeof p.id !== "string" || p.id.length === 0) throw fail(ctx, "validation.bad_input", "Each ring target needs a kind and an id.");
  }
  if (typeof route.voicemail !== "boolean" || typeof route.voicemailTranscript !== "boolean") {
    throw fail(ctx, "validation.bad_input", "Voicemail flags are yes or no.");
  }
}

export function checkHours(ctx: TraceCtx, hours: NumberHours): void {
  if (hours.outsideHours !== "voicemail" && hours.outsideHours !== "ring" && hours.outsideHours !== "reject") {
    throw fail(ctx, "validation.bad_input", "Outside hours is voicemail, ring or reject.");
  }
  if (typeof hours.zone !== "string" || hours.zone.length === 0) throw fail(ctx, "validation.bad_input", "Hours need a time zone.");
  try { new Intl.DateTimeFormat("en-US", { timeZone: hours.zone }); } catch { throw fail(ctx, "validation.bad_input", "Hours need a known time zone."); }
  if (!Array.isArray(hours.weekly)) throw fail(ctx, "validation.bad_input", "Hours need a weekly list.");
  for (const w of hours.weekly) {
    if (!Number.isInteger(w.day) || w.day < 0 || w.day > 6) throw fail(ctx, "validation.bad_input", "A day is 0 (Sunday) through 6.");
    if (minutesOf(w.start) < 0 || minutesOf(w.end) < 0) throw fail(ctx, "validation.bad_input", "Hours use 24-hour HH:MM.");
  }
}

export function localMinutes(nowMs: number, zone: string): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  let hour = Number(get("hour").replace(/[^\d]/g, ""));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute").replace(/[^\d]/g, ""));
  const weekday = get("weekday").replace(/\./g, "");
  return { day: WEEKDAY[weekday] ?? WEEKDAY[weekday.slice(0, 3)] ?? 0, minutes: hour * 60 + minute };
}

export function withinHours(hours: NumberHours, nowMs: number): boolean {
  const local = localMinutes(nowMs, hours.zone);
  for (const w of hours.weekly) {
    if (w.day !== local.day) continue;
    const start = minutesOf(w.start);
    const end = minutesOf(w.end);
    if (start < 0 || end < 0) continue;
    if (end > start) {
      if (local.minutes >= start && local.minutes < end) return true;
    } else if (end < start) {
      if (local.minutes >= start || local.minutes < end) return true;
    }
  }
  return false;
}

export function decideVoice(route: NumberRoute, hours: NumberHours, nowMs: number): VoiceDecision {
  const open = withinHours(hours, nowMs);
  if (!open && hours.outsideHours === "reject") return { action: "reject" };
  if (!open && hours.outsideHours === "voicemail") return { action: "voicemail", transcript: route.voicemailTranscript };
  return {
    action: "ring",
    targets: route.ring,
    ringSeconds: route.ringSeconds,
    thenVoicemail: route.voicemail,
    transcript: route.voicemailTranscript,
  };
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function recordTwiml(transcript: boolean): string {
  return `${XML}<Response><Say>Please leave a message after the tone.</Say><Record maxLength="120" playBeep="true" transcribe="${transcript ? "true" : "false"}"/></Response>`;
}

export function voiceTwiml(decision: VoiceDecision, actionUrl: string): string {
  if (decision.action === "reject") return `${XML}<Response><Reject/></Response>`;
  if (decision.action === "voicemail") return recordTwiml(decision.transcript);
  if (decision.targets.length === 0) return decision.thenVoicemail ? recordTwiml(decision.transcript) : `${XML}<Response><Hangup/></Response>`;
  const clients = decision.targets.map((p) => `<Client>${xmlEscape(p.id)}</Client>`).join("");
  const action = decision.thenVoicemail ? ` action="${xmlEscape(actionUrl)}"` : "";
  return `${XML}<Response><Dial timeout="${decision.ringSeconds}" sequential="true"${action}>${clients}</Dial></Response>`;
}

const NUMBER_COLS = "sid, e164, friendly_name, capabilities, voice_url, sms_url, status_url, twiml_app_sid, route_json, hours_json";

function capsOf(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function fromRow(row: Record<string, unknown>): StoredNumber | null {
  const sid = strCell(row, "sid");
  const e164 = strCell(row, "e164");
  const route = parseJson<NumberRoute>(strCell(row, "route_json"));
  const hours = parseJson<NumberHours>(strCell(row, "hours_json"));
  if (!sid || !e164 || !route || !hours) return null;
  return {
    sid,
    e164,
    friendlyName: strCell(row, "friendly_name"),
    capabilities: capsOf(row.capabilities),
    voiceUrl: strCell(row, "voice_url"),
    smsUrl: strCell(row, "sms_url"),
    statusUrl: strCell(row, "status_url"),
    twimlAppSid: strCell(row, "twiml_app_sid"),
    route,
    hours,
  };
}

export function getNumber(ctx: NumberCtx, sid: string): StoredNumber | null {
  const rows = ctx.db.all(`SELECT ${NUMBER_COLS} FROM twilio_number WHERE sid = ?`, sid);
  const row = asRow(rows[0]);
  return row ? fromRow(row) : null;
}

export function numberByE164(ctx: NumberCtx, e164: string): StoredNumber | null {
  const rows = ctx.db.all(`SELECT ${NUMBER_COLS} FROM twilio_number WHERE e164 = ?`, e164);
  const row = asRow(rows[0]);
  return row ? fromRow(row) : null;
}

export function listNumbers(ctx: NumberCtx): StoredNumber[] {
  const rows = ctx.db.all(`SELECT ${NUMBER_COLS} FROM twilio_number`);
  const out: StoredNumber[] = [];
  for (const item of rows) {
    const row = asRow(item);
    const n = row ? fromRow(row) : null;
    if (n) out.push(n);
  }
  return out;
}

export function saveNumber(ctx: NumberCtx, n: StoredNumber): void {
  const caps = JSON.stringify(n.capabilities);
  const route = JSON.stringify(n.route);
  const hours = JSON.stringify(n.hours);
  if (getNumber(ctx, n.sid)) {
    ctx.db.run(
      "UPDATE twilio_number SET e164 = ?, friendly_name = ?, capabilities = ?, voice_url = ?, sms_url = ?, status_url = ?, twiml_app_sid = ?, route_json = ?, hours_json = ? WHERE sid = ?",
      n.e164, n.friendlyName, caps, n.voiceUrl, n.smsUrl, n.statusUrl, n.twimlAppSid, route, hours, n.sid,
    );
    return;
  }
  ctx.db.run(
    "INSERT INTO twilio_number (sid, e164, friendly_name, capabilities, voice_url, sms_url, status_url, twiml_app_sid, route_json, hours_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    n.sid, n.e164, n.friendlyName, caps, n.voiceUrl, n.smsUrl, n.statusUrl, n.twimlAppSid, route, hours,
  );
}

export function deleteNumber(ctx: NumberCtx, sid: string): void {
  ctx.db.run("DELETE FROM twilio_number WHERE sid = ?", sid);
}

export function setNumberRoute(ctx: NumberCtx, sid: string, route: NumberRoute): StoredNumber {
  checkRoute(ctx, route);
  const n = getNumber(ctx, sid);
  if (!n) throw fail(ctx, "validation.not_found", "That number is not in this Space.");
  const next = { ...n, route };
  saveNumber(ctx, next);
  return next;
}

export function setNumberHours(ctx: NumberCtx, sid: string, hours: NumberHours): StoredNumber {
  checkHours(ctx, hours);
  const n = getNumber(ctx, sid);
  if (!n) throw fail(ctx, "validation.not_found", "That number is not in this Space.");
  const next = { ...n, hours };
  saveNumber(ctx, next);
  return next;
}
