// connectors module state and shared helpers: tables (migrations/0001_connectors.sql), the ConnectorDef shape the runtime executes, egress by declared domain, request templates,
// scrubbing of secret values from anything that leaves the runtime, and the per-connection rate limit.
// @reads /modules/connectors/migrations/0001_connectors.sql
// @reads /modules/connectors/migrations/0002_source_folders.sql
// @reads /modules/connectors/migrations/0003_oauth.sql
// @reads /modules/connectors/migrations/0004_sync_specs.sql
// @reads /modules/connectors/migrations/0005_hosts.sql
import { readFileSync } from "node:fs";
import { mintUuid } from "../../lib/ids.ts";
import { secretForms } from "../../lib/redact.ts";
import { fail } from "../../host/src/routes/errors.ts";
import { activeCodeBuiltins } from "../../lib/builtin-connectors.ts";
import type { Tx } from "../../kernel/src/store/projection.ts";

export type ErrCode = Parameters<typeof fail>[0];
export type Mode = "api" | "mcp" | "dwd" | "oauth_app" | "webhook_only";
export type Scope = "person" | "space";
export type ConnectorState = "live" | "draft" | "failing_tests";
export type ConnectionState = "pending" | "active" | "paused" | "needs_reconnect" | "failing";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AuthDef {
  type: "api_key" | "bearer" | "oauth2" | "client_credentials" | "oauth_refresh" | "none";
  /** Declared secret that holds the key or the access token. */
  secret?: string;
  /** api_key: the header the key travels in, and a prefix such as "Token ". Default Authorization. */
  header?: string;
  prefix?: string;
  /** oauth2 */
  authUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
  /** The NAME of a declared secret that holds the client secret (never the secret itself). */
  clientSecret?: string;
  /** oauth_refresh: the NAMES of the declared secrets that hold the client id and the refresh token (clientSecret names the client secret). One Vault item holds all three; a rotated refresh token is written back to it. */
  clientIdSecret?: string;
  refreshSecret?: string;
  /** Where a token is revoked when a connection is deleted; optional, best effort. */
  revokeUrl?: string;
  /** api_key or bearer only: send HTTP Basic (user:password) instead of a header. Both are templates (`{secret.Name}` or plain words, "api"); the password may be empty. The joined value is scrubbed like a secret. */
  basic?: { user: string; pass?: string };
  /** client_credentials (a server-to-server token): the action that trades the connection's own secrets for a short-lived token, which is sent as a Bearer on every other action. The token is held in memory for the call and never kept. */
  tokenAction?: string;
}

