// resend store helpers and the one door to the Resend API (spec 2.18; ARCH 8, 8.2). The context subset the handlers use, the host seam (the API key
// from the Vault, Space file bytes, downloads into blobs), the schema apply, the HTTP call with its error mapping, and the readers the handlers share.
// The module never holds the API key: the host hands it over for one call through `secret` and the module puts it in one header.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";

export interface ResendDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the resend handlers use; the host Ctx satisfies it. */
export interface ResendCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  now(): number;
  db: ResendDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface ResendHost {
  /** The value stored in the Vault under a handle (the Resend API key or the webhook signing secret), for one call. Throws provider.auth_failed when there is none. */
  secret(ctx: ResendCtx, handle: string): Promise<string>;
  /** A Space file's name, type and bytes (for attachments). */
  fileBytes(ctx: ResendCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  /** GET an address and store the bytes as a blob. */
  download(ctx: ResendCtx, a: { url: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
}

let host: ResendHost | null = null;
/** The host registers its half once at boot. */
export function setResendHost(h: ResendHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<ResendCtx, "trace">): ResendHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Resend is not set up on this server." });
  return host;
}

export const API = "https://api.resend.com";
export const KEY_HANDLE = "#Resend_Key";

// ---- readers

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

export function bad(ctx: Pick<ResendCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

/** "Name <a@b.c>" or "a@b.c" to its address and name. */
export function parseAddress(raw: string): { address: string; name?: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/.exec(raw);
  const address = (m ? (m[2] ?? "") : raw).trim().toLowerCase();
  const name = m ? (m[1] ?? "").trim() : "";
  return name ? { address, name } : { address };
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_resend.sql", import.meta.url)), "utf8");

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
export function ensure(ctx: Pick<ResendCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "emailId" FROM resend_inbound_log WHERE "emailId" = ?`, "probe");
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

/** One call to the Resend API with the Space key. Never throws for an HTTP status; a network failure is provider.network. */
export async function raw(ctx: ResendCtx, c: { method?: string; path: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> }): Promise<Answer> {
  const key = await needHost(ctx).secret(ctx, KEY_HANDLE);
  const qs = c.query ? `?${new URLSearchParams(c.query).toString()}` : "";
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: "application/json", ...c.headers };
  if (c.body !== undefined) headers["content-type"] = "application/json";
  let res: { status: number; text(): Promise<string> };
  try {
    res = await ctx.http(`${API}${c.path}${qs}`, { method: c.method ?? "GET", headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) });
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
    throw fail("provider.network", ctx.trace.traceId, { message: "Resend could not be reached." });
  }
  const body = await res.text();
  let json: Json = {};
  try {
    const parsed = body ? (JSON.parse(body) as unknown) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Json;
  } catch {
    if (res.status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Resend answered something unreadable." });
  }
  return { status: res.status, json };
}

/** The call, with Resend's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: ResendCtx, c: Parameters<typeof raw>[1], o: { send?: boolean } = {}): Promise<Json> {
  const a = await raw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a.status, a.json, o.send === true);
}

/** Map a Resend error status. Resend's own message is not passed on: it can echo what the person typed. `send` keeps the three codes mail.send declares. */
export function refusal(ctx: Pick<ResendCtx, "trace">, status: number, json: Json, send: boolean) {
  const t = ctx.trace.traceId;
  const details = { status, ...(typeof json.name === "string" ? { reason: json.name } : {}) };
  if (status === 429) return fail("provider.rate_limited", t, { message: "Resend asked us to slow down.", details });
  if (status === 401 || status === 403) return fail("provider.auth_failed", t, { message: "Resend did not accept the API key, or the key may not do this. Check Resend_Key in the Vault.", details });
  if (status === 404) return fail("validation.not_found", t, { message: "Resend has no such item.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Resend is not answering right now.", details });
  if (status === 400 || status === 422 || status === 409) {
    return send ? fail("provider.bad_response", t, { message: "Resend could not use that email. Check the sender domain is verified.", details }) : fail("validation.bad_input", t, { message: "Resend could not use that request.", details });
  }
  return fail("provider.bad_response", t, { message: "Resend answered something unexpected.", details });
}
