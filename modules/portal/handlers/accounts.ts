// portal: site end-user accounts (spec 2.20, 3.6; ARCH 7.6, 8.4). Outside people sign in to a site; they are not Space members.
// Sign-in is a magic link or a password, per account. Sessions are their own rows and never map to a Space principal.
// Each account links to one record (a contact or client) with row rules, so a site API only ever shows it the rows related to that record.
// Secrets: passwords are PBKDF2-SHA256 with a per-account salt; link and session tokens are random 256-bit values stored as SHA-256 hashes.
// Email goes through the PortalMailer the host passes to configurePortal (it sends through mail.send); this file never builds a URL.
// Files links and posting into a record conversation (portal.file_link, portal.post) are not served here; they stay on the generated stubs.
// @reads ../migrations/0001_portal_accounts.sql

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";

/** The Space's default portal: the site id portal accounts use when the Space has no Sites site (ruling 73). The host registers it as a resource at boot. */
export const DEFAULT_PORTAL_SITE = "sit_default";

export type AccountMethod = "magic_link" | "password";
export type AccountState = "invited" | "active" | "disabled";
export type LinkPurpose = "invite" | "sign_in" | "reset";

export interface LinkMessage {
  siteId: string;
  accountId: string;
  email: string;
  purpose: LinkPurpose;
  /** the one-use token to put in the link; shown to nobody else */
  token: string;
  expiresAt: number;
}

export interface PortalMailer {
  sendLink(msg: LinkMessage): Promise<void>;
}

export interface PortalConfig {
  mailer: PortalMailer;
  /** PBKDF2 iterations; tests lower it */
  iterations?: number;
  sessionTtlMs?: number;
  inviteTtlMs?: number;
  linkTtlMs?: number;
}

const DEFAULTS = { iterations: 600_000, sessionTtlMs: 14 * 24 * 3600_000, inviteTtlMs: 7 * 24 * 3600_000, linkTtlMs: 15 * 60_000 };
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const MAX_LINKS = 5;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
const PAGE_DEFAULT = 100;
const PAGE_MAX = 500;

let configured: PortalConfig | null = null;

/** The host calls this once at start. Tests pass a fake mailer; null clears. */
export function configurePortal(config: PortalConfig | null): void {
  configured = config;
}

type Row = Record<string, unknown>;

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

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
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

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isNull = (v: unknown): boolean => v === null || v === undefined;
const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];
const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;

function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = optStr(ctx, o, key);
  if (v === undefined || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function normEmail(ctx: Ctx, raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/.test(email)) {
    fail(ctx, "validation.bad_input", "That does not look like an email address.", { field: "email" });
  }
  return email;
}

function config(ctx: Ctx): Required<PortalConfig> {
  if (!configured) fail(ctx, "validation.precondition_failed", "Site accounts cannot send email on this server yet. Connect a sending inbox first.");
  return { ...DEFAULTS, ...configured };
}

function pageOf(ctx: Ctx, o: Record<string, unknown>): { offset: number; limit: number } {
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) fail(ctx, "validation.bad_input", "That page cursor is not valid.", { field: "cursor" });
  const lim = o.limit;
  if (lim !== undefined && lim !== null && (typeof lim !== "number" || !Number.isInteger(lim) || lim < 1 || lim > PAGE_MAX)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  return { offset, limit: typeof lim === "number" ? lim : PAGE_DEFAULT };
}

