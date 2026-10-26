// campaigns: shared row logic for the handlers (errors, input parsing, ids, row shapes, time windows, templates) and the event consumers.
// This file is the bottom of the module's import graph: build.ts imports it, send.ts imports it and build.ts, index.ts imports all.
// Consumers (mode async) keep the engine's inputs current without a call context: replies and delivery news mark members and sends, and a record event
// enrols a contact into a running triggered campaign in state `screening`; the next engine pass screens that contact (Do-not-contact, adds only) before any send.
// @reads ./migrations/0001_campaigns.sql

import { ERROR_CODES, VyreErr } from "../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../packages/contracts/src/types.ts";
import { mintUuid } from "../../lib/ids.ts";

export type Row = Record<string, unknown>;
export type Kind = "one_time" | "sequence" | "triggered";
export type State = "draft" | "scheduled" | "running" | "paused" | "stopped" | "completed";
export type StepType = "email" | "wait" | "branch" | "sms" | "task" | "call_task";

export interface CampaignConfig {
  /** Public origin for unsubscribe links, for example https://harbor.vyre.run. Links are relative when absent. */
  publicBase?: string;
  /** Members handled per engine pass. */
  batch?: number;
}

let configured: CampaignConfig | null = null;

/** The host calls this once at start. Tests pass what they need; null clears. */
export function configureCampaigns(config: CampaignConfig | null): void {
  configured = config;
}

export const campaignConfig = (): CampaignConfig => configured ?? {};

// ---- errors and input helpers -------------------------------------------------------------------------------

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const isNull = (v: unknown): boolean => v === null || v === undefined;
export const flag = (v: unknown): boolean => v === 1 || v === true;
export const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];
export const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
export const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;

export function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (!isRec(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input;
}

export function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = optStr(ctx, o, key);
  if (v === undefined || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optInt(ctx: Ctx, o: Record<string, unknown>, key: string, min?: number, max?: number): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || (min !== undefined && v < min) || (max !== undefined && v > max)) {
    fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  }
  return v;
}

export function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function strList(text: unknown): string[] {
  const v = parseJson(text);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function pageOf(ctx: Ctx, o: Record<string, unknown>): { offset: number; limit: number } {
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) fail(ctx, "validation.bad_input", "The cursor is not valid.", { field: "cursor" });
  return { offset, limit: optInt(ctx, o, "limit", 1, 500) ?? 100 };
}

// ---- crypto (Web Crypto; node:crypto stays in kernel and vault, B3) -------------------------------------------

const enc = new TextEncoder();

export function randomToken(bytes = 24): string {
  let s = "";
  for (const b of globalThis.crypto.getRandomValues(new Uint8Array(bytes))) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stable number from text, for assigning a variant the same way every time. */
export function bucket(text: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // FNV alone keeps the low bit of the last characters; a final mix spreads every input bit over the result
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % mod;
}

// ---- rows -----------------------------------------------------------------------------------------------------

export interface CampaignOut {
  campaignId: string;
  name: string;
  kind: Kind;
  state: State;
  owner: string;
  audienceCount: number;
  sent: number;
  replies: number;
}

export function mustCampaign(ctx: Ctx, campaignId: string): Row {
  const row = one(ctx, "SELECT * FROM campaigns_campaign WHERE id = ?", campaignId);
  if (!row || !isNull(row.deleted_at)) fail(ctx, "validation.not_found", "That campaign does not exist.");
  return row;
}

export function membersOf(ctx: Ctx, campaignId: string): Row[] {
  return many(ctx, "SELECT * FROM campaigns_member WHERE campaign_id = ?", campaignId);
}

export function sendsOf(ctx: Ctx, campaignId: string): Row[] {
  return many(ctx, "SELECT * FROM campaigns_send WHERE campaign_id = ?", campaignId);
}

export function campaignOut(ctx: Ctx, row: Row): CampaignOut {
  const id = str(row.id);
  const members = membersOf(ctx, id);
  return {
    campaignId: id,
    name: str(row.name),
    kind: str(row.kind) as Kind,
    state: str(row.state) as State,
    owner: str(row.owner),
    audienceCount: members.length,
    sent: sendsOf(ctx, id).length,
    replies: members.filter((m) => !isNull(m.replied_at)).length,
  };
}

export interface StepOut {
  key: string;
  type: StepType;
  config: Record<string, unknown>;
  next?: string[];
}

export function stepsOf(ctx: Ctx, campaignId: string): StepOut[] {
  return many(ctx, "SELECT * FROM campaigns_step WHERE campaign_id = ?", campaignId)
    .sort((a, b) => num(a.position) - num(b.position))
    .map((r) => {
      const cfg = parseJson(r.config);
      const out: StepOut = { key: str(r.key), type: str(r.type) as StepType, config: isRec(cfg) ? cfg : {} };
      const nx = parseJson(r.next);
      if (Array.isArray(nx)) out.next = nx.filter((x): x is string => typeof x === "string");
      return out;
    });
}

export interface Windows {
  days: number[];
  from: string;
  to: string;
  /** zone used when a contact has none */
  tz: string;
}

export const DEFAULT_WINDOWS: Windows = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", tz: "UTC" };

export function windowsOf(row: Row): Windows {
  const w = parseJson(row.windows);
  if (!isRec(w)) return DEFAULT_WINDOWS;
  const days = Array.isArray(w.days) ? w.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6) : DEFAULT_WINDOWS.days;
  return {
    days,
    from: typeof w.from === "string" && /^\d{2}:\d{2}$/.test(w.from) ? w.from : DEFAULT_WINDOWS.from,
    to: typeof w.to === "string" && /^\d{2}:\d{2}$/.test(w.to) ? w.to : DEFAULT_WINDOWS.to,
    tz: typeof w.tz === "string" && validZone(w.tz) ? w.tz : DEFAULT_WINDOWS.tz,
  };
}

