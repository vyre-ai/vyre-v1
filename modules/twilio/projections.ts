// twilio store helpers and the one door to the Twilio APIs (spec 2.18; ARCH 8). The context subset the handlers use, the host seam (the Vault items, downloads into
// blobs, the Space's public address), the schema apply, the HTTP call with its error mapping and the readers the handlers share. The module never keeps a secret:
// the host hands one over for one call through `secret` and the module encodes it into one header (or signs one token with it).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";

export interface TwilioDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the twilio handlers use; the host Ctx satisfies it. */
export interface TwilioCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  now(): number;
  db: TwilioDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface TwilioHost {
  /** The value stored in the Vault under a handle (Twilio_Account, Twilio_Auth, Twilio_API_Key), for one call. Throws provider.auth_failed when there is none. */
  secret(ctx: TwilioCtx, handle: string): Promise<string>;
  /** The same for an item that may be absent (the API key): null when the Space has none. */
  optionalSecret(ctx: TwilioCtx, handle: string): Promise<string | null>;
  /** GET an address with the Space's Twilio credentials and store the bytes as a blob (a recording). */
  download(ctx: TwilioCtx, a: { url: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
  /** The public address of this Space, where Twilio posts its webhooks (/hooks/twilio/...). */
  publicUrl(ctx: TwilioCtx): Promise<string>;
}

let host: TwilioHost | null = null;
/** The host registers its half once at boot (ruling 31). */
export function setTwilioHost(h: TwilioHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<TwilioCtx, "trace">): TwilioHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Twilio is not set up on this server." });
  return host;
}

export const HANDLE = { account: "#Twilio_Account", auth: "#Twilio_Auth", apiKey: "#Twilio_API_Key" } as const;
export const API = { rest: "https://api.twilio.com/2010-04-01", messaging: "https://messaging.twilio.com/v1", trusthub: "https://trusthub.twilio.com/v1" } as const;

// ---- readers

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const intOrUndef = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

export function bad(ctx: Pick<TwilioCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

export const E164 = /^\+[1-9][0-9]{6,14}$/;
export function phone(ctx: Pick<TwilioCtx, "trace">, v: unknown, what: string): string {
  return typeof v === "string" && E164.test(v) ? v : bad(ctx, `${what} must be a phone number with country code, like +14155550123.`);
}
/** A Twilio Sid: two letters and 32 hex characters. */
export function sid(ctx: Pick<TwilioCtx, "trace">, v: unknown, what: string): string {
  return typeof v === "string" && /^[A-Za-z]{2}[0-9a-fA-F]{32}$/.test(v) ? v : bad(ctx, `${what} is not a Twilio Sid.`);
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_twilio.sql", import.meta.url)), "utf8");

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

/** Make sure this module's tables exist: one cheap SELECT per call, the CREATE ... IF NOT EXISTS statements only when it fails. */
export function ensure(ctx: Pick<TwilioCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "dedupeKey" FROM twilio_hook_log WHERE "dedupeKey" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function getState(ctx: Pick<TwilioCtx, "db">, key: string): string | null {
  const row = first(ctx.db.all(`SELECT "value" FROM twilio_state WHERE "key" = ?`, key));
  return row && typeof row.value === "string" ? row.value : null;
}
export function setState(ctx: Pick<TwilioCtx, "db">, key: string, value: string): void {
  if (getState(ctx, key) === null) ctx.db.run(`INSERT OR IGNORE INTO twilio_state ("key", "value") VALUES (?, ?)`, key, value);
  else ctx.db.run(`UPDATE twilio_state SET "value" = ? WHERE "key" = ?`, value, key);
}

// ---- the API

export interface Answer {
  status: number;
  json: Json;
}

/** The Account Sid of the Space. */
export const accountSid = (ctx: TwilioCtx): Promise<string> => needHost(ctx).secret(ctx, HANDLE.account);

/** The Basic header Twilio wants: the API key Sid when the Space has an API key (else the Account Sid) and the secret. */
export async function authHeader(ctx: TwilioCtx): Promise<string> {
  const h = needHost(ctx);
  const key = await h.optionalSecret(ctx, HANDLE.apiKey);
  const user = key ?? (await h.secret(ctx, HANDLE.account));
  const pass = await h.secret(ctx, HANDLE.auth);
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

export interface Call {
  method?: string;
  /** a full address, from `acct` or one of the other API bases */
  url: string;
  query?: Record<string, string>;
  /** a form body, one pair per field (a field can repeat) */
  form?: [string, string][];
}

/** An address under the Space's account on the 2010 REST API; the Account Sid is put in for you. */
export async function acct(ctx: TwilioCtx, path: string): Promise<string> {
  return `${API.rest}/Accounts/${await accountSid(ctx)}${path}`;
}

/** One call to Twilio with the Space credentials. Never throws for an HTTP status; a network failure is provider.network. */
export async function raw(ctx: TwilioCtx, c: Call): Promise<Answer> {
  const authorization = await authHeader(ctx);
  const qs = c.query && Object.keys(c.query).length ? `?${new URLSearchParams(c.query).toString()}` : "";
  const headers: Record<string, string> = { authorization, accept: "application/json" };
  let body: string | undefined;
  if (c.form) {
    const p = new URLSearchParams();
    for (const [k, v] of c.form) p.append(k, v);
    body = p.toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  let res: { status: number; text(): Promise<string> };
  try {
    res = await ctx.http(`${c.url}${qs}`, { method: c.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) });
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
    throw fail("provider.network", ctx.trace.traceId, { message: "Twilio could not be reached." });
  }
  return parse(ctx, res.status, await res.text());
}

export function parse(ctx: Pick<TwilioCtx, "trace">, status: number, body: string): Answer {
  let json: Json = {};
  try {
    const parsed = body ? (JSON.parse(body) as unknown) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Json;
  } catch {
    if (status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio answered something unreadable." });
  }
  return { status, json };
}

export interface Opts {
  /** a refusal of the request itself is provider.bad_response (the send capabilities declare that code, not validation.bad_input) */
  send?: boolean;
  /** Twilio error codes that mean the number is taken or not for sale */
  taken?: boolean;
}

/** The call, with Twilio's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: TwilioCtx, c: Call, o: Opts = {}): Promise<Json> {
  const a = await raw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a, o);
}

/** Map a Twilio error. Twilio's own message is not passed on: it can echo what the person typed. */
export function refusal(ctx: Pick<TwilioCtx, "trace">, a: Answer, o: Opts = {}) {
  const t = ctx.trace.traceId;
  const status = a.status;
  const twilioCode = typeof a.json.code === "number" ? a.json.code : undefined;
  const details: Record<string, unknown> = twilioCode === undefined ? { status } : { status, twilioCode };
  if (status === 429) return fail("provider.rate_limited", t, { message: "Twilio asked us to slow down.", details });
  if (status === 401 || status === 403) return fail("provider.auth_failed", t, { message: "Twilio did not accept the credentials, or they may not do this. Check Twilio_Account and Twilio_Auth in the Vault.", details });
  if (status === 404) return fail("validation.not_found", t, { message: "Twilio has no such item.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Twilio is not answering right now.", details });
  if (o.taken && (status === 409 || twilioCode === 21422 || twilioCode === 21452)) return fail("validation.duplicate", t, { message: "That number is not available to buy.", details });
  if (status === 400 || status === 402 || status === 409 || status === 422) {
    return o.send ? fail("provider.bad_response", t, { message: "Twilio could not use that request. Check the numbers and the account balance.", details }) : fail("validation.bad_input", t, { message: "Twilio could not use that request.", details });
  }
  return fail("provider.bad_response", t, { message: "Twilio answered something unexpected.", details });
}

/** Every item of a Twilio list, following next_page_uri (at most `pages` pages). */
export async function listAll(ctx: TwilioCtx, firstUrl: string, key: string, query: Record<string, string> = {}, pages = 5): Promise<unknown[]> {
  const out: unknown[] = [];
  let url = firstUrl;
  let q: Record<string, string> | undefined = query;
  for (let n = 0; n < pages; n++) {
    const j = await api(ctx, q ? { url, query: q } : { url });
    out.push(...list(j[key]));
    const next = strOrUndef(j.next_page_uri);
    if (!next) break;
    url = `https://api.twilio.com${next}`;
    q = undefined;
  }
  return out;
}