// ---- crypto (Web Crypto; node:crypto stays in kernel and vault, B3) -------------------------------------------

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64url(text: string): Uint8Array {
  const s = text.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 256 random bits as base64url. */
export function newToken(): string {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const got = await pbkdf2(password, Uint8Array.from(unb64url(salt)), iterations);
  return sameBytes(got, unb64url(hash));
}

// A password check for an address with no account runs the same derivation, so the answer takes as long as a real one.
const DUMMY_SALT = new Uint8Array(16);

// ---- throttling ---------------------------------------------------------------------------------------------

function attempts(ctx: Ctx, bucket: string): number {
  const r = one(ctx, "SELECT * FROM portal_attempt WHERE bucket = ?", bucket);
  if (!r) return 0;
  return ctx.now() - num(r.window_start) >= WINDOW_MS ? 0 : num(r.count);
}

function bump(ctx: Ctx, bucket: string): void {
  const r = one(ctx, "SELECT * FROM portal_attempt WHERE bucket = ?", bucket);
  const now = ctx.now();
  if (!r) {
    ctx.db.run("INSERT INTO portal_attempt (bucket, count, window_start) VALUES (?, ?, ?)", bucket, 1, now);
  } else if (now - num(r.window_start) >= WINDOW_MS) {
    ctx.db.run("UPDATE portal_attempt SET count = ?, window_start = ? WHERE bucket = ?", 1, now, bucket);
  } else {
    ctx.db.run("UPDATE portal_attempt SET count = ? WHERE bucket = ?", num(r.count) + 1, bucket);
  }
}

function guard(ctx: Ctx, bucket: string, max: number): void {
  if (attempts(ctx, bucket) >= max) fail(ctx, "rate_limit.exceeded", "Too many tries. Wait a few minutes and try again.");
}

// ---- output shapes ------------------------------------------------------------------------------------------

export interface AccountOut {
  accountId: string;
  siteId: string;
  email: string;
  state: AccountState;
  recordId?: string;
}

function accountOut(r: Row): AccountOut {
  const out: AccountOut = { accountId: str(r.id), siteId: str(r.site_id), email: str(r.email), state: str(r.state) as AccountState };
  if (!isNull(r.record_id)) out.recordId = str(r.record_id);
  return out;
}

function mustAccount(ctx: Ctx, accountId: string): Row {
  const r = one(ctx, "SELECT * FROM portal_account WHERE id = ?", accountId);
  if (!r) fail(ctx, "validation.not_found", "That account does not exist.");
  return r;
}

// ---- tokens and sessions ------------------------------------------------------------------------------------

async function issueLink(ctx: Ctx, acct: Row, purpose: LinkPurpose, ttlMs: number): Promise<void> {
  const cfg = config(ctx);
  const token = newToken();
  const expiresAt = ctx.now() + ttlMs;
  const hash = await sha256hex(token);
  ctx.db.run("INSERT INTO portal_magic (token_hash, account_id, purpose, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)", hash, str(acct.id), purpose, expiresAt, null, ctx.now());
  try {
    await cfg.mailer.sendLink({ siteId: str(acct.site_id), accountId: str(acct.id), email: str(acct.email), purpose, token, expiresAt });
  } catch (e) {
    ctx.db.run("DELETE FROM portal_magic WHERE token_hash = ?", hash);
    ctx.log.warn("portal: link email failed", { accountId: str(acct.id), error: e instanceof Error ? e.message : String(e) });
    fail(ctx, "validation.precondition_failed", "The email could not be sent. Check the site's sending inbox and try again.");
  }
}

async function openSession(ctx: Ctx, acct: Row): Promise<string> {
  const cfg = config(ctx);
  const token = newToken();
  const now = ctx.now();
  ctx.db.run("INSERT INTO portal_session (token_hash, account_id, site_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)", await sha256hex(token), str(acct.id), str(acct.site_id), now, now + cfg.sessionTtlMs, null);
  ctx.emit("portal.signed_in", `site/${str(acct.site_id)}`, { accountId: str(acct.id), siteId: str(acct.site_id) });
  return token;
}

// ---- row rules ----------------------------------------------------------------------------------------------

/** What an account may see: rows of `recordType`, either the linked record itself or rows whose `via` field points at it. */
export interface RowRule {
  recordType: string;
  /** field on the rows that holds the id (or a list of ids) of the linked record; absent means the linked record itself */
  via?: string;
  /** type of the linked record; defaults to recordType when there is no via */
  linkedType?: string;
  /** allow list of field names the account may read; absent means all fields */
  fields?: string[];
}

const TYPE_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_ .-]{0,99}$/;

function parseRule(ctx: Ctx, raw: unknown): RowRule {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(ctx, "validation.bad_input", "The row rule must be an object with a recordType.", { field: "rowRule" });
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!["recordType", "via", "linkedType", "fields"].includes(k)) fail(ctx, "validation.bad_input", `The row rule has an unknown key: ${k}.`, { field: "rowRule" });
  }
  const typeOf = (key: string, v: unknown): string => {
    if (typeof v !== "string" || !TYPE_RE.test(v)) fail(ctx, "validation.bad_input", `${key} must be a record type name such as contact.`, { field: "rowRule" });
    return v;
  };
  const rule: RowRule = { recordType: typeOf("recordType", o.recordType) };
  if (o.via !== undefined) {
    if (typeof o.via !== "string" || !FIELD_RE.test(o.via)) fail(ctx, "validation.bad_input", "via must be a field name.", { field: "rowRule" });
    rule.via = o.via;
    if (o.linkedType === undefined) fail(ctx, "validation.bad_input", "A rule with via needs linkedType, the type of the linked record.", { field: "rowRule" });
  }
  if (o.linkedType !== undefined) rule.linkedType = typeOf("linkedType", o.linkedType);
  if (o.fields !== undefined) {
    if (!Array.isArray(o.fields) || o.fields.length === 0 || o.fields.length > 200 || !o.fields.every((f) => typeof f === "string" && FIELD_RE.test(f))) {
      fail(ctx, "validation.bad_input", "fields must be a list of field names.", { field: "rowRule" });
    }
    rule.fields = [...new Set(o.fields as string[])];
  }
  return rule;
}