/** One call the connector makes. `{input.x}`, `{secret.Name}` and `{connection.id}` are filled in at call time; secrets only in headers and body. */
export interface ActionDef {
  name: string;
  method?: Method;
  url?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** HTTP Basic for this call alone (the token call of a server-to-server service): templates like auth.basic. */
  basic?: { user: string; pass?: string };
  /** A form body (application/x-www-form-urlencoded) filled like a template; used instead of `body`. A secret may sit here, never in the address. */
  form?: Record<string, string>;
  /** JSON pointer into the JSON response that becomes the output. */
  output?: string;
  /** Changes something in the app: a dry run never sends it and the Gate treats it as outward. */
  write?: boolean;
  /** How the sync engine reads or writes an app whose answers are not the engine's own shape (a SyncSpec compiles to these). */
  shape?: ActionShape;
}
/** A list action: where the items are, how to read each one and how to ask for the next page. A write action: nest flat values (keyed by pointer) into the body, and read the new id from the answer. */
export interface ActionShape {
  items?: string;
  id?: string;
  updatedAt?: string;
  fields?: string[];
  types?: Record<string, string>;
  choices?: Record<string, string[]>;
  cursor?: { kind: string; param?: string; next?: string; size?: number; start?: number };
  /** The query parameter that takes a time (`input.since`, ms) so a list answers only what changed since, and how the app writes that time: iso, epoch_ms or epoch_s. */
  since?: { param: string; format?: string };
  unflatten?: boolean;
  idAt?: string;
}
export interface RecordedResponse {
  method?: string;
  url: string;
  status?: number;
  body?: unknown;
  /** The Link response header, for link-header pagination. */ link?: string;
}
export interface TestCase {
  name: string;
  action: string;
  input?: unknown;
  responses: RecordedResponse[];
  expect?: { output?: unknown; error?: string; requests?: number };
}
/** A rule on a check answer: the status, and optionally words that must be in the answer's body (read on the server, never passed on). */
export interface VerdictRule {
  status: number;
  has?: string;
}
export interface ConnectorDef {
  key: string;
  /** Pointers of sealed fields (a synced connector's): their values are "[sealed]" in every output, for every caller but the sync engine's own pass. */
  sealed?: string[];
  title: string;
  mode: Mode;
  scope: Scope;
  version: string;
  auth: AuthDef;
  domains: string[];
  secrets: { name: string; description: string; label?: string; legacy?: boolean }[];
  /** Set when a release ships this definition: a hash of the definition as shipped. A stored row whose own hash still matches was never changed by anyone, so a later release may replace it; a changed one is never touched. */
  shipped?: string;
  actions: ActionDef[];
  /** The service's own page where its keys are found: a link for the person on the card, never a place a key is sent. */
  keysPage?: string;
  /** How a check call's answer tells a wrong key from a key without the needed permission. Only the verdict leaves the server, never the answer. A 4xx that matches nothing here is an unclear answer (not a wrong key). */
  verdicts?: { limited?: VerdictRule[]; rejected?: VerdictRule[] };
  /** A choice the person makes on the card that picks which connector is used (a region): each option is a connector of its own with its own exact hosts. Set on the first one only. */
  choice?: { name: string; label: string; options: { value: string; label: string; connector: string }[] };
  sources?: string[];
  syncedTypes?: string[];
  health?: string;
  rate?: { rps: number; burst: number };
  tests?: TestCase[];
  builtin?: boolean;
  /** Per-object action names for the sync engine (P-CC_19); a name left out keeps the convention. */
  objects?: Record<
    string,
    {
      list?: string;
      listAfter?: string;
      create?: string;
      update?: string;
      delete?: string;
      /** The list can be asked for what changed since a time (`input.since`, in ms): a poll reads only that. */ since?: boolean;
      /** Each row of this object also relates two already-synced records to each other (a many-to-many made from join rows). */
      link?: { from: { type: string; at: string }; to: { type: string; at: string }; key: string; inverseKey: string };
    }
  >;
}

export interface ConnectionDb {
  connection_id: string;
  connector: string;
  title: string;
  owner_kind: "person" | "space";
  owner_id: string;
  state: ConnectionState;
  paused_by: string | null;
  paused_from: string | null;
  scopes: string;
  secrets: string;
  last_sync_at: number | null;
  created_at: number;
}

export interface ConnectorsDeps {
  tx: Tx;
  /** Connectors the generator knows (generated/registry.json): seeded as built-in. */
  builtins: BuiltinRow[];
  now?: () => number;
  /** The value of a Vault item by handle, resolved server side at call time. Values never come back out of a handler. */
  resolveSecret?: (
    handle: string,
    binding?: { connector: string; connectionId: string; slot: string },
  ) => Promise<string | undefined>;
  /** A kept secret is about to be used again: the host asks the access checks of this very call (connection, Vault item). Throws the refusal; false says it cannot tell, and the value is read again. */
  recheckSecret?: (
    handle: string,
    binding: { connector: string; connectionId: string; slot: string },
  ) => Promise<boolean | void>;
  /** Waits in line for the connection's budget (the host's timer). Absent in tests, where a call at its limit is refused with the wait. */
  pace?: (ms: number) => Promise<void>;
  /** Store a secret the module obtained (an OAuth token) in the Vault and return its handle. */
  storeSecret?: (name: string, value: string) => Promise<string>;
  /** The connector folder in Files: parsed into a def (connector.toml, tests). Drafts follow it. */
  loadFolderDef?: (key: string) => Promise<ConnectorDef | undefined>;
  /** Write a private export of a connector to the caller's Personal Files and return its folder id. Never the source. */
  writeFolder?: (key: string, files: { path: string; content: string }[]) => Promise<string>;
  /** Create the canonical editable source (Shared knowledge > connectors > key, Review changes on) and write the files. `register` records the mapping once the folder exists and BEFORE any file is written. */
  writeSource?: (
    key: string,
    files: { path: string; content: string }[],
    register: (folderId: string) => void,
  ) => Promise<string>;
  /** Asks again, as the original caller, whether they may still edit this connector (a publish checks after its awaited tests). Throws when they may not. */
  assertCanPublish?: (key: string) => void | Promise<void>;
  /** Connectors with synced types bound to them (they block removal). */
  boundSyncedTypes?: (key: string) => Promise<string[]>;
  publicBase?: string;
  /** One read-only GET of an app with a Vault handle as the key, for discovery and for checking a SyncSpec against a real page. The host fills the key at the last moment; it never comes back. */
  probe?: Probe;
}
export interface ProbeRequest {
  handle: string;
  style: "bearer" | "header" | "basic";
  header?: string;
  prefix?: string;
  headers?: Record<string, string>;
  domain: string;
  url: string;
  /** Sign in by trading a refresh token (auth style oauth_refresh): the item's handle is `handle`, and style is bearer once the token is had. */
  refreshFrom?: { tokenUrl: string };
}
export interface ProbeReply {
  status: number;
  text: string;
  link?: string;
  retryAfter?: string;
}
export type Probe = (ctx: ConnectorsCtx, req: ProbeRequest) => Promise<ProbeReply>;

