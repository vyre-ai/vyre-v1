// zoom store helpers and the one door to the Zoom API (spec 2.18; ARCH 8, 8.3). The context subset the handlers use, the host seam (the Vault items, downloads into blobs), the schema apply, the
// Server-to-Server OAuth token (cached until a minute before it expires), the HTTP call with its error mapping and the readers the handlers share. The module never keeps a secret:
// the host hands one over for one call through `secret`, and the module encodes it into one header or one HMAC.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";

export interface ZoomDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the zoom handlers use; the host Ctx satisfies it. */
export interface ZoomCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  now(): number;
  db: ZoomDb;
  emit(name: string, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface ZoomHost {
  /** The value stored in the Vault under a handle (#Zoom_S2S.account_id, #Zoom_S2S.client_id, #Zoom_S2S.client_secret, #Zoom_Webhook_Secret), for one call. Throws provider.auth_failed when there is none. */
  secret(ctx: ZoomCtx, handle: string): Promise<string>;
  /** GET an address with a bearer token and store the bytes as a blob (a recording file). */
  download(ctx: ZoomCtx, a: { url: string; bearer: string; mime?: string }): Promise<{ blobId: string; size: number; mime: string }>;
}

let host: ZoomHost | null = null;
/** The host registers its half once at boot (ruling 31). */
export function setZoomHost(h: ZoomHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<ZoomCtx, "trace">): ZoomHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Zoom is not set up on this server." });
  return host;
}

export const HANDLE = { account: "#Zoom_S2S.account_id", client: "#Zoom_S2S.client_id", secret: "#Zoom_S2S.client_secret", webhook: "#Zoom_Webhook_Secret" } as const;
export const API = "https://api.zoom.us/v2";
export const TOKEN_URL = "https://zoom.us/oauth/token";

// ---- readers

export const first = (rows: unknown[]): Row | null => {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
};
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const intOrUndef = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

export function bad(ctx: Pick<ZoomCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

/** A Zoom meeting id is digits (9 to 11 of them in practice); anything else is not one. */
export function meetingIdOf(ctx: Pick<ZoomCtx, "trace">, v: unknown): string {
  return typeof v === "string" && /^[0-9]{6,15}$/.test(v) ? v : bad(ctx, "A Zoom meeting id is its number.");
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_zoom.sql", import.meta.url)), "utf8");

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

export function ensure(ctx: Pick<ZoomCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "key" FROM zoom_state WHERE "key" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function getState(ctx: Pick<ZoomCtx, "db">, key: string): string | null {
  const row = first(ctx.db.all(`SELECT * FROM zoom_state WHERE "key" = ?`, key));
  return row && typeof row.value === "string" ? row.value : null;
}
export function setState(ctx: Pick<ZoomCtx, "db">, key: string, value: string): void {
  if (getState(ctx, key) === null) ctx.db.run(`INSERT OR IGNORE INTO zoom_state ("key", "value") VALUES (?, ?)`, key, value);
  else ctx.db.run(`UPDATE zoom_state SET "value" = ? WHERE "key" = ?`, value, key);
}

// ---- the token and the API

/** The Server-to-Server OAuth access token: cached until a minute before it expires. */
export async function accessToken(ctx: ZoomCtx, fresh = false): Promise<string> {
  ensure(ctx);
  const cached = getState(ctx, "token");
  if (cached && !fresh) {
    const t = obj(JSON.parse(cached));
    if (typeof t["token"] === "string" && typeof t["exp"] === "number" && t["exp"] - 60_000 > ctx.now()) return t["token"];
  }
  const h = needHost(ctx);
  const account = await h.secret(ctx, HANDLE.account);
  const basic = Buffer.from(`${await h.secret(ctx, HANDLE.client)}:${await h.secret(ctx, HANDLE.secret)}`).toString("base64");
  let res: { status: number; text(): Promise<string> };
  try {
    res = await ctx.http(`${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(account)}`, { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" }, body: "" });
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;
    throw fail("provider.network", ctx.trace.traceId, { message: "Zoom could not be reached." });
  }
  const body = parseBody(await res.text());
  if (res.status >= 500) throw fail("provider.unavailable", ctx.trace.traceId, { message: "Zoom is not answering right now." });
  if (res.status === 429) throw fail("provider.rate_limited", ctx.trace.traceId, { message: "Zoom asked us to slow down." });
  const token = strOrUndef(body["access_token"]);
  if (res.status >= 300 || !token) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "Zoom did not accept the account. Check the Zoom_S2S item in the Vault and that the Zoom app is activated." });
  const life = intOrUndef(body["expires_in"]) ?? 3600;
  setState(ctx, "token", JSON.stringify({ token, exp: ctx.now() + life * 1000 }));
  return token;
}

export function parseBody(body: string): Json {
  try {
    const parsed = body ? (JSON.parse(body) as unknown) : {};
    return obj(parsed);
  } catch {
    return {};
  }
}

export interface Call { method?: string; path: string; query?: Record<string, string>; body?: Json }

/** One call to the Zoom REST API, with Zoom's refusals mapped to the error catalogue. A 401 gets one retry with a fresh token. Returns the parsed body of a 2xx (204 is {}). */
export async function api(ctx: ZoomCtx, c: Call): Promise<Json> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(ctx, attempt > 0);
    const qs = c.query && Object.keys(c.query).length ? `?${new URLSearchParams(c.query).toString()}` : "";
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (c.body) headers["content-type"] = "application/json";
    let res: { status: number; text(): Promise<string> };
    try {
      res = await ctx.http(`${API}${c.path}${qs}`, { method: c.method ?? "GET", headers, ...(c.body ? { body: JSON.stringify(c.body) } : {}) });
    } catch (e) {
      if (typeof e === "object" && e !== null && "error" in e) throw e;
      throw fail("provider.network", ctx.trace.traceId, { message: "Zoom could not be reached." });
    }
    const raw = await res.text();
    if (res.status === 401 && attempt === 0) continue;
    if (res.status < 300) return parseBody(raw);
    throw refusal(ctx, res.status, parseBody(raw));
  }
}

/** Map a Zoom error. Zoom's own message is not passed on: it can echo what the person typed. */
export function refusal(ctx: Pick<ZoomCtx, "trace">, status: number, body: Json) {
  const t = ctx.trace.traceId;
  const code = typeof body["code"] === "number" ? body["code"] : undefined;
  const details: Record<string, unknown> = code === undefined ? { status } : { status, zoomCode: code };
  if (status === 429) return fail("provider.rate_limited", t, { message: "Zoom asked us to slow down.", details });
  if (status === 401 || status === 403) return fail("provider.auth_failed", t, { message: "Zoom did not accept the credentials, or the app may not do this. Check the Zoom_S2S item in the Vault and the app scopes.", details });
  if (status === 404 || code === 3001 || code === 3301) return fail("validation.not_found", t, { message: "Zoom has no such item.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Zoom is not answering right now.", details });
  if (status === 400 || status === 409 || status === 422) return fail("validation.bad_input", t, { message: "Zoom could not use that request.", details });
  return fail("provider.bad_response", t, { message: "Zoom answered something unexpected.", details });
}