// ---- time -----------------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zoneParts(ts: number, tz: string): { day: number; minutes: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  let weekday = "Sun";
  let hour = 0;
  let minute = 0;
  for (const p of f.formatToParts(new Date(ts))) {
    if (p.type === "weekday") weekday = p.value;
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
  }
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return { day: day < 0 ? 0 : day, minutes: hour * 60 + minute };
}

const clock = (text: string): number => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
const MINUTE = 60_000;

/** True when `ts` falls inside the send window as seen in the recipient's zone. */
export function inWindow(ts: number, w: Windows, tz: string): boolean {
  const zone = validZone(tz) ? tz : w.tz;
  const p = zoneParts(ts, zone);
  return w.days.includes(p.day) && p.minutes >= clock(w.from) && p.minutes < clock(w.to);
}

/** The first minute at or after `ts` that is inside the window for that zone; `ts` itself when it already is; ts + 8 days when no day is open. */
export function nextOpen(ts: number, w: Windows, tz: string): number {
  const eight = 8 * 24 * 60 * MINUTE;
  if (w.days.length === 0) return ts + eight;
  if (inWindow(ts, w, tz)) return ts;
  const start = Math.ceil(ts / MINUTE) * MINUTE;
  for (let t = start; t < start + eight; t += 15 * MINUTE) {
    if (!inWindow(t, w, tz)) continue;
    // the window opened somewhere in the last 15 minutes: find the exact minute
    for (let m = Math.max(start, t - 14 * MINUTE); m < t; m += MINUTE) if (inWindow(m, w, tz)) return m;
    return t;
  }
  return ts + eight;
}

// ---- merge fields ---------------------------------------------------------------------------------------------

/** Replace {{field}} with the contact's value; first_name comes from name; an unknown field becomes empty. */
export function render(text: string, fields: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (_m, key: string) => {
    if (key === "first_name" && typeof fields.name === "string" && fields.first_name === undefined) return fields.name.trim().split(/\s+/)[0] ?? "";
    const v = fields[key];
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  });
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(at + 1).toLowerCase();
}

/** The contract types a reply by `eml_` id (campaign.replied, campaigns.replies). A mail id is one already; an SMS reply is known by its conversation id, which takes the same suffix under the eml prefix. */
export function asMessageId(ref: string): string {
  if (ref.startsWith("eml_")) return ref;
  const at = ref.indexOf("_");
  return `eml_${at < 0 ? ref : ref.slice(at + 1)}`;
}

// ---- consumers ------------------------------------------------------------------------------------------------

export interface ProjTx {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface ProjEvent {
  at: number;
  actor: string;
  payload: Uint8Array;
}

function payloadOf(e: ProjEvent): Row {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(e.payload));
    return isRec(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const rowsOf = (tx: ProjTx, sql: string, ...args: unknown[]): Row[] => tx.all(sql, ...args) as Row[];

/** A contact replied: stop on reply is applied by the engine, the member is only marked here. Idempotent per message. */
export function markReply(tx: ProjTx, campaignId: string, recordId: string, ref: string, at: number): void {
  if (rowsOf(tx, "SELECT * FROM campaigns_reply WHERE message_ref = ?", ref).length > 0) return;
  tx.run("INSERT INTO campaigns_reply (id, campaign_id, record_id, message_ref, at) VALUES (?, ?, ?, ?, ?)", `rpl_${ref}_${campaignId}`.slice(0, 200), campaignId, recordId, ref, at);
  const m = rowsOf(tx, "SELECT * FROM campaigns_member WHERE campaign_id = ? AND record_id = ?", campaignId, recordId)[0];
  if (m && isNull(m.replied_at)) tx.run("UPDATE campaigns_member SET replied_at = ? WHERE id = ?", at, str(m.id));
}

function onMailReceived(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e);
  if (typeof p.campaignId === "string" && typeof p.contactId === "string" && typeof p.messageId === "string") markReply(tx, p.campaignId, p.contactId, p.messageId, e.at);
}

function onCampaignReply(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e);
  // SMS replies have no message id yet; the conversation id stands in as the reference
  if (p.channel === "email") return;
  if (typeof p.campaignId === "string" && typeof p.contactId === "string" && typeof p.conversationId === "string") markReply(tx, p.campaignId, p.contactId, p.conversationId, e.at);
}