export interface BuiltinRow {
  key: string;
  title: string;
  mode: Mode;
  scope: Scope;
  domains: string[];
  secrets: { name: string; description: string }[];
  actions: string[];
  sources?: { key: string }[];
  health?: string;
  rate?: { rps: number; burst: number };
  auth?: { type?: string; secret?: string };
}

export interface ConnectorsCtx {
  trace: { traceId: string };
  emit(name: string, subject: string, payload: Record<string, unknown>, opts?: { afterFailure?: boolean }): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  http(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    text(): Promise<string>;
    /** The Link response header, when the app sent one (link-header pagination). */ link?: string;
    /** The Retry-After response header, when the app sent one (seconds or an HTTP date). */ retryAfter?: string;
  }>;
  /** Run a capability later as the person who asked (ctx.schedule). Absent in tests, where a pass is run by calling the capability. */
  schedule?(at: number | string, cap: string, input: unknown, opts?: { as?: string }): Promise<string>;
  log?: {
    info(msg: string, attrs?: Record<string, unknown>): void;
    warn(msg: string, attrs?: Record<string, unknown>): void;
    error(msg: string, attrs?: Record<string, unknown>): void;
  };
  actor?: string;
  /** The caller is one of the server's own jobs (svc_host, svc_engine...), never a service a tenant made. */
  trusted?: boolean;
  /** May the caller manage the Space's connections (connectors.manage)? A Space-owned connection needs it; a person's own does not. Absent only in module tests. */
  /** The kind of principal that made this call (person, agent ...), when the host says; check_key is a person's act only. */
  callerKind?: string;
  canManageSpace?(): boolean;
  /** Does the caller see the Space as a whole (View on it)? A guest does not, and so sees only their own connections. Absent only in module tests. */
  canViewSpace?(): boolean;
}

export const nowOf = (d: Pick<ConnectorsDeps, "now">): number => (d.now ?? Date.now)();
export const mintShort = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function refuse(
  ctx: Pick<ConnectorsCtx, "trace">,
  code: ErrCode,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

const ready = new WeakSet<object>();
export function ensureTables(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(readFileSync(new URL("./migrations/0001_connectors.sql", import.meta.url), "utf8"));
  tx.exec(readFileSync(new URL("./migrations/0002_source_folders.sql", import.meta.url), "utf8"));
  tx.exec(readFileSync(new URL("./migrations/0003_oauth.sql", import.meta.url), "utf8"));
  tx.exec(readFileSync(new URL("./migrations/0004_sync_specs.sql", import.meta.url), "utf8"));
  tx.exec(readFileSync(new URL("./migrations/0005_hosts.sql", import.meta.url), "utf8"));
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
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `${raw.slice(0, 60)} is not an address` };
  }
  if (url.username || url.password)
    return { ok: false, reason: "an address with a user name or password in it is refused" };
  const internal = url.hostname.endsWith(".internal") || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(internal && url.protocol === "http:"))
    return { ok: false, reason: `${url.protocol.replace(":", "")} is not allowed: connectors use https` };
  if (!domainAllowed(url.hostname, domains))
    return { ok: false, reason: `${url.hostname} is not one of this connector's domains` };
  return { ok: true, url };
}

// ---- templates ----

