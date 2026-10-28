// forms: shared row logic for the handlers (errors, input parsing, ids, signing, rate limits, form loading) and the attribution projection.
// This file is the bottom of the module's import graph: links.ts, submit.ts and bookings.ts import from here, never the other way round.
// Crypto is Web Crypto only (boundary B3). Link tokens are `<linkId>.<signature>`; the signature is an HMAC-SHA-256 over the link id, record and expiry
// with the form's own random key, and only the SHA-256 of the whole token is stored. No emails ever appear in a URL (spec 2.11).
// @reads ./migrations/0001_forms.sql

import { ERROR_CODES, VyreErr } from "../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../packages/contracts/src/types.ts";
import { mintUuid } from "../../lib/ids.ts";

export type Row = Record<string, unknown>;
export type FormKind = "public" | "one_use" | "booking" | "survey";
export type FormState = "draft" | "published" | "closed";
export type FieldMode = "ask" | "show" | "hide";

export interface CaptchaVerifier {
  /** True when the token proves a human. The host wires Turnstile, hCaptcha or a self-hosted check here. */
  verify(token: string, ctx: Ctx): Promise<boolean>;
}

export interface FormSchemaField { key: string; title: string; type: string; required?: boolean; options?: Record<string, unknown> }

export interface FormsConfig {
  /** Host reads actual schema; public views expose metadata only for this form's selected fields. */
  schemaFields?(recordType: string): Promise<readonly FormSchemaField[]>;
  /** Current grant/status and live-folder check, scoped to this stored form owner. */
  canUpload?(publisherId: string, formId: string, folderId: string): boolean;
  captcha?: CaptchaVerifier;
  /** Public origin of the Space edge, for example https://harbor.vyre.run. Links are relative when absent. */
  publicBase?: string;
  /** Default submissions per minute per form when a form sets no limit. */
  defaultRateLimit?: number;
}

export const DEFAULT_RATE_LIMIT = 30;

let configured: FormsConfig | null = null;

/** The host calls this once at start. Tests pass a fake captcha verifier; null clears. */
export function configureForms(config: FormsConfig | null): void {
  configured = config;
}

export function formsConfig(): FormsConfig {
  return configured ?? {};
}

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

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

export function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

export function reqInt(ctx: Ctx, o: Record<string, unknown>, key: string, min?: number, max?: number): number {
  const v = optInt(ctx, o, key, min, max);
  if (v === undefined) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optBool(ctx: Ctx, o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
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
  const limit = optInt(ctx, o, "limit", 1, 500) ?? 100;
  return { offset, limit };
}

// ---- crypto (Web Crypto; node:crypto stays in kernel and vault, B3) -------------------------------------------

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await globalThis.crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", k, enc.encode(message))));
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function signToken(signingKey: string, linkId: string, recordId: string, expiresAt: number): Promise<string> {
  return `${linkId}.${await hmac(signingKey, `${linkId}|${recordId}|${expiresAt}`)}`;
}

// ---- forms ---------------------------------------------------------------------------------------------------

export interface FormOut {
  formId: string;
  name: string;
  recordType: string;
  kind: FormKind;
  state: FormState;
  slug: string;
  submissions: number;
}

export function mustForm(ctx: Ctx, formId: string): Row {
  const row = one(ctx, "SELECT * FROM forms_form WHERE id = ?", formId);
  if (!row || !isNull(row.deleted_at)) fail(ctx, "validation.not_found", "That form does not exist.");
  return row;
}

/** The public lookup: a closed, draft or deleted form answers as not found, so a slug reveals nothing. */
export function publishedBySlug(ctx: Ctx, slug: string, kinds?: FormKind[]): Row {
  const row = one(ctx, "SELECT * FROM forms_form WHERE slug = ?", slug);
  if (!row || !isNull(row.deleted_at) || row.state !== "published") fail(ctx, "validation.not_found", "That form is not open.");
  if (kinds && !kinds.includes(row.kind as FormKind)) fail(ctx, "validation.not_found", "That form is not open.");
  return row;
}

export function submissionCount(ctx: Ctx, formId: string): number {
  return many(ctx, "SELECT * FROM forms_submission WHERE form_id = ?", formId).length;
}

export function formOut(ctx: Ctx, row: Row): FormOut {
  return {
    formId: str(row.id),
    name: str(row.name),
    recordType: str(row.record_type),
    kind: str(row.kind) as FormKind,
    state: str(row.state) as FormState,
    slug: str(row.slug),
    submissions: submissionCount(ctx, str(row.id)),
  };
}

export function fieldsOf(ctx: Ctx, formId: string): Row[] {
  return many(ctx, "SELECT * FROM forms_field WHERE form_id = ?", formId).sort((a, b) => num(a.position) - num(b.position) || str(a.field).localeCompare(str(b.field)));
}

export function matchRuleOf(form: Row): string[] {
  const m = strList(form.match_rule);
  return m.length > 0 ? m : ["email"];
}

export function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base.length > 0 ? base : "form";
}

