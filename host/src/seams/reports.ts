// The host half of Report a problem (spec 4.18, ARCH 7.14): the bundle sources and the reports.vyre.run client the reports-client module asks for through its hostSeams.configureReports. The module builds
// and scrubs the bundle; this supplies what only the host has (the person's last actions from the log, the versions) and carries the redacted bundle to the service, signed with this Space's own Ed25519 key.
//   key        derived from the Space's seal key, so it survives restarts and never leaves the data directory; the service is told its public half when the Space registers (POST /v1/spaces).
//   register   needs the address people reach the Space at: the service calls back at <address>/hooks/reports when an issue closes. A Space with no address keeps its reports (they are stored, a Review
//              task is open for the admins) and says the service could not be reached.
//   screenshot not sent: the bundle names a Files id, and pixels cannot be scrubbed from here.
//   replay     the replay sandbox is not part of this seam (reports.submit does not use it).
import type { FetchLike } from "../ctx/http.ts";

const enc = new TextEncoder();
const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha256hex = async (text: string): Promise<string> => hex(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text) as BufferSource));

// What a Space signs for the service. A line per part, a version tag first, so a signature for one purpose is never valid for another (apps/reports/src/crypto.ts).
export const reportMessage = (ts: string, bodyHash: string): string => `vyre-report-v1\nPOST\n/v1/reports\n${ts}\n${bodyHash}`;
export const registerMessage = (ts: string, bodyHash: string): string => `vyre-space-register-v1\n${ts}\n${bodyHash}`;

export const REPORTS_URL = "https://reports.vyre.run";
/** Places whose view holds sealed values: a report from one has its screenshot dropped whatever the other rules say. */
export const SEALED_PLACES: ReadonlySet<string> = new Set(["vault", "settings"]);
const SEALED_MARK = "[sealed view]";

/** An Ed25519 key from a 32-byte seed: PKCS8 is a fixed prefix then the seed. */
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export async function deriveReportsKey(sealKey: Uint8Array): Promise<{ key: CryptoKey; publicKey: Uint8Array }> {
  const mac = await globalThis.crypto.subtle.importKey("raw", sealKey as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const seed = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", mac, enc.encode("vyre reports ed25519 v1") as BufferSource));
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX); pkcs8.set(seed, PKCS8_PREFIX.length);
  const extractable = await globalThis.crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, "Ed25519", true, ["sign"]);
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", extractable);
  if (typeof jwk.x !== "string") throw new Error("the reports key has no public half");
  return { key: await globalThis.crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, "Ed25519", false, ["sign"]), publicKey: Uint8Array.from(Buffer.from(jwk.x, "base64url")) };
}

/** The part of logs.db this reads: the person's last actions and errors. */
export interface LogReader { all(sql: string, ...args: unknown[]): Array<Record<string, unknown>> }

export interface ReportsHostDeps {
  space: string;
  now: () => number;
  fetch: FetchLike;
  /** logs.db, read only */
  logs: LogReader;
  /** The seal key's bytes: the Ed25519 key is derived from it. */
  sealKey: Uint8Array;
  /** Where people reach this Space; null when only the local address exists. */
  address: string | null;
  versions: { server: string; app?: string; device: string };
  /** Default https://reports.vyre.run. */
  baseUrl?: string;
}

const TRACE = /^[0-9a-f]{32}$/;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type Ctx = { principal: { id: string }; actingFor?: string | undefined };
interface Bundle { context: { place: string; itemId?: string; hash?: string }; traceIds: string[]; events: unknown[]; versions: { app: string; server: string; device: string }; errors?: unknown[]; note?: string; screenshotFileId?: string; clientLogFileId?: string }