function setSend(tx: ProjTx, ref: string, status: string): void {
  for (const s of rowsOf(tx, "SELECT * FROM campaigns_send WHERE message_ref = ?", ref)) {
    if (s.status === "bounced" || s.status === "complained") continue;
    tx.run("UPDATE campaigns_send SET status = ? WHERE id = ?", status, str(s.id));
  }
}

const onDelivered = (tx: ProjTx, e: ProjEvent): void => {
  const p = payloadOf(e);
  if (typeof p.messageId === "string") setSend(tx, p.messageId, "delivered");
};
const onBounced = (tx: ProjTx, e: ProjEvent): void => {
  const p = payloadOf(e);
  if (typeof p.messageId === "string") setSend(tx, p.messageId, "bounced");
};
const onComplained = (tx: ProjTx, e: ProjEvent): void => {
  const p = payloadOf(e);
  if (typeof p.messageId === "string") setSend(tx, p.messageId, "complained");
};

function flagMember(tx: ProjTx, ref: string, column: "opened" | "clicked"): void {
  for (const s of rowsOf(tx, "SELECT * FROM campaigns_send WHERE message_ref = ?", ref)) tx.run(`UPDATE campaigns_member SET ${column} = ? WHERE id = ?`, 1, str(s.member_id));
}

const onOpened = (tx: ProjTx, e: ProjEvent): void => {
  const p = payloadOf(e);
  if (typeof p.messageId === "string") flagMember(tx, p.messageId, "opened");
};
const onClicked = (tx: ProjTx, e: ProjEvent): void => {
  const p = payloadOf(e);
  if (typeof p.messageId === "string") flagMember(tx, p.messageId, "clicked");
};

/** A record event enrols the contact into every running triggered campaign whose trigger names that event and record type. */
function onRecordEvent(name: string): (tx: ProjTx, e: ProjEvent) => void {
  return (tx, e) => {
    const p = payloadOf(e);
    const recordId = p.recordId;
    const type = p.type;
    if (typeof recordId !== "string" || typeof type !== "string") return;
    for (const c of rowsOf(tx, "SELECT * FROM campaigns_campaign WHERE kind = ?", "triggered")) {
      if (c.state !== "running" || !isNull(c.deleted_at)) continue;
      const settings = parseJson(c.settings);
      const trigger = isRec(settings) && isRec(settings.trigger) ? settings.trigger : undefined;
      if (!trigger || (trigger.event ?? "record.created") !== name || trigger.type !== type) continue;
      if (rowsOf(tx, "SELECT * FROM campaigns_member WHERE campaign_id = ? AND record_id = ?", str(c.id), recordId).length > 0) continue;
      tx.run(
        "INSERT INTO campaigns_member (id, campaign_id, record_id, address, phone, tz, variant, state, step_key, due_at, opened, clicked, replied_at, reply_announced, sent_count, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        `mem_${str(c.id).slice(4)}_${recordId}`.slice(0, 200), str(c.id), recordId, null, null, null, null, "screening", null, e.at, 0, 0, null, 0, 0, null, e.at,
      );
    }
  };
}

function consumer(name: string, event: string, on: (tx: ProjTx, e: ProjEvent) => void) {
  return { name, version: 1, mode: "async" as const, rebuild: "replay" as const, on: { [event]: on } as Record<string, (tx: ProjTx, e: ProjEvent) => void> };
}

export const consumers = {
  "campaigns.mail_received": consumer("campaigns.mail_received", "mail.received", onMailReceived),
  "campaigns.campaign_reply": consumer("campaigns.campaign_reply", "conversation.campaign_reply", onCampaignReply),
  "campaigns.delivered": consumer("campaigns.delivered", "message.delivered", onDelivered),
  "campaigns.bounced": consumer("campaigns.bounced", "message.bounced", onBounced),
  "campaigns.complained": consumer("campaigns.complained", "message.complained", onComplained),
  "campaigns.opened": consumer("campaigns.opened", "message.opened", onOpened),
  "campaigns.clicked": consumer("campaigns.clicked", "message.clicked", onClicked),
  "campaigns.record_created": consumer("campaigns.record_created", "record.created", onRecordEvent("record.created")),
  "campaigns.record_updated": consumer("campaigns.record_updated", "record.updated", onRecordEvent("record.updated")),
};

export const inline = {};
