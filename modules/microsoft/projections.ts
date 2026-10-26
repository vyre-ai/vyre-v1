// microsoft connector core (lane L5): the context subset the handlers use, the host seam, the one authenticated Graph call every capability
// goes through, the per-person read log and the stored state. Spec 2.18, ARCHITECTURE 8 and 8.1.
//
// The app registration's client secret never reaches module code (ARCH 8: secrets are resolved by name at the last moment). Whatever needs it
// or the Space's bytes goes through MsHost, which the host registers once at boot with setMsHost: the application token (client credentials),
// the member email map, the registration's non-secret identity, file bytes, blob storage and the two binary transfers ctx.http (text only)
// cannot carry. Application permissions reach every mailbox of the tenant; the Exchange application access policy narrows them to the mapped
// members, and the module narrows them again: every call names one member and is refused for an excluded one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";

export interface MsDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the microsoft handlers use; the host Ctx satisfies it. */
export interface MsCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  run?: string;
  now(): number;
  db: MsDb;
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

export interface MsHost {
  /** An application token (client credentials, scope .default) for the tenant. Throws provider.auth_failed when Microsoft refuses it. */
  mintToken(ctx: MsCtx, a: { connectionId: string }): Promise<{ token: string; expiresAt: number }>;
  /** Space members and the work email each has on record. */
  memberEmails(ctx: MsCtx): Promise<{ userId: string; email: string }[]>;
  /** The non-secret identity of the app registration stored under a Vault handle. */
  appRegistration(ctx: MsCtx, handle: string): Promise<{ clientId: string; tenantId: string }>;
  /** A Space file's name, type and bytes (for mail attachments). */
  fileBytes(ctx: MsCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  /** Store bytes as a blob and return its id. */
  putBlob(ctx: MsCtx, bytes: Uint8Array, mime: string): Promise<string>;
  /** GET a Graph content address with the token (following Graph's redirect) and store the bytes as a blob. */
  download(ctx: MsCtx, a: { url: string; token: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  /** PUT a Space file to a Graph content address and return Graph's JSON answer. */
  upload(ctx: MsCtx, a: { url: string; token: string; fileId: string }): Promise<unknown>;
}

let host: MsHost | null = null;
export function setMsHost(h: MsHost | null): void {
  host = h;
  tokens.clear();
}
export function needHost(ctx: Pick<MsCtx, "trace">): MsHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Microsoft 365 is not set up on this server." });
  return host;
}

// ---- constants

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const CONFIG_ID = "microsoft";
export const PERMISSIONS = ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite.All", "User.Read.All", "OnlineMeetingRecording.Read.All", "OnlineMeetingTranscript.Read.All"];

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

export function bad(ctx: Pick<MsCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_microsoft_core.sql", import.meta.url)), "utf8");

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

/** Make sure the microsoft tables exist: one cheap probe per call, the CREATE ... IF NOT EXISTS statements only when it fails. */
export function ensure(ctx: Pick<MsCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT id FROM microsoft_config WHERE id = ?`, CONFIG_ID);
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function config(ctx: MsCtx): Row | null {
  return first(ctx.db.all(`SELECT * FROM microsoft_config WHERE id = ?`, CONFIG_ID));
}

// ---- the one authenticated call

type Query = Record<string, string | number | boolean | undefined>;

export interface Call {
  /** the capability name, for the read log */
  cap: string;
  connectionId: string;
  /** act as this member (Graph /users/{id}); defaults to the caller's mapped address */
  as?: string | undefined;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** a full Graph address, or a path under /v1.0 starting with / */
  url: string;
  query?: Query;
  body?: unknown;
  /** send as this Accept header and keep the answer as text */
  text?: boolean;
  /** a list, delta or sync call, kept as sampled in the audit */
  bulk?: boolean;
  /** consent, verify and health run before a member map exists */
  open?: boolean;
  /** a tenant-level call (organization, subscriptions): no member is reached, so none is resolved */
  tenant?: boolean;
}

export interface Answer { status: number; json: Record<string, unknown>; text: string; sub: string; token: string }

const tokens = new Map<string, { token: string; expiresAt: number }>();
export const forgetTokens = (): void => tokens.clear();

export function query(q: Query | undefined): string {
  if (!q) return "";
  const p: string[] = [];
  for (const [k, v] of Object.entries(q)) if (v !== undefined) p.push(`${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
}

export const enc = (s: string): string => encodeURIComponent(s);

/** Who the call acts as: the caller's mapped address, or another mapped member for an admin or a service. */
export function subjectFor(ctx: MsCtx, c: Pick<Call, "connectionId" | "as" | "open">): string {
  const cfg = config(ctx);
  const person = ctx.principal.kind === "service" ? null : (ctx.actingFor ?? ctx.principal.id);
  const own = person ? strOrNull(first(ctx.db.all(`SELECT email FROM microsoft_member WHERE "userId" = ? AND mapped = ?`, person, 1)), "email") : null;
  const target = c.as ? normalizeEmail(c.as) : own;
  if (!target) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "You are not mapped to a Microsoft 365 user." });
  // Acting as someone else takes an admin or a service. The verify probe may always act as the member it names.
  if (c.as && target !== own && ctx.principal.kind !== "service" && !c.open) {
    if (ctx.authorize({ perm: "connectors.manage", level: "manage" }, { type: "connection", id: c.connectionId }).effect !== "allow") {
      throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only an admin can act as another member." });
    }
  }
  if (c.open) return target;
  if (!cfg || num(cfg, "configured") !== 1) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Microsoft 365 is not set up." });
  const member = first(ctx.db.all(`SELECT excluded, mapped FROM microsoft_member WHERE email = ?`, target));
  if (!member || num(member, "mapped") !== 1) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "That address is not a mapped Microsoft 365 user." });
  if (num(member, "excluded") === 1) throw fail("permission.no_grant", ctx.trace.traceId, { message: "That member is excluded from the Microsoft connection." });
  return target;
}