function ruleFromRow(r: Row): RowRule {
  try {
    const v: unknown = JSON.parse(str(r.rule));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as RowRule) : { recordType: str(r.record_type) };
  } catch {
    return { recordType: str(r.record_type) };
  }
}

export interface PortalRecord {
  id: string;
  type: string;
  fields: Record<string, unknown>;
}

function refersTo(value: unknown, recordId: string): boolean {
  return value === recordId || (Array.isArray(value) && value.includes(recordId));
}

/** The rows an account may see, with fields cut to the rule's allow list. Nothing is visible without a linked record. */
export function filterRecords(rules: RowRule[], linkedRecordId: string | null, rows: PortalRecord[]): PortalRecord[] {
  if (linkedRecordId === null) return [];
  const out: PortalRecord[] = [];
  for (const row of rows) {
    const rule = rules.find((r) => r.recordType === row.type);
    if (!rule) continue;
    const visible = rule.via !== undefined ? refersTo(row.fields[rule.via], linkedRecordId) : row.id === linkedRecordId;
    if (!visible) continue;
    if (rule.fields === undefined) {
      out.push({ ...row, fields: { ...row.fields } });
    } else {
      const fields: Record<string, unknown> = {};
      for (const f of rule.fields) if (f in row.fields) fields[f] = row.fields[f];
      out.push({ id: row.id, type: row.type, fields });
    }
  }
  return out;
}

export interface PortalScope {
  accountId: string;
  siteId: string;
  recordId: string | null;
  rules: RowRule[];
}

/** Resolves a session token to the account and its rules. Expired, revoked and disabled-account sessions are refused. */
export async function resolveSession(ctx: Ctx, token: string): Promise<PortalScope> {
  const s = one(ctx, "SELECT * FROM portal_session WHERE token_hash = ?", await sha256hex(token));
  if (!s || !isNull(s.revoked_at)) fail(ctx, "auth.unauthenticated", "Sign in to continue.");
  if (num(s.expires_at) <= ctx.now()) fail(ctx, "auth.expired", "Your session has ended. Sign in again.");
  const a = one(ctx, "SELECT * FROM portal_account WHERE id = ?", s.account_id);
  if (!a || a.state !== "active") fail(ctx, "auth.unauthenticated", "Sign in to continue.");
  const rules = many(ctx, "SELECT * FROM portal_link WHERE account_id = ?", str(a.id)).map(ruleFromRow);
  return { accountId: str(a.id), siteId: str(a.site_id), recordId: isNull(a.record_id) ? null : str(a.record_id), rules };
}

// ---- handlers -----------------------------------------------------------------------------------------------

async function accountCreate(ctx: Ctx, input: unknown): Promise<{ account: AccountOut }> {
  const o = rec(ctx, input);
  const siteId = reqStr(ctx, o, "siteId");
  const email = normEmail(ctx, reqStr(ctx, o, "email"));
  const method = reqStr(ctx, o, "method");
  if (method !== "magic_link" && method !== "password") fail(ctx, "validation.bad_input", "Choose magic_link or password.", { field: "method" });
  const cfg = config(ctx);
  // Ruling 73: the Space's default portal needs no Sites; any other site must exist.
  if (siteId !== DEFAULT_PORTAL_SITE) await ctx.call("sites.get", { siteId });
  if (one(ctx, "SELECT * FROM portal_account WHERE site_id = ? AND email = ?", siteId, email)) fail(ctx, "validation.duplicate", "That email already has an account on this site.");
  const now = ctx.now();
  const id = nid(ctx, "pac");
  ctx.db.run(
    "INSERT INTO portal_account (id, site_id, email, method, state, password_hash, record_id, created_by, created_at, updated_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, siteId, email, method, "invited", null, null, ctx.principal.id, now, now, null,
  );
  const row = mustAccount(ctx, id);
  try {
    await issueLink(ctx, row, "invite", cfg.inviteTtlMs);
  } catch (e) {
    ctx.db.run("DELETE FROM portal_account WHERE id = ?", id);
    throw e;
  }
  ctx.emit("portal.account_created", `site/${siteId}`, { accountId: id, siteId });
  return { account: accountOut(row) };
}