export function createReportsHost(d: ReportsHostDeps) {
  const base = (d.baseUrl ?? REPORTS_URL).replace(/\/+$/, "");
  const person = (c: Ctx): string => c.actingFor ?? c.principal.id;
  const key = deriveReportsKey(d.sealKey);
  let registered = false;
  let used = false;   // the key registers at the first report, so before one there is nothing to be unhealthy about
  const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };

  const sources = {
    /** The trace ids of the person's last 20 actions (newest first), their last events, the errors of the last hour and the versions. Ids and names only: a log row holds no content. */
    async recent(ctx: Ctx) {
      const who = person(ctx);
      const traces = d.logs.all("SELECT trace_id, MAX(at) AS at FROM logs WHERE (actor = ? OR on_behalf = ?) AND trace_id IS NOT NULL GROUP BY trace_id ORDER BY at DESC LIMIT 20", who, who)
        .map((r) => s(r["trace_id"])).filter((t) => TRACE.test(t));
      const events = d.logs.all("SELECT cap, msg, at, trace_id FROM logs WHERE (actor = ? OR on_behalf = ?) ORDER BY id DESC LIMIT 20", who, who)
        .map((r) => ({ type: (s(r["cap"]) || s(r["msg"]) || "event").slice(0, 100), at: n(r["at"]), ...(TRACE.test(s(r["trace_id"])) ? { traceId: s(r["trace_id"]) } : {}) }));
      const errors = d.logs.all("SELECT result, msg, at, trace_id FROM logs WHERE (actor = ? OR on_behalf = ?) AND level >= 40 AND at > ? ORDER BY id DESC LIMIT 50", who, who, d.now() - 3_600_000)
        .map((r) => ({ code: (s(r["result"]) || "error").slice(0, 100), message: s(r["msg"]).slice(0, 1000), at: n(r["at"]), ...(TRACE.test(s(r["trace_id"])) ? { traceId: s(r["trace_id"]) } : {}) }));
      return { traceIds: traces, events, versions: { app: d.versions.app ?? d.versions.server, server: d.versions.server, device: d.versions.device }, errors };
    },
    /** A view that holds sealed values (the Vault, Settings) is reported without its screenshot: the marker makes the scrubber treat the view as sealed and matches nothing in the text. */
    async sensitiveValues(_ctx: Ctx, context: { place: string }): Promise<string[]> { return SEALED_PLACES.has(context.place) ? [SEALED_MARK] : []; },
  };

  async function signedFetch(path: string, body: string, message: (ts: string, hash: string) => string, headers: Record<string, string>) {
    const ts = String(d.now());
    const k = await key;
    const sig = b64url(new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", k.key, enc.encode(message(ts, await sha256hex(body))) as BufferSource)));
    return await d.fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers, "x-vyre-ts": ts, "x-vyre-sig": sig }, body });
  }

  /** Tell the service this Space's public key and where it can be reached. Idempotent: the same key registers again as a no-op. */
  async function register(): Promise<void> {
    if (registered) return;
    if (!d.address) return fail("unavailable", "this Space has no public address for the report service to call back");
    const k = await key;
    const body = JSON.stringify({ spaceId: d.space, publicKey: b64url(k.publicKey), webhook: `${d.address.replace(/\/+$/, "")}/hooks/reports` });
    const res = await signedFetch("/v1/spaces", body, registerMessage, {});
    await res.text();
    if (res.status === 429) return fail("rate_limit", "the service asked to slow down");
    if (res.status !== 200 && res.status !== 201) return fail("unavailable", `the service answered ${res.status} to the registration`);
    registered = true;
  }

  const service = {
    async post(req: { reportId: string; space: string; reporter: string; title: string; bundle: Bundle }): Promise<{ issueNumber?: number; stored: boolean }> {
      used = true;
      await register();
      const { screenshotFileId: _shot, clientLogFileId: _log, ...bundle } = req.bundle;
      const res = await signedFetch("/v1/reports", JSON.stringify({ reportId: req.reportId, bundle }), reportMessage, { "x-vyre-space": d.space });
      const text = await res.text();
      if (res.status === 429) return fail("rate_limit", "the service asked to slow down");
      if (res.status === 401) registered = false;   // the service forgot this key: register again on the next post
      if (res.status < 200 || res.status > 299) return fail("unavailable", `the service answered ${res.status}`);
      let data: { issueNumber?: unknown; stored?: unknown } = {};
      try { data = (JSON.parse(text) as { data?: typeof data }).data ?? {}; } catch { /* an answer with no body is a stored report */ }
      return { ...(typeof data.issueNumber === "number" ? { issueNumber: data.issueNumber } : {}), stored: data.stored !== false };
    },
    async ping(): Promise<{ keyRegistered: boolean }> {
      if (!used) return { keyRegistered: true };
      const res = await d.fetch(`${base}/healthz`, { method: "GET" });
      await res.text();
      if (res.status !== 200) return fail("unavailable", `the service answered ${res.status}`);
      return { keyRegistered: registered };
    },
  };

  return { sources, service };
}

export type ReportsHost = ReturnType<typeof createReportsHost>;
