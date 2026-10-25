// The two ports the events module stands on (packet P-H_05; consumed by P-L6_10): a read port over the Space event log and a safe outbound POST port for signed webhooks.
// Layer rule (boundaries.json): host never imports modules, so the module gets these through `hostSeams` (ruling 31): it exports `hostSeams = { setEventsHost }` and the daemon
// calls `wireEventsSeam` with that setter.
//
// Read port (spec 2.22, ARCH 4.2). The log is the source of truth; this port only reads it and filters for the reader:
//   - the reader is a member that is active; an agent reads for the person it acts for, a service for its owner; anyone else sees nothing;
//   - label: an event above the reader's clearance (the lowest of the subjects') is left out, not blanked, so its existence is not leaked;
//   - vis: `space` reaches every member; `participants` the actor, the person it was done for, or whoever may view the event's entity; `owner` the actor, the person it was
//     done for, or the Space owner; `private` the actor or the person it was done for;
//   - encrypted payloads (enc > 0) are never opened here: the row carries `payload: null, sealed: true`; an erased payload reads as it is stored (a tombstone).
// Results are oldest first from a cursor (a seq); `next` is the last seq looked at, so a caller makes progress even over a stretch it may not see.
//
// POST port. A webhook URL is typed by an admin, so the port is the whole egress policy: https only, no credentials in the address, a host on the Space's allowlist (a domain and its
// subdomains, or "*" for any public host), never a loopback, private or link-local address, never a redirect, a timeout, a cap on the body that goes out and on how much of the answer is
// read. The body is signed `HMAC-SHA256(secret, "<t>.<body>")` into `x-vyre-signature: t=<t>,v1=<hex>`. Only sha256Hex is used (boundary B3: crypto stays in the kernel).
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { ReadQuery, StoredEvent } from "../../../kernel/src/log/types.ts";
import { hostAllowed } from "../ctx/http.ts";
import { fail } from "../routes/errors.ts";

// ---------------------------------------------------------------- HMAC

const BLOCK = 64;
const enc = new TextEncoder();

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** HMAC-SHA-256 (RFC 2104) of text under a key, lower case hex, built on the kernel's sha256Hex. */
export function hmacSha256Hex(key: Uint8Array | string, text: string | Uint8Array): string {
  let k = typeof key === "string" ? enc.encode(key) : key;
  if (k.length > BLOCK) k = hexBytes(sha256Hex(k));
  const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) { const b = k[i] ?? 0; ipad[i] = b ^ 0x36; opad[i] = b ^ 0x5c; }
  return sha256Hex(opad, hexBytes(sha256Hex(ipad, text)));
}

/** The header value of a signed delivery: `t=<unix seconds>,v1=<hex>`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

// ---------------------------------------------------------------- read port

export interface EventLogSource {
  /** Oldest first after `q.after`, filtered by the indexed columns; the LogClient satisfies this. */
  read(q: ReadQuery): Promise<StoredEvent[]> | StoredEvent[];
  /** One event by its id; without it the port pages the log to find it (bounded). */
  byId?(id: string): Promise<StoredEvent | null> | StoredEvent | null;
  /** The newest seq. */
  head(): Promise<number> | number;
}

export interface EventReaderDeps {
  source: EventLogSource;
  /** the live access snapshot (the daemon's `access.snap`) */
  access: () => AccessSnapshot;
  /** the Space owner's id, for `owner` visibility */
  owner: () => string | null;
  now: () => number;
  /** most events looked at for one call, default 20 000 */
  maxScan?: number;
}

export interface EventCaller { principal: string; actingFor?: string | undefined }

export interface EventRow {
  seq: number; id: string; type: string; sv: number; at: number; traceId: string; actor: string;
  onBehalf?: string; runId?: string; cause?: string; origin?: string; depth: number;
  subject?: { type: string; id: string };
  payload: unknown;
  /** true when the payload is ciphertext this port does not open */
  sealed?: boolean;
}

export interface EventListQuery {
  /** exact names, or `noun.*` patterns, or `*` */
  types?: readonly string[];
  subject?: { type: string; id: string };
  actor?: string;
  runId?: string;
  traceId?: string;
  /** ms, inclusive */
  fromAt?: number;
  toAt?: number;
  /** a seq: events after it */
  after?: number;
  limit?: number;
}
export interface EventPage { events: EventRow[]; next: number; head: number; more: boolean }

