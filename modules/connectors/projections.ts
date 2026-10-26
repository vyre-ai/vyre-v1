// connectors module state and shared helpers: tables (migrations/0001_connectors.sql), the ConnectorDef shape the runtime executes, egress by declared domain, request templates,
// scrubbing of secret values from anything that leaves the runtime, and the per-connection rate limit.
// @reads /modules/connectors/migrations/0001_connectors.sql
import { readFileSync } from "node:fs";
import { mintUuid } from "../../lib/ids.ts";
import { fail } from "../../host/src/routes/errors.ts";
import type { Tx } from "../../kernel/src/store/projection.ts";

export type ErrCode = Parameters<typeof fail>[0];
export type Mode = "api" | "mcp" | "dwd" | "oauth_app" | "webhook_only";
export type Scope = "person" | "space";
export type ConnectorState = "live" | "draft" | "failing_tests";
export type ConnectionState = "pending" | "active" | "paused" | "needs_reconnect" | "failing";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AuthDef {
  type: "api_key" | "bearer" | "oauth2" | "none";
  /** Declared secret that holds the key or the access token. */
  secret?: string;
  /** api_key: the header the key travels in, and a prefix such as "Token ". Default Authorization. */
  header?: string;
  prefix?: string;
  /** oauth2 */
  authUrl?: string; tokenUrl?: string; clientId?: string; clientSecret?: string; scopes?: string[];
}

/** One call the connector makes. `{input.x}`, `{secret.Name}` and `{connection.id}` are filled in at call time; secrets only in headers and body. */
export interface ActionDef {
  name: string; method?: Method; url?: string; headers?: Record<string, string>; query?: Record<string, string>; body?: unknown;
  /** JSON pointer into the JSON response that becomes the output. */
  output?: string;
  /** Changes something in the app: a dry run never sends it and the Gate treats it as outward. */
  write?: boolean;
}
export interface RecordedResponse { method?: string; url: string; status?: number; body?: unknown }
export interface TestCase {
  name: string; action: string; input?: unknown; responses: RecordedResponse[];
  expect?: { output?: unknown; error?: string; requests?: number };
}
export interface ConnectorDef {
  key: string; title: string; mode: Mode; scope: Scope; version: string; auth: AuthDef; domains: string[]; secrets: { name: string; description: string }[];
  actions: ActionDef[]; sources?: string[]; syncedTypes?: string[]; health?: string; rate?: { rps: number; burst: number }; tests?: TestCase[]; builtin?: boolean;
  /** Per-object action names for the sync engine (P-CC_19); a name left out keeps the convention. */
  objects?: Record<string, { list?: string; listAfter?: string; create?: string; update?: string; delete?: string }>;
}

export interface ConnectionDb {
  connection_id: string; connector: string; title: string; owner_kind: "person" | "space"; owner_id: string; state: ConnectionState; paused_by: string | null; paused_from: string | null;
  scopes: string; secrets: string; last_sync_at: number | null; created_at: number;
}

export interface ConnectorsDeps {
  tx: Tx;
  /** Connectors the generator knows (generated/registry.json): seeded as built-in. */
  builtins: BuiltinRow[];
  now?: () => number;
  /** The value of a Vault item by handle, resolved server side at call time. Values never come back out of a handler. */
  resolveSecret?: (handle: string) => Promise<string | undefined>;
  /** Store a secret the module obtained (an OAuth token) in the Vault and return its handle. */
  storeSecret?: (name: string, value: string) => Promise<string>;
  /** The connector folder in Files: parsed into a def (connector.toml, tests). Drafts follow it. */
  loadFolderDef?: (key: string) => Promise<ConnectorDef | undefined>;
  /** Write a connector folder to Files and return its folder id. */
  writeFolder?: (key: string, files: { path: string; content: string }[]) => Promise<string>;
  /** Connectors with synced types bound to them (they block removal). */
  boundSyncedTypes?: (key: string) => Promise<string[]>;
  publicBase?: string;
}

export interface BuiltinRow {
  key: string; title: string; mode: Mode; scope: Scope; domains: string[]; secrets: { name: string; description: string }[]; actions: string[];
  sources?: { key: string }[]; health?: string; rate?: { rps: number; burst: number }; auth?: { type?: string; secret?: string };
}

export interface ConnectorsCtx {
  trace: { traceId: string };
  emit(name: string, subject: string, payload: Record<string, unknown>, opts?: { afterFailure?: boolean }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string> }>;
  log?: { info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void; error(msg: string, attrs?: Record<string, unknown>): void };
  actor?: string;
}

export const nowOf = (d: Pick<ConnectorsDeps, "now">): number => (d.now ?? Date.now)();
export const mintShort = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function refuse(ctx: Pick<ConnectorsCtx, "trace">, code: ErrCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

const ready = new WeakSet<object>();
export function ensureTables(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(readFileSync(new URL("./migrations/0001_connectors.sql", import.meta.url), "utf8"));
  ready.add(tx);
}

// ---- egress ----

/** Is `host` one of the declared domains? `*.example.com` covers subdomains, `example.com` only itself. */
export function domainAllowed(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => {
    const dom = d.toLowerCase();
    return dom.startsWith("*.") ? h.endsWith(dom.slice(1)) && h.length > dom.length - 1 : h === dom;
  });
}

export type EgressResult = { ok: true; url: URL } | { ok: false; reason: string };