const PLACEHOLDER = /\{(input|secret|connection)\.([A-Za-z0-9_.]+)\}/g;
const WHOLE = /^\{(input|secret|connection)\.([A-Za-z0-9_.]+)\}$/;

export interface Scope3 {
  input: unknown;
  secret: Record<string, string>;
  connection: { id: string };
}

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
    const text =
      typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    if (encode && kind === "input") {
      // a value that is a place in the path ("..", a slash, "?" or "#", raw or decoded) would climb or leave the path the connector wrote: refused before any request
      let plain = text;
      try {
        plain = decodeURIComponent(text);
      } catch {
        /* not encoded */
      }
      for (const t of [text, plain])
        if (t === "." || t === ".." || /[\\/?#]/.test(t))
          throw new Error(`${path} cannot be "." or "..", or hold a slash, backslash, ? or #`);
      return encodeURIComponent(text);
    }
    return text;
  });
}

/** A body template: a string that is one placeholder keeps the value's type, any other string is interpolated, objects and arrays recurse. */
export function fillValue(t: unknown, scope: Scope3): unknown {
  if (typeof t === "string") {
    const whole = WHOLE.exec(t);
    if (whole) {
      const v = lookup(scope, whole[1]!, whole[2]!);
      if (v === undefined) throw new Error(`${whole[1]}.${whole[2]} has no value`);
      return v;
    }
    return fillString(t, scope);
  }
  if (Array.isArray(t)) return t.map((x) => fillValue(x, scope));
  if (t && typeof t === "object")
    return Object.fromEntries(Object.entries(t as Record<string, unknown>).map(([k, v]) => [k, fillValue(v, scope)]));
  return t;
}

/** Names of the secrets a template string or value reads. */
export function secretsIn(t: unknown, out = new Set<string>()): Set<string> {
  if (typeof t === "string") {
    for (const m of t.matchAll(PLACEHOLDER)) if (m[1] === "secret") out.add(m[2]!);
  } else if (Array.isArray(t)) t.forEach((x) => secretsIn(x, out));
  else if (t && typeof t === "object") Object.values(t as Record<string, unknown>).forEach((x) => secretsIn(x, out));
  return out;
}

// ---- scrubbing ----

/** Replace every occurrence of a secret value (4 characters or more), and its base64 and URL-encoded forms, with ***, in text and in anything JSON-shaped. */
export function scrubber(values: readonly string[]): { text(s: string): string; value<T>(v: T): T } {
  const list = [...new Set(values.flatMap((v) => secretForms(v)))].sort((a, b) => b.length - a.length);
  const text = (s: string): string => list.reduce((acc, v) => acc.split(v).join("***"), s);
  return { text, value: <T>(v: T): T => (list.length ? (JSON.parse(text(JSON.stringify(v ?? null))) as T) : v) };
}

// ---- rate limit ----

