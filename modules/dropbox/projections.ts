// dropbox store helpers and the one door to the Dropbox API (spec 2.18; ARCH 8; live folders L3). The context subset the handlers use, the host seam (the app key and secret from the Vault, the
// sign-in code exchange, access tokens made from a refresh token, and the two binary transfers ctx.http cannot carry), the schema apply, the account lookup, the JSON call with its error mapping and
// the readers the handlers share. The module never keeps a secret: the refresh token lives in a Vault item, the host reads it for one call and hands back an access token that is never stored.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";
import { isTrustedService } from "../../lib/trust.ts";

export interface DropboxDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the dropbox handlers use; the host Ctx satisfies it. */
export interface DropboxCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  authorize(action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold"; reason: string; decisionId: string };
  now(): number;
  db: DropboxDb;
  emit(name: string, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface DropboxHost {
  /** The app key (public) of the Dropbox app stored under a Vault handle, and whether it also holds a secret. Throws provider.auth_failed when the item is not a Dropbox app. */
  app(ctx: DropboxCtx, handle: string): Promise<{ appKey: string; hasSecret: boolean }>;
  /** The app secret, for one webhook check. Throws provider.auth_failed when there is none. */
  appSecret(ctx: DropboxCtx, handle: string): Promise<string>;
  /** The address people reach this Space at (https://host), for the redirect the sign-in comes back to. */
  publicUrl(ctx: DropboxCtx): Promise<string>;
  /** Trade the sign-in code for tokens (PKCE: the verifier proves it is the same server). */
  exchange(ctx: DropboxCtx, a: { appHandle: string; code: string; verifier: string; redirectUri: string }): Promise<{ refreshToken: string; accessToken: string; expiresAt: number; accountId?: string }>;
  /** An access token made from the refresh token under a Vault handle (a Shared item, so a pass with nobody signed in can read it). Cached by the host until a minute before it ends. */
  token(ctx: DropboxCtx, a: { appHandle: string; refreshHandle: string; asker?: string; fresh?: boolean }): Promise<{ token: string; expiresAt: number }>;
  /** POST a file's bytes: the Space file goes to content.dropboxapi.com/2/files/upload with the arguments in Dropbox-API-Arg. Answers the status and the JSON. */
  upload(ctx: DropboxCtx, a: { token: string; arg: Json; fileId: string }): Promise<{ status: number; json: Json }>;
  /** Download a file's bytes (content.dropboxapi.com/2/files/download) into a blob. A non-2xx answer comes back as status and json, with no blob. */
  download(ctx: DropboxCtx, a: { token: string; arg: Json; mime?: string }): Promise<{ status: number; json: Json; blob?: { blobId: string; size: number; mime: string } }>;
}

let host: DropboxHost | null = null;
/** The host registers its half once at boot (ruling 31). */
export function setDropboxHost(h: DropboxHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<DropboxCtx, "trace">): DropboxHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "Dropbox is not set up on this server." });
  return host;
}

export const CONFIG_ID = "dropbox";
export const APP_HANDLE = /^#[A-Za-z0-9_]+$/;
export const API = "https://api.dropboxapi.com/2";
export const NOTIFY = "https://notify.dropboxapi.com/2";
export const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
export const SCOPES = ["account_info.read", "files.metadata.read", "files.metadata.write", "files.content.read", "files.content.write"] as const;
/** The Vault folder both kinds of connection keep their refresh token in. */
export const FOLDER_NAME = "Connections";

// ---- readers

export const first = (rows: unknown[]): Row | null => {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
};
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const intOrUndef = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
export const str = (row: Row | null, key: string): string => {
  const v = row?.[key];
  return typeof v === "string" ? v : "";
};
export const strOrNull = (row: Row | null, key: string): string | null => {
  const v = row?.[key];
  return typeof v === "string" && v !== "" ? v : null;
};
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");

export function bad(ctx: Pick<DropboxCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}

