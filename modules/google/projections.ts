// google connector core (lane L5): the context subset the handlers use, the host seam, the one authenticated call every capability goes through,
// the per-person read log and the stored state. Spec 2.18, ARCHITECTURE 8 and 8.1.
//
// The service account key never reaches module code (ARCH 8: secrets are resolved by name at the last moment). Whatever needs the key or the
// Space's bytes goes through GoogleHost, which the host registers once at boot with setGoogleHost: minting a delegated token, the member
// email map, the key's non-secret identity, file bytes, blob storage and the two binary transfers ctx.http (text only) cannot carry.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface GoogleDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the google handlers use; the host Ctx satisfies it. */
export interface GoogleCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: GoogleDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(
    action: { perm: string | null; level: "view" | "use" | "edit" | "manage" },
    resource: { type: string; id: string | null },
  ): { effect: "allow" | "deny" | "hold"; reason: string; decisionId: string };
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
  schedule(at: number | string, cap: string, input: unknown): Promise<string>;
}

export type Row = Record<string, string | number | null>;

// ---- host seam

export interface GoogleHost {
  /** A Google access token for `sub`, delegated from the Google_DWD key, limited to `scopes`. Throws provider.auth_failed when Google refuses. */
  mintToken(ctx: GoogleCtx, a: { connectionId: string; sub: string; scopes: string[] }): Promise<{ token: string; expiresAt: number }>;
  /** Space members and the work email each has on record. */
  memberEmails(ctx: GoogleCtx): Promise<{ userId: string; email: string }[]>;
  /** The non-secret identity of the service account stored under a Vault handle. */
  serviceAccount(ctx: GoogleCtx, handle: string): Promise<{ clientId: string; clientEmail: string }>;
  /** A Space file's name, type and bytes (for Gmail attachments). */
  fileBytes(ctx: GoogleCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  /** Store bytes as a blob and return its id. */
  putBlob(ctx: GoogleCtx, bytes: Uint8Array, mime: string): Promise<string>;
  /** GET a Google download address with the token and store the bytes as a blob. */
  download(ctx: GoogleCtx, a: { url: string; token: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  /** Send a Space file to Google as a multipart upload and return Google's JSON answer. */
  upload(ctx: GoogleCtx, a: { url: string; token: string; fileId: string; metadata: Record<string, unknown> }): Promise<unknown>;
}

let host: GoogleHost | null = null;
export function setGoogleHost(h: GoogleHost | null): void {
  host = h;
  tokens.clear();
}
export function needHost(ctx: Pick<GoogleCtx, "trace">): GoogleHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Google is not set up on this server." });
  return host;
}

// ---- constants

export const SCOPE = "https://www.googleapis.com/auth/";
export const SCOPES = ["gmail.modify", "calendar", "drive", "spreadsheets", "documents", "meetings.space.readonly"].map((s) => SCOPE + s);
export const ADMIN_CONSOLE_URL = "https://admin.google.com/ac/owl/domainwidedelegation";
export const CONFIG_ID = "google";

export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const CALENDAR = "https://www.googleapis.com/calendar/v3";
export const DRIVE = "https://www.googleapis.com/drive/v3";
export const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
export const DOCS = "https://docs.googleapis.com/v1/documents";
export const MEET = "https://meet.googleapis.com/v2";
export const EVENTS = "https://workspaceevents.googleapis.com/v1";

// ---- ids and rows

export const newId = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const EMAIL = /^[^\s@]+@[^\s@]+$/;
export const normalizeEmail = (a: string): string => a.trim().toLowerCase();

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export function str(row: Row | null, key: string): string {
  const v = row?.[key];
  return typeof v === "string" ? v : "";
}
export function strOrNull(row: Row | null, key: string): string | null {
  const v = row?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
export function num(row: Row | null, key: string): number {
  const v = row?.[key];
  return typeof v === "number" ? v : 0;
}

export function bad(ctx: Pick<GoogleCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_google_core.sql", import.meta.url)), "utf8");

export function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Make sure the google tables exist: one cheap probe per call, the CREATE ... IF NOT EXISTS statements only when it fails. */
export function ensure(ctx: Pick<GoogleCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT id FROM google_config WHERE id = ?`, CONFIG_ID);
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function config(ctx: GoogleCtx): Row | null {
  return first(ctx.db.all(`SELECT * FROM google_config WHERE id = ?`, CONFIG_ID));
}

// ---- the one authenticated call

type Query = Record<string, string | number | boolean | readonly string[] | undefined>;

export interface Call {
  /** the capability name, for the read log */
  cap: string;
  connectionId: string;
  /** act as this member; defaults to the caller's mapped address */
  as?: string | undefined;
  /** one short scope name from SCOPES, e.g. "gmail.modify" */
  scope: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  query?: Query;
  body?: unknown;
  /** a list or sync call, kept as sampled in the audit */
  bulk?: boolean;
  /** setup, probe and health run before a member map exists */
  open?: boolean;
}

export interface Answer { status: number; json: Record<string, unknown> }

const tokens = new Map<string, { token: string; expiresAt: number }>();
export const forgetTokens = (): void => tokens.clear();

export function query(q: Query | undefined): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    if (typeof v === "object") for (const one of v) p.append(k, one);
    else p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Who the call acts as: the caller's mapped address, or another mapped member for an admin or a service. */
export function subjectFor(ctx: GoogleCtx, c: Pick<Call, "connectionId" | "as" | "open">): string {
  const cfg = config(ctx);
  const admin = strOrNull(cfg, "adminEmail");
  const person = ctx.principal.kind === "service" ? null : (ctx.actingFor ?? ctx.principal.id);
  const own = person ? strOrNull(first(ctx.db.all(`SELECT email FROM google_member WHERE "userId" = ? AND mapped = ?`, person, 1)), "email") : null;
  const target = c.as ? normalizeEmail(c.as) : own;
  if (!target) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "You are not mapped to a Google Workspace user." });
  if (c.as && target !== own && ctx.principal.kind !== "service") {
    if (ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "connection", id: c.connectionId }).effect !== "allow") {
      throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only an admin can act as another member." });
    }
  }
  if (c.open && target === admin) return target;
  if (!cfg || num(cfg, "configured") !== 1) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Google delegation is not set up." });
  const member = first(ctx.db.all(`SELECT excluded, mapped FROM google_member WHERE email = ?`, target));
  if (target !== admin && (!member || num(member, "mapped") !== 1)) {
    throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "That address is not a mapped Workspace user." });
  }
  if (member && num(member, "excluded") === 1) throw fail("permission.no_grant", ctx.trace.traceId, { message: "That member is excluded from Google delegation." });
  return target;
}

async function tokenFor(ctx: GoogleCtx, connectionId: string, sub: string, scope: string, fresh: boolean): Promise<string> {
  const key = `${connectionId}|${sub}|${scope}`;
  const hit = tokens.get(key);
  if (!fresh && hit && hit.expiresAt - ctx.now() > 60_000) return hit.token;
  const minted = await needHost(ctx).mintToken(ctx, { connectionId, sub, scopes: [SCOPE + scope] });
  tokens.set(key, minted);
  return minted.token;
}

/** One read log row per call, keyed by the person whose Google data was reached. */
function logCall(ctx: GoogleCtx, subject: string, cap: string, bulk: boolean): void {
  ctx.db.run(
    `INSERT INTO google_read_log (id, subject, actor, cap, bulk, at) VALUES (?, ?, ?, ?, ?, ?)`,
    newId("grl", ctx.now()), subject, ctx.actingFor ?? ctx.principal.id, cap, bulk ? 1 : 0, ctx.now(),
  );
}

/** The member a call acts as and a token for the scope, for transfers the host performs itself. Writes the same read log row as a call. */
export async function bearer(ctx: GoogleCtx, c: Pick<Call, "cap" | "connectionId" | "as" | "scope" | "open" | "bulk">): Promise<{ sub: string; token: string }> {
  ensure(ctx);
  const sub = subjectFor(ctx, c);
  logCall(ctx, sub, c.cap, c.bulk === true);
  return { sub, token: await tokenFor(ctx, c.connectionId, sub, c.scope, false) };
}

/** The call, answered as Google gave it. A 401 mints a new token once. Never throws for an HTTP status; a network failure is provider.network. */
export async function apiRaw(ctx: GoogleCtx, c: Call): Promise<Answer & { sub: string; token: string }> {
  ensure(ctx);
  const sub = subjectFor(ctx, c);
  logCall(ctx, sub, c.cap, c.bulk === true);
  const url = c.url + query(c.query);
  for (let attempt = 0; ; attempt++) {
    const token = await tokenFor(ctx, c.connectionId, sub, c.scope, attempt > 0);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (c.body !== undefined) headers["content-type"] = "application/json";
    let res: { status: number; text(): Promise<string> };
    try {
      res = await ctx.http(url, { method: c.method ?? "GET", headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) });
    } catch (e) {
      if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
      throw fail("provider.network", ctx.trace.traceId, { message: "Google could not be reached." });
    }
    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      const parsed = text ? (JSON.parse(text) as unknown) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      if (res.status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Google answered something unreadable." });
    }
    return { status: res.status, json, sub, token };
  }
}

/** The call, with Google's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: GoogleCtx, c: Call): Promise<Record<string, unknown>> {
  const a = await apiRaw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a.status, a.json);
}

const RATE = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "RESOURCE_EXHAUSTED"]);
const AUTH = new Set(["authError", "unauthorized_client", "insufficientPermissions", "domainPolicy", "PERMISSION_DENIED", "UNAUTHENTICATED", "forbidden"]);

/** Map a Google error status and reason. Google's own message is not passed on: it can echo what the person typed. */
export function refusal(ctx: Pick<GoogleCtx, "trace">, status: number, json: Record<string, unknown>) {
  const err = (json.error ?? {}) as { errors?: { reason?: unknown }[]; status?: unknown; message?: unknown };
  const reason = String(err.errors?.[0]?.reason ?? err.status ?? "");
  const details = { status, ...(reason ? { reason } : {}) };
  const t = ctx.trace.traceId;
  if (status === 429 || RATE.has(reason)) return fail("provider.rate_limited", t, { message: "Google asked us to slow down.", details });
  if (status === 401) return fail("provider.auth_failed", t, { message: "Google did not accept the delegated sign-in.", details });
  if (status === 403) {
    if (AUTH.has(reason) && reason !== "forbidden") return fail("provider.auth_failed", t, { message: "Google did not allow this account to do that. Check the delegated scopes.", details });
    return fail("permission.no_grant", t, { message: "Google would not let this account reach that.", details });
  }
  if (status === 404) return fail("validation.not_found", t, { message: "Google has no such item.", details });
  if (status === 400) return fail("validation.bad_input", t, { message: "Google could not use that request.", details });
  if (status === 409 || status === 410 || status === 412) return fail("validation.precondition_failed", t, { message: status === 410 ? "That Google sync position has expired." : "Google refused because the item changed.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Google is not answering right now.", details });
  return fail("provider.bad_response", t, { message: "Google answered something unexpected.", details });
}

export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

// ---- small readers shared by the handlers

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const int = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : undefined;
};
export const enc = (s: string): string => encodeURIComponent(s);

export const inline = {};
export const consumers = {};
export const codecs = {};