export interface EventLogPort {
  list(caller: EventCaller, q?: EventListQuery): Promise<EventPage>;
  /** events.since: the catch-up read behind subscribe */
  since(caller: EventCaller, after: number, o?: { types?: readonly string[]; limit?: number }): Promise<EventPage>;
  /** null when the event does not exist or the reader may not see it (the two look the same) */
  get(caller: EventCaller, eventId: string): Promise<EventRow | null>;
  /** the newest seq in the log */
  head(): Promise<number>;
}

const DEFAULT_LIMIT = 100, MAX_LIMIT = 1000, DEFAULT_SCAN = 20_000;

function typeMatcher(types: readonly string[] | undefined): (t: string) => boolean {
  if (!types || types.length === 0) return () => true;
  const exact = new Set<string>(), prefix: string[] = [];
  for (const p of types) {
    if (p === "*") return () => true;
    if (p.endsWith(".*")) prefix.push(p.slice(0, -1)); else exact.add(p);
  }
  return (t) => exact.has(t) || prefix.some((p) => t.startsWith(p));
}

function decode(e: StoredEvent): { payload: unknown; sealed: boolean } {
  if (e.enc > 0) return { payload: null, sealed: true };
  try { return { payload: JSON.parse(new TextDecoder().decode(e.payload)) as unknown, sealed: false }; } catch { return { payload: null, sealed: false }; }
}

function toRow(e: StoredEvent): EventRow {
  const { payload, sealed } = decode(e);
  return {
    seq: e.seq, id: e.id, type: e.type, sv: e.sv, at: e.at, traceId: e.trace_id, actor: e.actor,
    ...(e.on_behalf !== undefined ? { onBehalf: e.on_behalf } : {}), ...(e.run_id !== undefined ? { runId: e.run_id } : {}),
    ...(e.cause !== undefined ? { cause: e.cause } : {}), ...(e.origin !== undefined ? { origin: e.origin } : {}), depth: e.depth,
    ...(e.entity !== undefined && e.entity_id !== undefined ? { subject: { type: e.entity, id: e.entity_id } } : {}),
    payload, ...(sealed ? { sealed: true } : {}),
  };
}

interface Reader { person: string; clearance: number }

/** Who the call reads as. An agent reads for the person it acts for, a service for its owner; a missing or inactive member reads nothing. */
function readerOf(snap: AccessSnapshot, c: EventCaller): Reader | null {
  const me = snap.info(c.principal);
  if (!me || me.p.status !== "active") return null;
  let person = c.principal, clearance = me.clearance;
  const other = me.p.kind === "agent" ? c.actingFor : me.p.kind === "svc" ? me.p.owner ?? undefined : c.actingFor && c.actingFor !== c.principal ? c.actingFor : undefined;
  if (other) {
    const o = snap.info(other);
    if (!o || o.p.status !== "active") return null;
    if (me.p.kind === "agent" && o.p.kind !== "person") return null;
    person = other; clearance = Math.min(clearance, o.clearance);
  } else if (me.p.kind === "agent" || me.p.kind === "svc") return null;
  return { person, clearance };
}

function visible(snap: AccessSnapshot, ownerId: string | null, r: Reader, c: EventCaller, e: StoredEvent, now: number): boolean {
  if (e.label > r.clearance) return false;
  const mine = e.actor === r.person || e.actor === c.principal || e.on_behalf === r.person;
  switch (e.vis) {
    case "space": return true;
    case "private": return mine;
    case "owner": return mine || (ownerId !== null && r.person === ownerId);
    case "participants": {
      if (mine) return true;
      if (e.entity === undefined || e.entity_id === undefined) return false;
      return authorize(snap, { principal: c.principal, actingFor: c.actingFor, action: { perm: null, level: "view" }, resource: { type: e.entity, id: e.entity_id }, now }).effect === "allow";
    }
    default: return false;
  }
}