async function redeem(ctx: Ctx, acct: Row | undefined, email: string, token: string, password: string | undefined): Promise<string> {
  const cfg = config(ctx);
  const bucket = `in|${email}`;
  const magic = one(ctx, "SELECT * FROM portal_magic WHERE token_hash = ?", await sha256hex(token));
  const ok = !!acct && !!magic && magic.account_id === acct.id && isNull(magic.used_at) && num(magic.expires_at) > ctx.now() && acct.state !== "disabled";
  if (!ok || !acct || !magic) {
    bump(ctx, bucket);
    fail(ctx, "auth.invalid_code", "That link is wrong, used or expired. Ask for a new one.");
  }
  if (acct.method === "password") {
    if (password === undefined) fail(ctx, "validation.bad_input", "Choose a password to finish signing in.", { field: "password" });
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) fail(ctx, "validation.bad_input", `Use a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, { field: "password" });
  } else if (password !== undefined) {
    fail(ctx, "validation.bad_input", "This account signs in with an emailed link, not a password.", { field: "password" });
  }
  const used = ctx.db.run("UPDATE portal_magic SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", ctx.now(), str(magic.token_hash));
  if (used.changes !== 1) {
    bump(ctx, bucket);
    fail(ctx, "auth.invalid_code", "That link is wrong, used or expired. Ask for a new one.");
  }
  const hash = password !== undefined ? await hashPassword(password, cfg.iterations) : null;
  if (hash !== null) ctx.db.run("UPDATE portal_account SET password_hash = ?, state = ?, updated_at = ? WHERE id = ?", hash, "active", ctx.now(), str(acct.id));
  else ctx.db.run("UPDATE portal_account SET state = ?, updated_at = ? WHERE id = ?", "active", ctx.now(), str(acct.id));
  ctx.db.run("DELETE FROM portal_attempt WHERE bucket = ?", bucket);
  return openSession(ctx, mustAccount(ctx, str(acct.id)));
}

async function withPassword(ctx: Ctx, acct: Row | undefined, email: string, password: string): Promise<string> {
  const bucket = `in|${email}`;
  const stored = acct && acct.method === "password" && acct.state === "active" && !isNull(acct.password_hash) ? str(acct.password_hash) : null;
  let good = false;
  if (stored === null) await pbkdf2(password, DUMMY_SALT, config(ctx).iterations);
  else good = await verifyPassword(password, stored);
  if (!good || stored === null || !acct) {
    bump(ctx, bucket);
    fail(ctx, "auth.bad_credentials", "The email or password is wrong.");
  }
  ctx.db.run("DELETE FROM portal_attempt WHERE bucket = ?", bucket);
  return openSession(ctx, acct);
}

async function signIn(ctx: Ctx, input: unknown): Promise<{ session: string }> {
  const o = rec(ctx, input);
  const siteId = reqStr(ctx, o, "siteId");
  const email = normEmail(ctx, reqStr(ctx, o, "email"));
  const password = optStr(ctx, o, "password");
  const token = optStr(ctx, o, "token");
  const cfg = config(ctx);
  const acct = one(ctx, "SELECT * FROM portal_account WHERE site_id = ? AND email = ?", siteId, email);
  const scoped = `${siteId}|${email}`;
  if (token !== undefined) {
    guard(ctx, `in|${scoped}`, MAX_FAILS);
    return { session: await redeem(ctx, acct, scoped, token, password) };
  }
  if (password !== undefined) {
    guard(ctx, `in|${scoped}`, MAX_FAILS);
    return { session: await withPassword(ctx, acct, scoped, password) };
  }
  // No secret given: send a link. The answer is the same whether or not the address has an account.
  const bucket = `link|${scoped}`;
  guard(ctx, bucket, MAX_LINKS);
  bump(ctx, bucket);
  if (acct && acct.state !== "disabled") {
    const purpose: LinkPurpose = acct.state === "invited" ? "invite" : acct.method === "password" ? "reset" : "sign_in";
    await issueLink(ctx, acct, purpose, purpose === "invite" ? cfg.inviteTtlMs : cfg.linkTtlMs);
  }
  return { session: "" };
}

async function linkRecord(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const o = rec(ctx, input);
  const accountId = reqStr(ctx, o, "accountId");
  const recordId = reqStr(ctx, o, "recordId");
  const rule = parseRule(ctx, o.rowRule);
  const acct = mustAccount(ctx, accountId);
  if (acct.state === "disabled") fail(ctx, "validation.precondition_failed", "That account is disabled. Nothing can be linked to it.");
  const linkedType = rule.linkedType ?? rule.recordType;
  await ctx.call("records.get", { type: linkedType, recordId });
  const previous = isNull(acct.record_id) ? null : str(acct.record_id);
  const now = ctx.now();
  if (previous !== null && previous !== recordId) ctx.db.run("DELETE FROM portal_link WHERE account_id = ?", accountId);
  ctx.db.run("UPDATE portal_account SET record_id = ?, updated_at = ? WHERE id = ?", recordId, now, accountId);
  const stored = JSON.stringify(rule);
  if (one(ctx, "SELECT * FROM portal_link WHERE account_id = ? AND record_type = ?", accountId, rule.recordType)) {
    ctx.db.run("UPDATE portal_link SET rule = ?, created_by = ?, at = ? WHERE account_id = ? AND record_type = ?", stored, ctx.principal.id, now, accountId, rule.recordType);
  } else {
    ctx.db.run("INSERT INTO portal_link (account_id, record_type, rule, created_by, at) VALUES (?, ?, ?, ?, ?)", accountId, rule.recordType, stored, ctx.principal.id, now);
  }
  ctx.emit("portal.record_linked", `record/${recordId}`, { accountId, recordId });
  return { ok: true };
}

async function accountsList(ctx: Ctx, input: unknown): Promise<{ accounts: AccountOut[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const siteId = reqStr(ctx, o, "siteId");
  const { offset, limit } = pageOf(ctx, o);
  await ctx.call("sites.get", { siteId });
  const rows = many(ctx, "SELECT * FROM portal_account WHERE site_id = ?", siteId).sort((a, b) => num(a.created_at) - num(b.created_at) || str(a.id).localeCompare(str(b.id)));
  const out: { accounts: AccountOut[]; next?: string; total: number } = { accounts: rows.slice(offset, offset + limit).map(accountOut), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function accountDisable(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const o = rec(ctx, input);
  const acct = mustAccount(ctx, reqStr(ctx, o, "accountId"));
  if (acct.state === "disabled") return { ok: true };
  const now = ctx.now();
  ctx.db.run("UPDATE portal_account SET state = ?, disabled_at = ?, updated_at = ? WHERE id = ?", "disabled", now, now, str(acct.id));
  ctx.db.run("UPDATE portal_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL", now, str(acct.id));
  ctx.db.run("DELETE FROM portal_magic WHERE account_id = ? AND used_at IS NULL", str(acct.id));
  return { ok: true };
}

async function rulesList(ctx: Ctx, input: unknown): Promise<{ rules: { accountId: string; recordType: string; rule: RowRule }[] }> {
  const o = rec(ctx, input);
  const siteId = reqStr(ctx, o, "siteId");
  await ctx.call("sites.get", { siteId });
  const rules: { accountId: string; recordType: string; rule: RowRule }[] = [];
  const accounts = many(ctx, "SELECT * FROM portal_account WHERE site_id = ?", siteId).sort((a, b) => num(a.created_at) - num(b.created_at) || str(a.id).localeCompare(str(b.id)));
  for (const a of accounts) {
    for (const l of many(ctx, "SELECT * FROM portal_link WHERE account_id = ?", str(a.id)).sort((x, y) => str(x.record_type).localeCompare(str(y.record_type)))) {
      rules.push({ accountId: str(a.id), recordType: str(l.record_type), rule: ruleFromRow(l) });
    }
  }
  return { rules };
}

export const accountHandlers = {
  "portal.account_create": (ctx: Ctx, input: unknown) => accountCreate(ctx, input),
  "portal.sign_in": (ctx: Ctx, input: unknown) => signIn(ctx, input),
  "portal.link_record": (ctx: Ctx, input: unknown) => linkRecord(ctx, input),
  "portal.accounts": (ctx: Ctx, input: unknown) => accountsList(ctx, input),
  "portal.account_disable": (ctx: Ctx, input: unknown) => accountDisable(ctx, input),
  "portal.rules": (ctx: Ctx, input: unknown) => rulesList(ctx, input),
};
