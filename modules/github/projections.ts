// github store helpers and the one door to the GitHub API (spec 2.10, 2.16; ARCH 8, 8.5). The context subset the handlers use, the host seam (the App's signed
// JWT, the Vault, the filler that holds an installation token for git, the Space's public address), the schema apply, the HTTP call with its error mapping, the
// installation token cache and the readers the handlers share.
// The module never holds the App's private key and never returns a token: the host signs the App JWT, and an installation token leaves this module only as a filler handle.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../host/src/routes/errors.ts";

export interface GithubDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** The part of the host Ctx (packages/contracts/src/ctx.ts) the github handlers use; the host Ctx satisfies it. */
export interface GithubCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: GithubDb;
  emit(name: string, subject: string, payload: unknown, opts?: { vis?: "space" | "participants" | "owner" | "private" }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void };
}

export type Row = Record<string, string | number | null>;
export type Json = Record<string, unknown>;

// ---- host seam

export interface GithubHost {
  /** The value stored in the Vault under a handle (the webhook secret), for one call. Throws provider.auth_failed when there is none. */
  secret(ctx: GithubCtx, handle: string): Promise<string>;
  /** A JWT for the GitHub App (RS256, issued by the App id, valid for nine minutes at most), signed with the key in the Vault. Throws provider.auth_failed when the App is not set up. */
  appJwt(ctx: GithubCtx): Promise<string>;
  /** Put what the manifest flow returned into the Vault as GitHub_App_Id, GitHub_App_Key, GitHub_App_Webhook_Secret and the OAuth client id and secret. */
  storeSecrets(ctx: GithubCtx, items: { name: string; value: string }[]): Promise<void>;
  /** Hold an installation token behind a filler and return its handle; git injects the token at the last moment. */
  fillerHandle(ctx: GithubCtx, a: { token: string; expiresAt: number; repo?: string }): Promise<string>;
  /** The Space's public address (https://...), where GitHub can reach /hooks/github and send the manifest redirect. */
  publicUrl(ctx: GithubCtx): Promise<string>;
}

let host: GithubHost | null = null;
/** The host registers its half once at boot. */
export function setGithubHost(h: GithubHost | null): void {
  host = h;
}
export function needHost(ctx: Pick<GithubCtx, "trace">): GithubHost {
  if (!host) throw fail("internal.unavailable", ctx.trace.traceId, { message: "GitHub is not set up on this server." });
  return host;
}

export const API = "https://api.github.com";
export const WEB = "https://github.com";
export const API_VERSION = "2022-11-28";
export const APP_ROW = "app";
export const HANDLE = { webhook: "#GitHub_App_Webhook_Secret" } as const;
/** What the App asks GitHub for. contents write is for pushes through the filler; the rest is what the pull request and issue pages need. */
export const APP_PERMISSIONS: Record<string, string> = { contents: "write", pull_requests: "write", issues: "write", checks: "read", metadata: "read" };
export const APP_EVENTS = ["push", "pull_request", "issues", "check_run", "workflow_run"];
export const MAX_FIX_ROUNDS = 3;

// ---- readers

export function first(rows: unknown[]): Row | null {
  const row = rows[0];
  return row && typeof row === "object" ? (row as Row) : null;
}
export const rowsOf = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof r === "object");
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : "");
export const strOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const intOrUndef = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) ? v : undefined);
export const num = (row: Row | null, key: string): number => {
  const v = row?.[key];
  return typeof v === "number" ? v : 0;
};
export const str = (row: Row | null, key: string): string => {
  const v = row?.[key];
  return typeof v === "string" ? v : "";
};
export const codeOf = (err: unknown): string => ((err as { error?: { code?: string } } | null)?.error?.code ?? "");
/** An ISO time to milliseconds. */
export const msOf = (v: unknown): number | undefined => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

export function bad(ctx: Pick<GithubCtx, "trace">, message: string): never {
  throw fail("validation.bad_input", ctx.trace.traceId, { message });
}
export function refuse(ctx: Pick<GithubCtx, "trace">, message: string): never {
  throw fail("validation.precondition_failed", ctx.trace.traceId, { message });
}

