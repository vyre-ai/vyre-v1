// stripe store helpers and the one door to the Stripe API (spec 2.10 Source: Stripe, 2.20 payments for sites; ARCH 8). The context subset the handlers use, the host seam
// (the restricted key and the webhook signing secret from the Vault), the schema apply, the HTTP call with its error mapping, form encoding, and the readers the handlers share.
// The module never holds a key: the host hands it over for one call through `secret` and the module puts it in one header.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";

export interface StripeDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the stripe handlers use; the host Ctx satisfies it. */
export interface StripeCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  now(): number;
  db: StripeDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface StripeHost {
  /** The value stored in the Vault under a handle (the restricted key or the webhook signing secret), for one call. Throws provider.auth_failed when there is none. */
  secret(ctx: StripeCtx, handle: string): Promise<string>;
}

let host: StripeHost | null = null;
/** The host registers its half once at boot. */
export function setStripeHost(h: StripeHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<StripeCtx, "trace">): StripeHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Stripe is not set up on this server." });
  return host;
}

export const API = "https://api.stripe.com";
/** Pinned so a Stripe release never changes what an answer looks like under us. */
export const API_VERSION = "2024-06-20";
export const HANDLE = { key: "#Stripe_Key", webhook: "#Stripe_Webhook_Secret" } as const;

// ---- readers

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const intOrUndef = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) ? v : undefined);
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

export function bad(ctx: Pick<StripeCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

/** A Stripe object id as it goes into a path: letters, digits and underscores only, so a caller cannot reach another path. */
export function stripeId(ctx: Pick<StripeCtx, "trace">, value: unknown, what: string): string {
  if (typeof value !== "string" || !/^[a-z]{2,8}(?:_[a-z]{2,8})?_[A-Za-z0-9]{1,64}$/.test(value)) bad(ctx, `${what} is not a Stripe id.`);
  return value;
}

/** Stripe counts in seconds; Vyre in milliseconds. */
export const ms = (seconds: unknown): number | undefined => (typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined);
export const secs = (millis: number): number => Math.floor(millis / 1000);
export const upper = (v: unknown): string => (typeof v === "string" ? v.toUpperCase() : "");

// ---- form encoding (Stripe takes application/x-www-form-urlencoded with bracket keys)

/** `{ a: [{ b: 1 }], c: { d: "x" } }` becomes `a[0][b]=1&c[d]=x`. Undefined and null are left out. */
export function formEncode(value: Json): string {
  const pairs: string[] = [];
  const walk = (key: string, v: unknown): void => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Json)) walk(`${key}[${k}]`, x);
    else pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${k}[${i}]`, x));
    else if (v !== null && typeof v === "object") for (const [sub, x] of Object.entries(v as Json)) walk(`${k}[${sub}]`, x);
    else walk(k, v);
  }
  return pairs.join("&");
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_stripe.sql", import.meta.url)), "utf8");

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

/** Make sure this module's table exists: one cheap SELECT per call, the CREATE ... IF NOT EXISTS statements only when it fails. */
export function ensure(ctx: Pick<StripeCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "eventId" FROM stripe_event_log WHERE "eventId" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- the API

export interface Answer {
  status: number;
  json: Json;
}

export interface Request {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  /** Query string pairs for a GET or DELETE. */
  query?: Record<string, string | number | boolean | undefined>;
  /** A POST body, form encoded. */
  form?: Json;
  /** Sent as Idempotency-Key: Stripe answers a repeat of the same key with the first answer. */
  idempotencyKey?: string;
}

/** One call to the Stripe API with the Space's restricted key. Never throws for an HTTP status; a network failure is provider.network. */
export async function raw(ctx: StripeCtx, c: Request): Promise<Answer> {
  const key = await needHost(ctx).secret(ctx, HANDLE.key);
  const pairs = Object.entries(c.query ?? {}).filter((e): e is [string, string | number | boolean] => e[1] !== undefined);
  const qs = pairs.length ? `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}` : "";
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: "application/json", "stripe-version": API_VERSION };
  if (c.idempotencyKey) headers["idempotency-key"] = c.idempotencyKey;
  if (c.form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
  let res: { status: number; text(): Promise<string> };
  try {
    res = await ctx.http(`${API}${c.path}${qs}`, { method: c.method ?? "GET", headers, ...(c.form !== undefined ? { body: formEncode(c.form) } : {}) });
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
    throw fail("provider.network", ctx.trace.traceId, { message: "Stripe could not be reached." });
  }
  const body = await res.text();
  let json: Json = {};
  try {
    const parsed = body ? (JSON.parse(body) as unknown) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Json;
  } catch {
    if (res.status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Stripe answered something unreadable." });
  }
  return { status: res.status, json };
}

/** The call, with Stripe's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: StripeCtx, c: Request): Promise<Json> {
  const a = await raw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a.status, a.json);
}

/** Map a Stripe error status. Stripe's own message is not passed on: it can echo what the customer typed. */
export function refusal(ctx: Pick<StripeCtx, "trace">, status: number, json: Json) {
  const t = ctx.trace.traceId;
  const e = obj(json.error);
  const details = { status, ...(typeof e.code === "string" ? { code: e.code } : {}), ...(typeof e.type === "string" ? { reason: e.type } : {}) };
  if (status === 429) return fail("provider.rate_limited", t, { message: "Stripe asked us to slow down.", details });
  if (status === 401 || status === 403) {
    return fail("provider.auth_failed", t, { message: "Stripe did not accept the key, or the restricted key may not do this. Check Stripe_Key in the Vault and its permissions.", details });
  }
  if (status === 404) return fail("validation.not_found", t, { message: "Stripe has no such item.", details });
  if (status === 409 || status === 402) return fail("validation.precondition_failed", t, { message: "Stripe refused because of the state of the item or the idempotency key.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Stripe is not answering right now.", details });
  if (status === 400) {
    // A refund of what is already refunded, an invoice already paid: the item is in the wrong state, not the request malformed.
    const state = new Set(["charge_already_refunded", "charge_already_captured", "invoice_not_editable", "payment_intent_unexpected_state", "resource_already_exists", "subscription_not_active"]);
    return typeof e.code === "string" && state.has(e.code)
      ? fail("validation.precondition_failed", t, { message: "Stripe says the item is not in a state that allows this.", details })
      : fail("validation.bad_input", t, { message: "Stripe could not use that request.", details });
  }
  return fail("provider.bad_response", t, { message: "Stripe answered something unexpected.", details });
}

export const inline = {};
export const consumers = {};
export const codecs = {};
