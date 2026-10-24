// mailgun store helpers and the one door to the Mailgun API (spec 2.18; ARCH 8, 8.2). The context subset the handlers use, the host seam (the API key
// from the Vault, multipart uploads, Space file bytes, downloads into blobs, the Space address), the schema apply, the HTTP call with its error mapping,
// and the readers the handlers share. The module never keeps the API key: the host hands it over for one call through `secret` and the module encodes
// it into one header.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";

export interface MailgunDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the mailgun handlers use; the host Ctx satisfies it. */
export interface MailgunCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  trace: { traceId: string };
  now(): number;
  db: MailgunDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface MailgunHost {
  /** The value stored in the Vault under a handle (the Mailgun API key or the webhook signing secret), for one call. Throws provider.auth_failed when there is none. */
  secret(ctx: MailgunCtx, handle: string): Promise<string>;
  /** A Space file's name, type and bytes (for attachments). */
  fileBytes(ctx: MailgunCtx, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  /** GET an address, with the Space's Mailgun key when the address is on Mailgun, and store the bytes as a blob. */
  download(ctx: MailgunCtx, a: { url: string; mime?: string; auth?: boolean }): Promise<{ blobId: string; size: number; mime: string }>;
  /** POST a multipart form with the Space's Mailgun key (an email with attachments: ctx.http carries text only). Answers the status and the body as Mailgun gave them. */
  upload(ctx: MailgunCtx, a: { url: string; fields: [string, string][]; files: { field: string; name: string; fileId: string }[] }): Promise<{ status: number; text: string }>;
  /** The public address of this Space, where Mailgun posts inbound mail (/hooks/mail/mailgun). */
  publicUrl(ctx: MailgunCtx): Promise<string>;
}

let host: MailgunHost | null = null;
/** The host registers its half once at boot. */
export function setMailgunHost(h: MailgunHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<MailgunCtx, "trace">): MailgunHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Mailgun is not set up on this server." });
  return host;
}

export const API = { us: "https://api.mailgun.net", eu: "https://api.eu.mailgun.net" } as const;
export type Region = keyof typeof API;
export const KEY_HANDLE = "#Mailgun_Key";

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

export function bad(ctx: Pick<MailgunCtx, "trace">, message: string): never {
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
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_mailgun.sql", import.meta.url)), "utf8");

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
export function ensure(ctx: Pick<MailgunCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "messageId" FROM mailgun_inbound_log WHERE "messageId" = ?`, "probe");
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

/** The Space's Mailgun region: the setting, us when it is not set. */
export async function regionOf(ctx: MailgunCtx): Promise<Region> {
  try {
    const v = obj(obj(await ctx.call("settings.get", { key: "mailgun.region" })).row).value;
    return v === "eu" ? "eu" : "us";
  } catch {
    return "us";
  }
}

export interface Call {
  method?: string;
  path: string;
  query?: Record<string, string>;
  /** a form body, one pair per field (a field can repeat) */
  form?: [string, string][];
  region?: Region;
}

/** The Basic header Mailgun wants: the user api and the key. */
export async function authHeader(ctx: MailgunCtx): Promise<string> {
  const key = await needHost(ctx).secret(ctx, KEY_HANDLE);
  return `Basic ${Buffer.from(`api:${key}`).toString("base64")}`;
}

/** One call to the Mailgun API with the Space key. Never throws for an HTTP status; a network failure is provider.network. */
export async function raw(ctx: MailgunCtx, c: Call): Promise<Answer> {
  const authorization = await authHeader(ctx);
  const base = API[c.region ?? (await regionOf(ctx))];
  const qs = c.query && Object.keys(c.query).length ? `?${new URLSearchParams(c.query).toString()}` : "";
  const headers: Record<string, string> = { authorization, accept: "application/json" };
  let body: string | undefined;
  if (c.form) {
    const p = new URLSearchParams();
    for (const [k, v] of c.form) p.append(k, v);
    body = p.toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  return answer(ctx, () => ctx.http(`${base}${c.path}${qs}`, { method: c.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) }));
}

/** Read the answer of one request into a status and a JSON object. */
export async function answer(ctx: Pick<MailgunCtx, "trace">, send: () => Promise<{ status: number; text(): Promise<string> }>): Promise<Answer> {
  let res: { status: number; text(): Promise<string> };
  try {
    res = await send();
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
    throw fail("provider.network", ctx.trace.traceId, { message: "Mailgun could not be reached." });
  }
  return parse(ctx, res.status, await res.text());
}

export function parse(ctx: Pick<MailgunCtx, "trace">, status: number, body: string): Answer {
  let json: Json = {};
  try {
    const parsed = body ? (JSON.parse(body) as unknown) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Json;
  } catch {
    if (status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Mailgun answered something unreadable." });
  }
  return { status, json };
}

/** The call, with Mailgun's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: MailgunCtx, c: Call, o: { send?: boolean } = {}): Promise<Json> {
  const a = await raw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a.status, o.send === true);
}

/** Map a Mailgun error status. Mailgun's own message is not passed on: it can echo what the person typed. `send` keeps the three codes mail.send declares. */
export function refusal(ctx: Pick<MailgunCtx, "trace">, status: number, send: boolean) {
  const t = ctx.trace.traceId;
  const details = { status };
  if (status === 429) return fail("provider.rate_limited", t, { message: "Mailgun asked us to slow down.", details });
  if (status === 401 || status === 403) return fail("provider.auth_failed", t, { message: "Mailgun did not accept the API key, or the key may not do this. Check Mailgun_Key in the Vault and the region.", details });
  if (status === 404) return fail("validation.not_found", t, { message: "Mailgun has no such item.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Mailgun is not answering right now.", details });
  if (status === 400 || status === 402 || status === 409 || status === 422) {
    return send ? fail("provider.bad_response", t, { message: "Mailgun could not use that email. Check the sender domain is verified.", details }) : fail("validation.bad_input", t, { message: "Mailgun could not use that request.", details });
  }
  return fail("provider.bad_response", t, { message: "Mailgun answered something unexpected.", details });
}