export function createEventLogPort(deps: EventReaderDeps): EventLogPort {
  const maxScan = deps.maxScan ?? DEFAULT_SCAN;

  async function scan(c: EventCaller, a: { after: number; limit: number; types?: readonly string[] | undefined; read?: Partial<ReadQuery>; keep?: (e: StoredEvent) => boolean }): Promise<EventPage> {
    const head = await deps.source.head();
    const snap = deps.access();
    const reader = readerOf(snap, c);
    if (!reader) return { events: [], next: a.after, head, more: false };
    const owner = deps.owner(), now = deps.now(), match = typeMatcher(a.types);
    // a single exact name or `noun.*` goes to the indexed column; several are filtered here
    const single = a.types && a.types.length === 1 ? a.types[0] : undefined;
    const events: EventRow[] = [];
    let cursor = a.after, scanned = 0, more = false;
    const batch = Math.min(Math.max(a.limit * 2, 200), 1000);
    for (;;) {
      const rows = await deps.source.read({ ...a.read, after: cursor, limit: batch, ...(single !== undefined ? { type: single } : {}) });
      if (rows.length === 0) break;
      for (const e of rows) {
        if (events.length >= a.limit) { more = true; break; }
        cursor = e.seq; scanned++;
        if (!match(e.type) || (a.keep && !a.keep(e)) || !visible(snap, owner, reader, c, e, now)) continue;
        events.push(toRow(e));
      }
      if (more) break;
      if (rows.length < batch) break;
      if (scanned >= maxScan) { more = true; break; }
    }
    return { events, next: cursor, head, more };
  }

  const clampLimit = (n: number | undefined): number => Math.min(Math.max(Math.trunc(n ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

  return {
    head: async () => deps.source.head(),
    list(c, q = {}) {
      const read: Partial<ReadQuery> = {};
      if (q.subject) { read.entity = q.subject.type; read.entity_id = q.subject.id; }
      if (q.runId !== undefined) read.run_id = q.runId;
      if (q.traceId !== undefined) read.trace_id = q.traceId;
      return scan(c, {
        after: Math.max(0, q.after ?? 0), limit: clampLimit(q.limit), types: q.types, read,
        keep: (e) => (q.actor === undefined || e.actor === q.actor) && (q.fromAt === undefined || e.at >= q.fromAt) && (q.toAt === undefined || e.at <= q.toAt),
      });
    },
    since: (c, after, o = {}) => scan(c, { after: Math.max(0, after), limit: clampLimit(o.limit), types: o.types }),
    async get(c, eventId) {
      const snap = deps.access();
      const reader = readerOf(snap, c);
      if (!reader) return null;
      let found: StoredEvent | null = null;
      if (deps.source.byId) found = (await deps.source.byId(eventId)) ?? null;
      else {
        let cursor = 0, scanned = 0;
        while (!found && scanned < maxScan) {
          const rows = await deps.source.read({ after: cursor, limit: 1000 });
          if (rows.length === 0) break;
          found = rows.find((e) => e.id === eventId) ?? null;
          cursor = rows[rows.length - 1]!.seq; scanned += rows.length;
        }
      }
      return found && visible(snap, deps.owner(), reader, c, found, deps.now()) ? toRow(found) : null;
    },
  };
}

// ---------------------------------------------------------------- POST port

export interface PostResponse { status: number; headers: { get(n: string): string | null }; text(): Promise<string> }
export interface PostInit { method: "POST"; headers: Record<string, string>; body: string; redirect: "manual"; signal: AbortSignal }
export type PostFetch = (url: string, init: PostInit) => Promise<PostResponse>;

export interface WebhookPostDeps {
  /** domains (and their subdomains) a delivery may reach; "*" means any public host; empty refuses everything */
  allow: () => readonly string[];
  fetch?: PostFetch;
  /** unix ms */
  now: () => number;
  /** default 10 000 */
  timeoutMs?: number;
  /** most bytes sent, default 1 MiB */
  maxBodyBytes?: number;
  /** most characters of the answer kept for the delivery log, default 2 000 */
  maxResponseChars?: number;
}

export interface WebhookPost {
  url: string;
  /** the JSON text that is signed and sent, byte for byte */
  body: string;
  secret: string;
  eventId: string;
  eventType: string;
  traceId: string;
  /** unix ms; defaults to now. A replay passes nothing, so it carries a fresh signature. */
  at?: number;
}

export interface WebhookPostResult {
  ok: boolean;
  /** absent when nothing came back (timeout, network, refused redirect) */
  status?: number;
  durationMs: number;
  /** first part of the answer, for the delivery log */
  excerpt?: string;
  /** plain reason when not ok and no status */
  error?: string;
  signatureTimestamp: number;
}

export interface WebhookPostPort { post(a: WebhookPost): Promise<WebhookPostResult> }

export const DEFAULT_POST_TIMEOUT_MS = 10_000;
export const DEFAULT_POST_BODY_CAP = 1024 * 1024;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Hosts a webhook must never reach: loopback, private, link-local, unspecified, carrier-grade NAT, internal names and IPv6 literals (a public address is written as a name). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa") || !h.includes(".")) return true;
  if (h.startsWith("[") || h.includes(":")) return true;
  const m = IPV4.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  // a numeric host that is not dotted quad (decimal, hex, octal forms) can still resolve to a private address
  return /^[0-9x.]+$/i.test(h);
}

export function createWebhookPostPort(deps: WebhookPostDeps): WebhookPostPort {
  const doFetch: PostFetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init) as unknown as Promise<PostResponse>);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_POST_TIMEOUT_MS;
  const bodyCap = deps.maxBodyBytes ?? DEFAULT_POST_BODY_CAP;
  const excerptCap = deps.maxResponseChars ?? 2000;

  function check(url: string, traceId: string): URL {
    let u: URL;
    try { u = new URL(url); } catch { throw fail("validation.bad_input", traceId, { details: { errors: ["url: not a URL"] } }); }
    const refuse = (why: string): never => { throw fail("permission.no_grant", traceId, { message: "A webhook may not reach that address.", details: { host: u.hostname, why } }); };
    if (u.protocol !== "https:") refuse("https only");
    if (u.username || u.password) refuse("no credentials in the address");
    if (isPrivateHost(u.hostname)) refuse("private or local address");
    const allow = deps.allow();
    if (!allow.includes("*") && !hostAllowed(u.hostname, allow)) refuse("host is not on the egress allowlist");
    return u;
  }

  return {
    async post(a) {
      const u = check(a.url, a.traceId);
      const size = enc.encode(a.body).byteLength;
      if (size > bodyCap) throw fail("validation.too_large", a.traceId, { message: "That event is too large to deliver.", details: { bytes: size, cap: bodyCap } });
      const at = a.at ?? deps.now();
      const ts = Math.floor(at / 1000);
      const headers: Record<string, string> = {
        "content-type": "application/json", "user-agent": "Vyre-Webhooks/1",
        "x-vyre-signature": signWebhook(a.secret, ts, a.body), "x-vyre-trace": a.traceId, "x-vyre-event": a.eventType, "x-vyre-event-id": a.eventId,
      };
      const ctl = new AbortController();
      const t0 = deps.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error("timeout")); }, timeoutMs); });
      try {
        const run = (async (): Promise<WebhookPostResult> => {
          const r = await doFetch(u.toString(), { method: "POST", headers, body: a.body, redirect: "manual", signal: ctl.signal });
          const text = await r.text();
          const excerpt = text.length > excerptCap ? text.slice(0, excerptCap) : text;
          const durationMs = Math.max(0, deps.now() - t0);
          if (r.status >= 300 && r.status < 400) return { ok: false, status: r.status, durationMs, excerpt, error: "The endpoint answered with a redirect; redirects are not followed.", signatureTimestamp: ts };
          return { ok: r.status >= 200 && r.status < 300, status: r.status, durationMs, excerpt, signatureTimestamp: ts };
        })();
        run.catch(() => {});   // if the timeout wins, a late failure of the fetch is not an unhandled rejection
        return await Promise.race([run, timeout]);
      } catch (e) {
        const durationMs = Math.max(0, deps.now() - t0);
        const message = e instanceof Error && e.message === "timeout" ? `No answer within ${Math.round(timeoutMs / 1000)} seconds.` : "The endpoint could not be reached.";
        return { ok: false, durationMs, error: message, signatureTimestamp: ts };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------- seam

/** What the events module receives through its `setEventsHost` setter. */
export interface EventsHostSeam { events: EventLogPort; webhooks: WebhookPostPort }

export interface EventsSeamSetters { setEventsHost?: ((h: EventsHostSeam | null) => void) | undefined }

export interface EventsSeamDeps { reader: EventReaderDeps; post: WebhookPostDeps }

export function createEventsHost(deps: EventsSeamDeps): EventsHostSeam {
  return { events: createEventLogPort(deps.reader), webhooks: createWebhookPostPort(deps.post) };
}

/** Wire the seam through the setter the events module exported as `hostSeams`. Returns "absent" when the module offers none. */
export function wireEventsSeam(setters: EventsSeamSetters, deps: EventsSeamDeps): { state: "wired" | "absent"; unwire(): void } {
  if (!setters.setEventsHost) return { state: "absent", unwire() {} };
  setters.setEventsHost(createEventsHost(deps));
  return { state: "wired", unwire() { setters.setEventsHost?.(null); } };
}