/** The only places a connector may call: https (or http for .internal and localhost), a declared domain, no credentials in the address. */
export function checkEgress(raw: string, domains: readonly string[]): EgressResult {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: `${raw.slice(0, 60)} is not an address` }; }
  if (url.username || url.password) return { ok: false, reason: "an address with a user name or password in it is refused" };
  const internal = url.hostname.endsWith(".internal") || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(internal && url.protocol === "http:")) return { ok: false, reason: `${url.protocol.replace(":", "")} is not allowed: connectors use https` };
  if (!domainAllowed(url.hostname, domains)) return { ok: false, reason: `${url.hostname} is not one of this connector's domains` };
  return { ok: true, url };
}

// ---- templates ----

const PLACEHOLDER = /\{(input|secret|connection)\.([A-Za-z0-9_.]+)\}/g;
const WHOLE = /^\{(input|secret|connection)\.([A-Za-z0-9_.]+)\}$/;

export interface Scope3 { input: unknown; secret: Record<string, string>; connection: { id: string } }

export function pointerGet(doc: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return doc;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(cur)) cur = /^\d+$/.test(key) ? cur[Number(key)] : undefined;
    else if (cur !== null && typeof cur === "object") cur = (cur as Record<string, unknown>)[key];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

function lookup(scope: Scope3, kind: string, path: string): unknown {
  if (kind === "secret") return scope.secret[path];
  if (kind === "connection") return path === "id" ? scope.connection.id : undefined;
  let cur: unknown = scope.input;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Fill `{input.x}`, `{secret.X}` and `{connection.id}` into a string. `encode` is for path and query parts. */
export function fillString(s: string, scope: Scope3, encode = false): string {
  return s.replace(PLACEHOLDER, (_m, kind: string, path: string) => {
    const v = lookup(scope, kind, path);
    if (v === undefined || v === null) throw new Error(`${kind}.${path} has no value`);
    const text = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    return encode && kind === "input" ? encodeURIComponent(text) : text;
  });
}

/** A body template: a string that is one placeholder keeps the value's type, any other string is interpolated, objects and arrays recurse. */
export function fillValue(t: unknown, scope: Scope3): unknown {
  if (typeof t === "string") {
    const whole = WHOLE.exec(t);
    if (whole) { const v = lookup(scope, whole[1]!, whole[2]!); if (v === undefined) throw new Error(`${whole[1]}.${whole[2]} has no value`); return v; }
    return fillString(t, scope);
  }
  if (Array.isArray(t)) return t.map((x) => fillValue(x, scope));
  if (t && typeof t === "object") return Object.fromEntries(Object.entries(t as Record<string, unknown>).map(([k, v]) => [k, fillValue(v, scope)]));
  return t;
}

/** Names of the secrets a template string or value reads. */
export function secretsIn(t: unknown, out = new Set<string>()): Set<string> {
  if (typeof t === "string") { for (const m of t.matchAll(PLACEHOLDER)) if (m[1] === "secret") out.add(m[2]!); }
  else if (Array.isArray(t)) t.forEach((x) => secretsIn(x, out));
  else if (t && typeof t === "object") Object.values(t as Record<string, unknown>).forEach((x) => secretsIn(x, out));
  return out;
}

// ---- scrubbing ----

/** Replace every occurrence of a secret value (4 characters or more) with ***, in text and in anything JSON-shaped. */
export function scrubber(values: readonly string[]): { text(s: string): string; value<T>(v: T): T } {
  const list = values.filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
  const text = (s: string): string => list.reduce((acc, v) => acc.split(v).join("***"), s);
  return { text, value: <T>(v: T): T => (list.length ? (JSON.parse(text(JSON.stringify(v ?? null))) as T) : v) };
}

// ---- rate limit ----

const buckets = new Map<string, { tokens: number; at: number }>();
/** Token bucket per connection: `rps` refill, `burst` capacity. Returns false when the call must wait. */
export function takeToken(key: string, rate: { rps: number; burst: number } | undefined, nowMs: number): boolean {
  if (!rate) return true;
  const b = buckets.get(key) ?? { tokens: rate.burst, at: nowMs };
  b.tokens = Math.min(rate.burst, b.tokens + ((nowMs - b.at) / 1000) * rate.rps);
  b.at = nowMs;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
export const resetRateLimits = (): void => buckets.clear();

// ---- rows ----

export const PAGE = (input: { cursor?: string; limit?: number }): { start: number; limit: number } => ({
  start: input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0, limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
});

export function builtinDef(b: BuiltinRow): ConnectorDef {
  const authType = b.auth?.type === "api_key" || b.auth?.type === "bearer" || b.auth?.type === "oauth2" || b.auth?.type === "none" ? b.auth.type : "none";
  return {
    key: b.key, title: b.title, mode: b.mode, scope: b.scope, version: "1.0.0", builtin: true,
    auth: { type: authType, ...(b.auth?.secret ? { secret: b.auth.secret } : {}) }, domains: b.domains, secrets: b.secrets, actions: b.actions.map((name) => ({ name })),
    ...(b.sources?.length ? { sources: b.sources.map((s) => s.key) } : {}), ...(b.health ? { health: b.health } : {}), ...(b.rate ? { rate: b.rate } : {}),
  };
}

/** Built-in connectors from the registry go into cn_connectors once (a later change by a person is never overwritten). */
const seeded = new WeakSet<object>();
export function seedBuiltins(deps: ConnectorsDeps): void {
  if (seeded.has(deps.tx)) return;
  ensureTables(deps.tx);
  const now = nowOf(deps);
  for (const b of deps.builtins) {
    if (deps.tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = ?", b.key)) continue;
    const def = builtinDef(b);
    deps.tx.run("INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, 'live', ?, ?, ?)", b.key, b.title, b.mode, b.scope, def.version, JSON.stringify(def), now, now);
  }
  seeded.add(deps.tx);
}