/** `owner/name` as the path `/repos/owner/name`: each part encoded, and "." and ".." refused so a name cannot climb out of /repos. */
export function repoPath(ctx: Pick<GithubCtx, "trace">, repo: unknown): string {
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) bad(ctx, "A repository is written owner/name.");
  const [owner = "", name = ""] = repo.split("/");
  if (owner === "." || owner === ".." || name === "." || name === "..") bad(ctx, "A repository is written owner/name.");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function numberOf(ctx: Pick<GithubCtx, "trace">, v: unknown, what = "The number"): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) bad(ctx, `${what} is a whole number, 1 or more.`);
  return v;
}

// ---- schema

const ready = new WeakSet<object>();
const migrationSql = readFileSync(fileURLToPath(new URL("./migrations/0001_github.sql", import.meta.url)), "utf8");

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
export function ensure(ctx: Pick<GithubCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "deliveryId" FROM github_delivery WHERE "deliveryId" = ?`, "probe");
  } catch {
    for (const statement of statements(migrationSql)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- the API

export interface Answer {
  status: number;
  json: Json;
  text: string;
}

export type Auth = { as: "none" } | { as: "app" } | { as: "installation"; installationId: number };

export interface Request {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  auth: Auth;
  /** Ask for another representation (the unified diff). The answer is then `text`, not JSON. */
  accept?: string;
}

interface Cached {
  token: string;
  expiresAt: number;
}
const tokens = new WeakMap<object, Map<number, Cached>>();
const repoInstall = new WeakMap<object, Map<string, number>>();
const REFRESH_BEFORE = 5 * 60_000;

function tokenCache(db: object): Map<number, Cached> {
  let m = tokens.get(db);
  if (!m) {
    m = new Map();
    tokens.set(db, m);
  }
  return m;
}
function installCache(db: object): Map<string, number> {
  let m = repoInstall.get(db);
  if (!m) {
    m = new Map();
    repoInstall.set(db, m);
  }
  return m;
}

async function send(ctx: GithubCtx, c: Request, bearer: string | null): Promise<Answer> {
  const pairs = Object.entries(c.query ?? {}).filter((e): e is [string, string | number | boolean] => e[1] !== undefined);
  const qs = pairs.length ? `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}` : "";
  const headers: Record<string, string> = { accept: c.accept ?? "application/vnd.github+json", "x-github-api-version": API_VERSION, "user-agent": "vyre" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (c.body !== undefined) headers["content-type"] = "application/json";
  let res: { status: number; text(): Promise<string> };
  try {
    res = await ctx.http(`${API}${c.path}${qs}`, { method: c.method ?? "GET", headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) });
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;   // a HostError such as the egress guard
    throw fail("provider.network", ctx.trace.traceId, { message: "GitHub could not be reached." });
  }
  const body = await res.text();
  let json: Json = {};
  if (!c.accept || c.accept.includes("json")) {
    try {
      const parsed = body ? (JSON.parse(body) as unknown) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Json;
      else if (Array.isArray(parsed)) json = { items: parsed };   // a list answers as a bare array
    } catch {
      if (res.status < 300) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered something unreadable." });
    }
  }
  return { status: res.status, json, text: body };
}

/** An installation token for the installation, from the cache while it has more than five minutes left, else minted. `fresh` skips the cache. */
export async function installationToken(ctx: GithubCtx, installationId: number, fresh = false): Promise<string> {
  const cache = tokenCache(ctx.db);
  const hit = cache.get(installationId);
  if (!fresh && hit && hit.expiresAt - ctx.now() > REFRESH_BEFORE) return hit.token;
  const minted = await mintToken(ctx, installationId);
  cache.set(installationId, minted);
  return minted.token;
}

/** A new installation token (always from GitHub). `repositories` narrows it to those repositories. */
export async function mintToken(ctx: GithubCtx, installationId: number, repositories?: string[]): Promise<Cached> {
  const a = await raw(ctx, {
    method: "POST", path: `/app/installations/${installationId}/access_tokens`, auth: { as: "app" }, ...(repositories ? { body: { repositories } } : {}),
  });
  if (a.status >= 300) throw refusal(ctx, a.status, a.json);
  const token = text(a.json.token);
  const expiresAt = msOf(a.json.expires_at);
  if (!token || expiresAt === undefined) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered an installation token request with no token." });
  return { token, expiresAt };
}

/** One call to the GitHub API as the App, as an installation, or with no credentials. Never throws for an HTTP status; a network failure is provider.network.
 *  A 401 on an installation token drops the cached token and tries once more with a new one. */
export async function raw(ctx: GithubCtx, c: Request): Promise<Answer> {
  if (c.auth.as === "none") return send(ctx, c, null);
  if (c.auth.as === "app") return send(ctx, c, await needHost(ctx).appJwt(ctx));
  const installationId = c.auth.installationId;
  let answer = await send(ctx, c, await installationToken(ctx, installationId));
  if (answer.status === 401) answer = await send(ctx, c, await installationToken(ctx, installationId, true));
  return answer;
}

/** The call, with GitHub's refusals mapped to the error catalogue. Returns the parsed body of a 2xx. */
export async function api(ctx: GithubCtx, c: Request): Promise<Json> {
  const a = await raw(ctx, c);
  if (a.status < 300) return a.json;
  throw refusal(ctx, a.status, a.json);
}

/** Map a GitHub error status. GitHub's own message is not passed on: it can echo what a person typed. */
export function refusal(ctx: Pick<GithubCtx, "trace">, status: number, json: Json) {
  const t = ctx.trace.traceId;
  const details = { status };
  const limited = status === 429 || (status === 403 && /rate limit/i.test(text(json.message)));
  if (limited) return fail("provider.rate_limited", t, { message: "GitHub asked us to slow down.", details });
  if (status === 401) return fail("provider.auth_failed", t, { message: "GitHub did not accept the App. Check the GitHub App key in the Vault.", details });
  if (status === 403) return fail("provider.auth_failed", t, { message: "The GitHub App may not do this. Check its permissions and that it is installed on the repository.", details });
  if (status === 404) return fail("validation.not_found", t, { message: "GitHub has no such item, or the App cannot see it.", details });
  if (status === 405 || status === 409) return fail("validation.precondition_failed", t, { message: "GitHub refused because of the state of the item.", details });
  if (status === 422 || status === 400) return fail("validation.bad_input", t, { message: "GitHub could not use that request.", details });
  if (status >= 500) return fail("provider.unavailable", t, { message: "GitHub is not answering right now.", details });
  return fail("provider.bad_response", t, { message: "GitHub answered something unexpected.", details });
}

// ---- installations

/** The installation to act through: the one named, else the one that holds the repository, else the Space's only installation. */
export async function installationFor(ctx: GithubCtx, a: { installationId?: number; repo?: string }): Promise<number> {
  if (a.installationId !== undefined) return numberOf(ctx, a.installationId, "The installation");
  const known = installCache(ctx.db);
  if (a.repo) {
    const hit = known.get(a.repo);
    if (hit !== undefined) return hit;
    const found = await api(ctx, { path: `${repoPath(ctx, a.repo)}/installation`, auth: { as: "app" } });
    const id = intOrUndef(found.id);
    if (id === undefined) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub did not say which installation holds that repository." });
    known.set(a.repo, id);
    return id;
  }
  const res = await api(ctx, { path: "/app/installations", auth: { as: "app" } });
  const all = list(res.items).map(obj);
  if (all.length === 0) refuse(ctx, "The GitHub App is not installed on any account yet. Install it from the link in Settings, Integrations.");
  if (all.length > 1) refuse(ctx, "The GitHub App is installed on more than one account. Say which repository or installation.");
  const id = intOrUndef(all[0]?.id);
  if (id === undefined) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered an installation with no id." });
  return id;
}

export const inline = {};
export const consumers = {};
export const codecs = {};