async function tokenFor(ctx: MsCtx, connectionId: string, fresh: boolean): Promise<string> {
  const hit = tokens.get(connectionId);
  if (!fresh && hit && hit.expiresAt - ctx.now() > 60_000) return hit.token;
  const minted = await needHost(ctx).mintToken(ctx, { connectionId });
  tokens.set(connectionId, minted);
  return minted.token;
}

/** One read log row per call, keyed by the person whose data was reached. */
function logCall(ctx: MsCtx, subject: string, cap: string, bulk: boolean): void {
  ctx.db.run(
    `INSERT INTO microsoft_read_log (id, subject, actor, cap, bulk, at) VALUES (?, ?, ?, ?, ?, ?)`,
    newId("mrl", ctx.now()), subject, ctx.actingFor ?? ctx.principal.id, cap, bulk ? 1 : 0, ctx.now(),
  );
}

/** `/users/{member}` for a path under it. */
export const userUrl = (sub: string, path = ""): string => `${GRAPH}/users/${enc(sub)}${path}`;

const full = (url: string): string => (url.startsWith("https://") ? url : GRAPH + url);

/** Who a call will act as, with the same checks as a call and no log row (for building URLs before the call that logs). */
export function resolveSubject(ctx: MsCtx, c: Pick<Call, "connectionId" | "as" | "open">): string {
  ensure(ctx);
  return subjectFor(ctx, c);
}

/** The member a call acts as and an application token, for transfers the host performs itself. Writes the same read log row as a call. */
export async function bearer(ctx: MsCtx, c: Pick<Call, "cap" | "connectionId" | "as" | "open" | "bulk">): Promise<{ sub: string; token: string }> {
  ensure(ctx);
  const sub = subjectFor(ctx, c);
  logCall(ctx, sub, c.cap, c.bulk === true);
  return { sub, token: await tokenFor(ctx, c.connectionId, false) };
}

/** The call, answered as Graph gave it. A 401 mints a new token once. Never throws for an HTTP status; a network failure is provider.network. */
export async function apiRaw(ctx: MsCtx, c: Call): Promise<Answer> {
  ensure(ctx);
  const sub = c.tenant ? "tenant" : subjectFor(ctx, c);
  logCall(ctx, sub, c.cap, c.bulk === true);
  const url = full(c.url) + query(c.query);
  for (let attempt = 0; ; attempt++) {
    const token = await tokenFor(ctx, c.connectionId, attempt > 0);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: c.text ? "text/plain, text/vtt, */*" : "application/json" };
    if (c.body !== undefined) headers["content-type"] = "application/json";
    let res: { status: number; text(): Promise<string> };
    try {
      res = await ctx.http(url, { method: c.method ?? "GET", headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) });
    } catch (e) {
      if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
      throw fail("provider.network", ctx.trace.traceId, { message: "Microsoft could not be reached." });
    }
    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (!c.text) {
      try {
        const parsed = text ? (JSON.parse(text) as unknown) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
      } catch {
        if (res.status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft answered something unreadable." });
      }
    }
    return { status: res.status, json, text, sub, token };
  }
}

/** The call, with Graph's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: MsCtx, c: Call): Promise<Record<string, unknown>> {
  const a = await apiRaw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a.status, a.json);
}

const AUTH = new Set(["Authorization_RequestDenied", "InsufficientPrivileges", "InvalidAuthenticationToken", "Authentication_ExpiredToken", "AuthenticationError"]);
const GONE = new Set(["syncStateNotFound", "resyncRequired", "SyncStateNotFound"]);

/** Map a Graph error status and code. Graph's own message is not passed on: it can echo what the person typed. */
export function refusal(ctx: Pick<MsCtx, "trace">, status: number, json: Record<string, unknown>) {
  const err = (json.error ?? {}) as { code?: unknown };
  const code = String(err.code ?? "");
  const details = { status, ...(code ? { code } : {}) };
  const t = ctx.trace.traceId;
  if (status === 429 || code === "ApplicationThrottled" || code === "ErrorTooManyRequests") return fail("provider.rate_limited", t, { message: "Microsoft asked us to slow down.", details });
  if (status === 401 || AUTH.has(code)) return fail("provider.auth_failed", t, { message: "Microsoft did not accept the app sign-in. Check the consent and the app permissions.", details });
  if (status === 403) return fail("permission.no_grant", t, { message: "Microsoft would not let the app reach that. Check the Exchange application access policy.", details });
  if (status === 404) return fail("validation.not_found", t, { message: "Microsoft has no such item.", details });
  if (status === 410 || GONE.has(code)) return fail("validation.precondition_failed", t, { message: "That Microsoft sync position has expired.", details });
  if (status === 400) return fail("validation.bad_input", t, { message: "Microsoft could not use that request.", details });
  if (status === 409 || status === 412) return fail("validation.precondition_failed", t, { message: "Microsoft refused because the item changed.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Microsoft is not answering right now.", details });
  return fail("provider.bad_response", t, { message: "Microsoft answered something unexpected.", details });
}

export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

/** A Graph next link carries its page position as $skiptoken (or $skip); the contract hands the position back as a plain token. */
export function skipTokenOf(nextLink: unknown): string | undefined {
  if (typeof nextLink !== "string") return undefined;
  try {
    const u = new URL(nextLink);
    return u.searchParams.get("$skiptoken") ?? u.searchParams.get("$skip") ?? undefined;
  } catch {
    return undefined;
  }
}

// ---- small readers shared by the handlers

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const int = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : undefined;
};

export const inline = {};
export const consumers = {};
export const codecs = {};