/** A slug nobody uses: the name, then the name with a short random tail. */
export function freeSlug(ctx: Ctx, name: string): string {
  const base = slugify(name);
  if (!one(ctx, "SELECT * FROM forms_form WHERE slug = ?", base)) return base;
  for (let i = 0; i < 20; i++) {
    const cand = `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    if (!one(ctx, "SELECT * FROM forms_form WHERE slug = ?", cand)) return cand;
  }
  return fail(ctx, "internal.unexpected", "Could not find a free address for the form.");
}

export interface NewForm {
  name: string;
  recordType: string;
  kind: FormKind;
  matchRule?: string[];
  rateLimit?: number;
}

/** Insert a draft form with a free address and a fresh signing key. Used by forms.create and bookings.page_create. */
export function insertForm(ctx: Ctx, f: NewForm): Row {
  const id = nid(ctx, "frm");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO forms_form (id, name, record_type, kind, state, slug, section, folder_id, match_rule, consent_text, captcha, upload_policy, rate_limit, theme, css, logic, thank_you, signing_key, created_by, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, f.name, f.recordType, f.kind, "draft", freeSlug(ctx, f.name), "space", null, JSON.stringify(f.matchRule ?? ["email"]), null, 0, null,
    f.rateLimit ?? formsConfig().defaultRateLimit ?? DEFAULT_RATE_LIMIT, null, null, null, null, randomToken(32), ctx.principal.id, now, now, null,
  );
  return mustForm(ctx, id);
}

export function publicUrl(form: Row): string {
  const base = (formsConfig().publicBase ?? "").replace(/\/+$/, "");
  return `${base}/${form.kind === "booking" ? "book" : "f"}/${str(form.slug)}`;
}

// ---- rate limits ---------------------------------------------------------------------------------------------

/**
 * Count a hit against a scope and refuse when the window already holds `limit` hits. The refused call is not counted, so a flood does not
 * extend its own ban. Old rows are removed as a side effect, so the table stays small.
 */
export function rateLimit(ctx: Ctx, scope: string, subject: string, limit: number, windowMs: number): void {
  const now = ctx.now();
  const mine = many(ctx, "SELECT * FROM forms_hit WHERE scope = ?", scope);
  let live = 0;
  for (const h of mine) {
    if (num(h.at) <= now - windowMs) ctx.db.run("DELETE FROM forms_hit WHERE id = ?", str(h.id));
    else if (subject === "*" || h.subject === subject) live += 1;
  }
  if (live >= limit) fail(ctx, "rate_limit.exceeded", "Too many submissions just now. Try again in a minute.", { retryAfterSeconds: Math.ceil(windowMs / 1000) });
  ctx.db.run("INSERT INTO forms_hit (id, scope, subject, at) VALUES (?, ?, ?, ?)", nid(ctx, "hit"), scope, subject, now);
}

// ---- attribution ---------------------------------------------------------------------------------------------

export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  clickIds?: Record<string, string>;
  referrer?: string;
  landingPage?: string;
  device?: string;
  location?: string;
  consent: boolean;
}

const TEXT_MAX = 500;
const CLICK_ID_MAX = 20;

/**
 * What may be kept. With consent everything given is kept. Without it only the campaign tags and the referrer host are kept:
 * click ids, the landing page query, device and location are dropped (consent-aware capture, spec 2.11).
 */
export function cleanAttribution(ctx: Ctx, raw: unknown, consentGiven: boolean): Attribution | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRec(raw)) fail(ctx, "validation.bad_input", "The attribution is not valid.", { field: "attribution" });
  const text = (key: string): string | undefined => {
    const v = raw[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") fail(ctx, "validation.bad_input", "The attribution is not valid.", { field: `attribution.${key}` });
    const t = v.trim().slice(0, TEXT_MAX);
    return t.length > 0 ? t : undefined;
  };
  const out: Attribution = { consent: consentGiven };
  const utmSource = text("utmSource");
  if (utmSource !== undefined) out.utmSource = utmSource;
  const utmMedium = text("utmMedium");
  if (utmMedium !== undefined) out.utmMedium = utmMedium;
  const utmCampaign = text("utmCampaign");
  if (utmCampaign !== undefined) out.utmCampaign = utmCampaign;
  const ref = text("referrer");
  if (ref !== undefined) out.referrer = consentGiven ? ref : hostOf(ref);
  if (!consentGiven) return out;
  const landing = text("landingPage");
  if (landing !== undefined) out.landingPage = landing;
  const device = text("device");
  if (device !== undefined) out.device = device;
  const location = text("location");
  if (location !== undefined) out.location = location;
  const ids = raw.clickIds;
  if (ids !== undefined && ids !== null) {
    if (!isRec(ids)) fail(ctx, "validation.bad_input", "The attribution is not valid.", { field: "attribution.clickIds" });
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(ids).slice(0, CLICK_ID_MAX)) {
      if (typeof v === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(k)) clean[k] = v.slice(0, 200);
    }
    if (Object.keys(clean).length > 0) out.clickIds = clean;
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export interface SourceRule {
  ruleId: string;
  match: Record<string, unknown>;
  channel: string;
  order: number;
}

export function sourceRules(ctx: Ctx): SourceRule[] {
  return many(ctx, "SELECT * FROM forms_source_rule")
    .sort((a, b) => num(a.position) - num(b.position))
    .map((r) => {
      const m = parseJson(r.match_json);
      return { ruleId: str(r.id), match: isRec(m) ? m : {}, channel: str(r.channel), order: num(r.position) };
    });
}

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-social", "paid_social", "display"]);
const SOCIAL_HOSTS = ["facebook.", "instagram.", "linkedin.", "twitter.", "x.com", "t.co", "tiktok.", "youtube.", "reddit."];

function ruleMatches(match: Record<string, unknown>, a: Attribution): boolean {
  const keys = Object.keys(match);
  if (keys.length === 0) return false;
  for (const key of keys) {
    const want = match[key];
    let have: string | undefined;
    if (key === "utmSource" || key === "utmMedium" || key === "utmCampaign" || key === "referrer" || key === "landingPage") have = a[key];
    else if (key === "clickId") have = Object.keys(a.clickIds ?? {}).join(",");
    else return false;
    const h = (have ?? "").toLowerCase();
    const wants = Array.isArray(want) ? want : [want];
    const hit = wants.some((w) => {
      if (typeof w !== "string") return false;
      const x = w.toLowerCase();
      if (x === "*") return h.length > 0;
      if (key === "referrer" || key === "landingPage" || key === "clickId") return h.includes(x);
      return h === x;
    });
    if (!hit) return false;
  }
  return true;
}

/** The channel of a click: the first Source rule that matches, else a built-in guess from the tags. */
export function channelFor(rules: SourceRule[], a: Attribution): string {
  for (const r of rules) if (ruleMatches(r.match, a)) return r.channel;
  const medium = (a.utmMedium ?? "").toLowerCase();
  if (PAID_MEDIUMS.has(medium) || Object.keys(a.clickIds ?? {}).some((k) => ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id"].includes(k))) return "paid";
  if (medium === "email") return "email";
  if (medium === "social") return "social";
  const ref = (a.referrer ?? "").toLowerCase();
  if (ref.length > 0) return SOCIAL_HOSTS.some((h) => ref.includes(h)) ? "social" : "referral";
  if ((a.utmSource ?? "").length > 0) return "other";
  return "direct";
}

/**
 * Keep First source and Latest source for a record. First is set only the first time a record is seen with attribution (on create);
 * Latest moves on every submission that carries attribution.
 */
export function recordAttribution(ctx: Ctx, recordId: string, a: Attribution, created: boolean): void {
  const now = ctx.now();
  const channel = channelFor(sourceRules(ctx), a);
  const json = JSON.stringify(a);
  const cur = one(ctx, "SELECT * FROM forms_attribution WHERE record_id = ?", recordId);
  if (!cur) {
    ctx.db.run(
      "INSERT INTO forms_attribution (record_id, first, first_channel, first_at, latest, latest_channel, latest_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      recordId, json, channel, now, json, channel, now,
    );
    return;
  }
  if (created && isNull(cur.first)) ctx.db.run("UPDATE forms_attribution SET first = ?, first_channel = ?, first_at = ? WHERE record_id = ?", json, channel, now, recordId);
  ctx.db.run("UPDATE forms_attribution SET latest = ?, latest_channel = ?, latest_at = ? WHERE record_id = ?", json, channel, now, recordId);
}

export function attributionOf(ctx: Ctx, recordId: string): { first?: Attribution; latest?: Attribution } {
  const cur = one(ctx, "SELECT * FROM forms_attribution WHERE record_id = ?", recordId);
  const out: { first?: Attribution; latest?: Attribution } = {};
  if (!cur) return out;
  const f = parseJson(cur.first);
  const l = parseJson(cur.latest);
  if (isRec(f)) out.first = f as unknown as Attribution;
  if (isRec(l)) out.latest = l as unknown as Attribution;
  return out;
}

export function channelsOf(ctx: Ctx, recordId: string): { first?: string; latest?: string } {
  const cur = one(ctx, "SELECT * FROM forms_attribution WHERE record_id = ?", recordId);
  const out: { first?: string; latest?: string } = {};
  if (cur && !isNull(cur.first_channel)) out.first = str(cur.first_channel);
  if (cur && !isNull(cur.latest_channel)) out.latest = str(cur.latest_channel);
  return out;
}

// ---- projection ----------------------------------------------------------------------------------------------

// Forms write their rows on the call and derive nothing from events, so the module declares no projections.
export const inline = {};
export const consumers = {};