/** The person a call is for. */
export const actorOf = (ctx: Pick<DropboxCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_dropbox.sql", import.meta.url)), "utf8");

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

export function ensure(ctx: Pick<DropboxCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "id" FROM dropbox_config WHERE "id" = ?`, CONFIG_ID);
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

export function config(ctx: DropboxCtx): Row | null {
  ensure(ctx);
  return first(ctx.db.all(`SELECT * FROM dropbox_config WHERE "id" = ?`, CONFIG_ID));
}

/** The configured app, or a refusal that says how to set it up. */
export function needConfig(ctx: DropboxCtx): { vaultItem: string; appKey: string } {
  const cfg = config(ctx);
  if (!cfg) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Dropbox is not set up on this server. An admin adds the Dropbox app first." });
  return { vaultItem: str(cfg, "vaultItem"), appKey: str(cfg, "appKey") };
}

// ---- accounts

export interface Account { connectionId: string; ownerKind: "person" | "space"; ownerId: string; accountId: string; email: string | null; name: string | null; refreshHandle: string; refreshItem: string }

const accountOfRow = (r: Row): Account => ({
  connectionId: str(r, "connectionId"), ownerKind: str(r, "ownerKind") === "space" ? "space" : "person", ownerId: str(r, "ownerId"), accountId: str(r, "accountId"),
  email: strOrNull(r, "email"), name: strOrNull(r, "name"), refreshHandle: str(r, "refreshHandle"), refreshItem: str(r, "refreshItem"),
});

/** Whether the caller may use the connection: a person's own is theirs alone (and the host's own services act for them), a Space's is open to every member. */
function usable(ctx: DropboxCtx, a: Account): boolean {
  if (a.ownerKind === "space") return true;
  return a.ownerId === actorOf(ctx) || isTrustedService(ctx.principal);
}

export function accountsFor(ctx: DropboxCtx): Account[] {
  ensure(ctx);
  return rowsOf(ctx.db.all(`SELECT * FROM dropbox_account ORDER BY "created_at"`)).map(accountOfRow).filter((a) => usable(ctx, a));
}

export function accountOf(ctx: DropboxCtx, connectionId: string): Account {
  ensure(ctx);
  const r = first(ctx.db.all(`SELECT * FROM dropbox_account WHERE "connectionId" = ?`, connectionId));
  const a = r ? accountOfRow(r) : null;
  if (!a || !usable(ctx, a)) throw fail("validation.not_found", ctx.trace.traceId, { message: "There is no such Dropbox connection." });
  return a;
}

// ---- the API

/** An access token for the connection. */
export async function tokenFor(ctx: DropboxCtx, a: Account, fresh = false): Promise<string> {
  const { vaultItem } = needConfig(ctx);
  const t = await needHost(ctx).token(ctx, { appHandle: vaultItem, refreshHandle: a.refreshHandle, ...(fresh ? { fresh: true } : {}) });
  return t.token;
}

export function parseBody(body: string): Json {
  try {
    return obj(body ? (JSON.parse(body) as unknown) : {});
  } catch {
    return {};
  }
}

export interface Call { host?: "api" | "notify"; path: string; body?: unknown }

/** One POST to the Dropbox API with the given access token (none for the notify endpoint). Answers the status and the raw body. */
export async function sendJson(ctx: DropboxCtx, token: string | undefined, c: Call): Promise<{ status: number; raw: string }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token !== undefined) headers["authorization"] = `Bearer ${token}`;
  // Dropbox takes a body-less call with no content type, and a JSON call with it
  if (c.body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await ctx.http(`${c.host === "notify" ? NOTIFY : API}${c.path}`, { method: "POST", headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) });
    return { status: res.status, raw: await res.text() };
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;
    throw fail("provider.network", ctx.trace.traceId, { message: "Dropbox could not be reached." });
  }
}

/** One JSON call as the connection's account. A 401 gets one retry with a fresh token. Returns the parsed body of a 2xx. */
export async function api(ctx: DropboxCtx, a: Account, c: Call): Promise<Json> {
  for (let attempt = 0; ; attempt++) {
    const res = await sendJson(ctx, c.host === "notify" ? undefined : await tokenFor(ctx, a, attempt > 0), c);
    if (res.status === 401 && attempt === 0 && c.host !== "notify") continue;
    if (res.status < 300) return parseBody(res.raw);
    throw refusal(ctx, res.status, res.raw);
  }
}

/** Map a Dropbox error. Dropbox says why in error_summary ("path/not_found/.."); its words are not passed on, they can echo a file name. */
export function refusal(ctx: Pick<DropboxCtx, "trace">, status: number, raw: string) {
  const t = ctx.trace.traceId;
  const body = parseBody(raw);
  const summary = typeof body["error_summary"] === "string" ? (body["error_summary"] as string) : "";
  // only Dropbox's error tags (path/not_found) go in the details; the rest of the summary can be a file name
  const tags: string[] = [];
  for (const seg of summary.split("/")) { if (!/^[a-z][a-z_]*$/.test(seg)) break; tags.push(seg); }
  const details: Record<string, unknown> = { status, ...(tags.length ? { why: tags.join("/") } : {}) };
  if (status === 429) return fail("provider.rate_limited", t, { message: "Dropbox asked us to slow down.", details });
  if (status === 401 || status === 403) return fail("provider.auth_failed", t, { message: "Dropbox did not accept the connection. Connect Dropbox again.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "Dropbox is not answering right now.", details });
  if (/(^|\/)(not_found|not_file|not_folder)(\/|$)/.test(summary)) return fail("validation.not_found", t, { message: "Dropbox has no such file or folder.", details });
  if (/(^|\/)conflict(\/|$)/.test(summary) || /too_many_write_operations/.test(summary)) return fail("validation.version_conflict", t, { message: "The file changed in Dropbox since it was read.", details });
  if (/(^|\/)reset(\/|$)/.test(summary)) return fail("validation.precondition_failed", t, { message: "Dropbox no longer knows that place in the change feed. Read the folder again.", details: { ...details, reason: "cursor_reset" } });
  if (/insufficient_space/.test(summary)) return fail("validation.too_large", t, { message: "The Dropbox account is out of space.", details });
  if (status === 400 || status === 409) return fail("validation.bad_input", t, { message: "Dropbox could not use that request.", details });
  return fail("provider.bad_response", t, { message: "Dropbox answered something unexpected.", details });
}