const buckets = new Map<string, { tokens: number; at: number }>();
/** What an app's "slow down" asks of one connection: no call goes before `until`, for every object of the connection together. */
const holds = new Map<string, { until: number; strikes: number }>();
/** Without a Retry-After the wait starts here and doubles each time the app says it again, up to the cap. */
export const SLOW_DOWN_FIRST_MS = 30_000;
export const SLOW_DOWN_CAP_MS = 480_000;
/** An app's own Retry-After is believed, up to this. */
export const SLOW_DOWN_LONGEST_MS = 900_000;
/** Token bucket per connection: `rps` refill, `burst` capacity. Returns false when the call must wait. */
export function takeToken(key: string, rate: { rps: number; burst: number } | undefined, nowMs: number): boolean {
  const held = holds.get(key);
  if (held && held.until > nowMs) return false;
  if (!rate) return true;
  const b = buckets.get(key) ?? { tokens: rate.burst, at: nowMs };
  b.tokens = Math.min(rate.burst, b.tokens + ((nowMs - b.at) / 1000) * rate.rps);
  b.at = nowMs;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
/** The longest wait a call serves in line (when the host gives it a way to wait); a longer one is refused with the wait it needs. */
export const PACE_LONGEST_MS = 5_000;
/** The most one call waits in line for the budget altogether; then it fails with the wait it still needs and the pass asks again later. */
export const PACE_TOTAL_MS = 30_000;
/** What an app's "slow down" still holds this connection for (0: nothing). */
export function holdMsOf(key: string, nowMs: number): number {
  const held = holds.get(key);
  return held && held.until > nowMs ? held.until - nowMs : 0;
}
/** How long until a call on this connection may go (0: now). Reads only. */
export function tokenWaitMs(key: string, rate: { rps: number; burst: number } | undefined, nowMs: number): number {
  const held = holds.get(key);
  const hold = held && held.until > nowMs ? held.until - nowMs : 0;
  const b = buckets.get(key);
  if (!rate || !b || rate.rps <= 0) return hold;
  const tokens = Math.min(rate.burst, b.tokens + ((nowMs - b.at) / 1000) * rate.rps);
  const refill = tokens >= 1 ? 0 : Math.ceil(((1 - tokens) / rate.rps) * 1000);
  return Math.max(hold, refill, 0);
}
/** A Retry-After header: seconds, or an HTTP date. Undefined when it is missing or unreadable. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}
/** The app answered 429: hold every call of this connection for what it asked (or a doubling wait from 30 s), and return the wait. */
export function noteRateLimited(key: string, nowMs: number, askedMs?: number): number {
  const strikes = (holds.get(key)?.strikes ?? 0) + 1;
  const backoff = Math.min(SLOW_DOWN_CAP_MS, SLOW_DOWN_FIRST_MS * 2 ** (strikes - 1));
  const wait = Math.min(SLOW_DOWN_LONGEST_MS, Math.max(1000, askedMs ?? backoff));
  holds.set(key, { until: nowMs + wait, strikes });
  const b = buckets.get(key);
  if (b) b.tokens = 0;
  return wait;
}
/** The app answered something other than 429: the next "slow down" starts the doubling again. */
export function noteServed(key: string): void {
  const h = holds.get(key);
  if (h) h.strikes = 0;
}
export const resetRateLimits = (): void => {
  buckets.clear();
  holds.clear();
};

// ---- rows ----

export const PAGE = (input: { cursor?: string; limit?: number }): { start: number; limit: number } => ({
  start: input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0,
  limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
});

export function builtinDef(b: BuiltinRow): ConnectorDef {
  const authType =
    b.auth?.type === "api_key" || b.auth?.type === "bearer" || b.auth?.type === "oauth2" || b.auth?.type === "none"
      ? b.auth.type
      : "none";
  return {
    key: b.key,
    title: b.title,
    mode: b.mode,
    scope: b.scope,
    version: "1.0.0",
    builtin: true,
    auth: { type: authType, ...(b.auth?.secret ? { secret: b.auth.secret } : {}) },
    domains: b.domains,
    secrets: b.secrets,
    actions: b.actions.map((name) => ({ name })),
    ...(b.sources?.length ? { sources: b.sources.map((s) => s.key) } : {}),
    ...(b.health ? { health: b.health } : {}),
    ...(b.rate ? { rate: b.rate } : {}),
  };
}

/** The hash a shipped definition carries (see ConnectorDef.shipped). */
export const shippedHash = (def: ConnectorDef): string => {
  // a plain 53-bit string hash (cyrb53): it only tells an unchanged row from a changed one, it protects nothing
  const text = JSON.stringify({ ...def, shipped: undefined });
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

/** Built-in connectors from the registry go into cn_connectors once (a later change by a person is never overwritten). */
const seeded = new WeakSet<object>();

/**
 * A key that a release makes built in, held by a connector a person made before: the person-made one moves aside to `<key>-yours` (its definition, versions, drafts, connections, synced types and source folder go with it, so
 * nothing is dropped and its connections keep working), and the built-in takes the key. Without this the person-made row would shadow the built-in for good with builtin = 0.
 */
export function makeRoomForBuiltin(tx: Tx, key: string, now: number): void {
  const mine = tx.get<{ key: string; title: string; def: string }>(
    "SELECT key, title, def FROM cn_connectors WHERE key = ? AND builtin = 0",
    key,
  );
  if (!mine) return;
  let aside = `${key}-yours`;
  for (let n = 2; tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = ?", aside); n++) aside = `${key}-yours-${n}`;
  const def = { ...(JSON.parse(mine.def) as ConnectorDef), key: aside, title: `${mine.title} (yours)` };
  tx.run(
    "INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) SELECT ?, ?, mode, scope, 0, version, state, ?, created_at, ? FROM cn_connectors WHERE key = ?",
    aside,
    def.title,
    JSON.stringify(def),
    now,
    key,
  );
  for (const [table, col] of [
    ["cn_connections", "connector"],
    ["cn_drafts", "key"],
    ["cn_versions", "key"],
    ["cn_sync_specs", "connector"],
    ["cn_sync_spec_types", "connector"],
    ["cn_sync_hooks", "connector"],
    ["cn_source_folders", "key"],
  ] as const)
    tx.run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, aside, key);
  tx.run("DELETE FROM cn_connectors WHERE key = ?", key);
}

export function seedBuiltins(deps: ConnectorsDeps): void {
  if (seeded.has(deps.tx)) return;
  ensureTables(deps.tx);
  const now = nowOf(deps);
  const code = activeCodeBuiltins() as readonly ConnectorDef[];
  const insert = (def: ConnectorDef): void => {
    deps.tx.run(
      "INSERT INTO cn_connectors (key, title, mode, scope, builtin, version, state, def, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, 'live', ?, ?, ?)",
      def.key,
      def.title,
      def.mode,
      def.scope,
      def.version,
      JSON.stringify(def),
      now,
      now,
    );
  };
  for (const b of deps.builtins) {
    // a service the product now defines in code (exact addresses, a real check) takes the registry's place: it is seeded below, carrying the registry's own action names
    if (code.some((c) => c.key === b.key)) continue;
    makeRoomForBuiltin(deps.tx, b.key, now);
    if (deps.tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = ?", b.key)) continue;
    insert(builtinDef(b));
  }
  for (const own of code) {
    makeRoomForBuiltin(deps.tx, own.key, now);
    const reg = deps.builtins.find((b) => b.key === own.key);
    // the registry's actions that have no address stay named (their module runs them); the ones written here have addresses
    const named = reg
      ? reg.actions.filter((n) => !own.actions.some((a) => a.name === n)).map((name) => ({ name }))
      : [];
    const body: ConnectorDef = {
      ...own,
      actions: [...own.actions, ...named],
      ...(reg?.sources?.length ? { sources: reg.sources.map((x) => x.key) } : {}),
    };
    const def: ConnectorDef = { ...body, shipped: shippedHash(body) };
    const have = deps.tx.get<{ def: string; builtin: number }>(
      "SELECT def, builtin FROM cn_connectors WHERE key = ?",
      own.key,
    );
    if (!have) {
      insert(def);
      continue;
    }
    // A row is replaced only when nobody changed it: it is exactly what the registry wrote (an earlier release), or it still carries the hash of the definition it was shipped with. A later fix to a shipped
    // definition reaches those; a row a Space changed (its hash no longer matches) is never overwritten.
    const stored = JSON.parse(have.def) as ConnectorDef;
    const { shipped: was, ...rest } = stored;
    const pristine =
      have.builtin === 1 &&
      ((was !== undefined && was === shippedHash(rest as ConnectorDef)) ||
        (was === undefined && reg !== undefined && have.def === JSON.stringify(builtinDef(reg))));
    if (pristine && was !== def.shipped) {
      deps.tx.run(
        "UPDATE cn_connectors SET title = ?, mode = ?, scope = ?, version = ?, def = ?, updated_at = ? WHERE key = ?",
        def.title,
        def.mode,
        def.scope,
        def.version,
        JSON.stringify(def),
        now,
        own.key,
      );
    }
  }
  backfillHosts(deps.tx);
  seeded.add(deps.tx);
}

/** The host record every connection gets when it is made (cn_connection_hosts): a connection from before that table exists gets the same one from its connector's actions, once at start-up (a row that exists is never touched). */
export function backfillHosts(tx: Tx): void {
  const rows = tx.all<{ connection_id: string; def: string }>(
    "SELECT c.connection_id AS connection_id, k.def AS def FROM cn_connections c JOIN cn_connectors k ON k.key = c.connector WHERE NOT EXISTS (SELECT 1 FROM cn_connection_hosts h WHERE h.connection_id = c.connection_id)",
  );
  for (const r of rows) {
    const def = JSON.parse(r.def) as ConnectorDef;
    if (hostFromInput(def) || keyHosts(def).length === 0) continue;
    tx.run(
      "INSERT OR IGNORE INTO cn_connection_hosts (connection_id, hosts) VALUES (?, ?)",
      r.connection_id,
      JSON.stringify(recordHosts(def)),
    );
  }
}

/** A host with its port, the default when none is given: what a connection's record holds and what a request is compared with, so the same host on another port gets nothing. */
export const originKey = (u: URL): string =>
  `${u.hostname.toLowerCase().replace(/\.$/, "")}:${u.port || (u.protocol === "http:" ? "80" : "443")}`;
/** The hosts (with ports) the connector's actions call now: what a connection's record is written from. */
export const recordHosts = (def: ConnectorDef): string[] => {
  const out: string[] = [];
  const add = (raw: string | undefined): void => {
    try {
      if (raw) {
        const k = originKey(new URL(raw.replace(/\{[^}]*\}/g, "x")));
        if (!out.includes(k)) out.push(k);
      }
    } catch {
      /* not an address */
    }
  };
  add(def.actions.find((a) => a.name === (def.health ?? probeOf(def)))?.url);
  for (const a of def.actions) add(a.url);
  return out;
};

/** Does any action take its host from the caller's input (`https://{input.host}/...`)? Such a connection has no fixed host to record. */
export const hostFromInput = (def: ConnectorDef): boolean =>
  def.actions.some((a) => a.url !== undefined && /^[a-z]+:\/\/[^/]*\{/i.test(a.url));

/** The call that tries a key: the connector's health action, else its first GET that takes nothing from the caller. */
/** The host a key tried by the connector's check is sent to: the host of that call's own address. */
/** Every host a key kept for this connector can be sent to: the check's, then each action's own address. */
export const keyHosts = (def: ConnectorDef): string[] => {
  const out: string[] = [];
  const first = probeHost(def);
  if (first) out.push(first);
  for (const a of def.actions) {
    try {
      const h = a.url ? new URL(a.url.replace(/\{[^}]*\}/g, "x")).hostname : "";
      if (h && !out.includes(h)) out.push(h);
    } catch {
      /* not an address */
    }
  }
  return out;
};

export const probeHost = (def: ConnectorDef): string | undefined => {
  const name = def.health ?? probeOf(def);
  const url = def.actions.find((a) => a.name === name)?.url;
  try {
    return url ? new URL(url.replace(/\{[^}]*\}/g, "x")).hostname : undefined;
  } catch {
    return undefined;
  }
};

export const probeOf = (def: ConnectorDef): string | undefined =>
  def.health ??
  def.actions.find(
    (a) =>
      (a.method ?? "GET") === "GET" &&
      a.url !== undefined &&
      !/\{input[.}]/.test(JSON.stringify([a.url, a.query, a.headers, a.body])),
  )?.name;

// ---- secrets in an answer ----

/**
 * A key whose name says it holds a secret (case and separators do not matter): its value never leaves an action's output. Any name ending in "token" counts, except
 * the ones that only say where a list goes on (next_page_token, cursor tokens): masking those would stop paging.
 */
const SECRET_KEY =
  /(clientsecret|secretkey|apikey|privatekey|signingkey|password|passwd|passphrase|secret|credential|credentials|authorization)$/;
const PAGING_TOKEN =
  /(page|next|prev|previous|continuation|cursor|sync|start|resume|delta|skip|since|offset|pagination|paging)token$/;
/** Names of secret identifiers (a person's, not a service's): social security, tax id, account and routing numbers, driver licence, passport and card numbers. "ein" and "tin" only when the key is exactly that. */
const SECRET_IDENTIFIER =
  /^(ssn|ein|tin|taxid|socialsecurity(number|no|num)?|accountnumber|accountno|routingnumber|driver(s)?licen[cs]e(number|no|num)?|passportnumber|passportno|cardnumber|cardno)$/;
export const secretKeyName = (k: string): boolean => {
  const n = k.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY.test(n) || SECRET_IDENTIFIER.test(n) || (n.endsWith("token") && !PAGING_TOKEN.test(n));
};

/** Known only inside this process: the sync engine's own pass says it (in the action's input) to be given the real values of sealed fields, which it seals at once. Nobody else can. */
export const SYNC_PASS_TOKEN = `sp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
export const SEALED_MASK = "[sealed]";
/**
 * The real values of sealed fields read by one sync pass, kept in this process only, by the pass's nonce and the row's id. They never travel in an action's answer (the answer is masked): the engine takes them
 * from here, in the same process, to seal them, so no kept answer, log or span of the pipeline can hold them.
 */
const heldByPass = new Map<string, Map<string, Record<string, unknown>>>();
export const SEALED_HELD = {
  put(nonce: string, rowId: string, values: Record<string, unknown>): void {
    let m = heldByPass.get(nonce);
    if (!m) heldByPass.set(nonce, (m = new Map()));
    m.set(rowId, { ...(m.get(rowId) ?? {}), ...values });
  },
  get: (nonce: string, rowId: string): Record<string, unknown> | undefined => heldByPass.get(nonce)?.get(rowId),
  done(nonce: string): void {
    heldByPass.delete(nonce);
  },
};
const KEEP = new Set(["id", "name", "type", "field_type", "label", "key"]);
/**
 * The value with every sealed path masked, nested and in lists. A path is a pointer into one item (/attributes/ssn, /attributes/custom_field_values/<id>/formatted_value). Besides the leaf, the other
 * value-bearing siblings of the leaf (all but id, name and a type) are masked, and so is any list item anywhere that carries the same id (custom fields come both as a map by id and as a list of {id, name, value}).
 * A pulled row's data is keyed by the pointers themselves: those keys, and the keys under the leaf's parent pointer, are masked too.
 */
export function maskSealed<T>(v: T, paths: readonly string[]): T {
  if (!paths.length || v === null || typeof v !== "object") return v;
  const root = JSON.parse(JSON.stringify(v)) as unknown;
  const ids = new Set<string>();
  const maskItem = (o: Record<string, unknown>): void => {
    for (const k of Object.keys(o)) if (!KEEP.has(k)) o[k] = SEALED_MASK;
  };
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const parents = paths.map((p) => p.slice(0, Math.max(p.lastIndexOf("/"), 0)));
  // the leaf sits in an item (a custom field by id or position): its siblings are the item's other values
  const items = parents.map((q) => /\/\d+$/.test(q));
  // flat keys (a pulled row)
  const visit = (x: unknown, fn: (o: Record<string, unknown>) => void): void => {
    if (Array.isArray(x)) for (const y of x) visit(y, fn);
    else if (isObj(x)) {
      fn(x);
      for (const y of Object.values(x)) visit(y, fn);
    }
  };
  visit(root, (o) => {
    for (const [i, p] of paths.entries()) {
      if (p in o) o[p] = SEALED_MASK;
      for (const k of Object.keys(o))
        if (items[i] && k.startsWith(`${parents[i]}/`) && k !== p && !KEEP.has(k.slice(k.lastIndexOf("/") + 1)))
          o[k] = SEALED_MASK;
    }
  });
  // nested: walk each pointer
  for (const p of paths) {
    const segs = p
      .split("/")
      .slice(1)
      .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (!segs.length) continue;
    const walk = (cur: unknown, i: number, trail: unknown[]): void => {
      if (cur === null || typeof cur !== "object") return;
      const seg = segs[i]!;
      const next = (cur as Record<string, unknown>)[seg];
      if (i === segs.length - 1) {
        if (isObj(cur) && seg in cur) {
          const holder = trail[trail.length - 1];
          if (isObj(cur) && (cur["id"] !== undefined || /^\d+$/.test(String(segs[i - 1] ?? "")))) {
            ids.add(String(cur["id"] ?? segs[i - 1]));
            maskItem(cur);
          } else cur[seg] = SEALED_MASK;
          void holder;
        }
        return;
      }
      walk(next, i + 1, [...trail, cur]);
    };
    visit(root, (o) => walk(o, 0, []));
  }
  if (ids.size)
    visit(root, (o) => {
      if (o["id"] !== undefined && ids.has(String(o["id"])) && ("value" in o || "formatted_value" in o)) maskItem(o);
    });
  return root as T;
}
/**
 * The value with every value under a secret-named key (nested, in arrays) replaced by "***". A string that itself holds JSON (a service that answers with a
 * document inside a field) is read and guarded the same way.
 */
export function withoutSecretValues<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => withoutSecretValues(x)) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        secretKeyName(k) ? "***" : withoutSecretValues(x),
      ]),
    ) as T;
  if (typeof v === "string" && v.length < 200_000) {
    const t = v.trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        const inner: unknown = JSON.parse(v);
        const safe = withoutSecretValues(inner);
        const out = JSON.stringify(safe);
        if (out !== JSON.stringify(inner)) return out as T;
      } catch {
        /* not JSON: an ordinary string */
      }
    }
  }
  return v;
}
