// One fetcher for an https URL a person or a document names.
// Scheme, credentials, and host are checked before a request, and again on every redirect, including the addresses lookup returns.
// The body is returned as text. It is not parsed, evaluated, or scanned.

import { isIP } from "node:net";
import { normalizedHost, refusesAddress } from "../../lib/address-guard.ts";

export type Lookup = (host: string) => Promise<string[]>;

export interface ConnectRequest {
  url: URL;
  addresses: readonly string[];
  signal: AbortSignal;
  /** Absent means GET with no body: the document fetcher never sets these. */
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}
export type Connect = (req: ConnectRequest) => Promise<Response>;

export interface FetchDeps {
  fetch: typeof fetch;
  lookup: Lookup;
  connect?: Connect;
}

export type FetchResult =
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; reason: string };

const CAP = 1_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const BAD_URL = "That address cannot be opened.";
const NOT_HTTPS = "Only an https address can be opened.";
const HAS_CREDENTIALS = "An address with a username or password is not opened.";
const NOT_PUBLIC = "That address is not a public host.";
const NO_RESOLVE = "The host did not resolve.";
const NO_LOCATION = "The document redirected without a new address.";
const TOO_MANY = "The document redirected too many times.";
const TOO_LARGE = "The document is too large.";
const NO_LOAD = "The document did not load.";

function isAddress(host: string): boolean {
  const family = isIP(host);
  return family === 4 || family === 6;
}

function targetOf(raw: string): { ok: true; url: URL; host: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: BAD_URL };
  }
  if (url.protocol !== "https:") return { ok: false, reason: NOT_HTTPS };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: HAS_CREDENTIALS };
  const host = normalizedHost(url.hostname);
  if (host === "") return { ok: false, reason: BAD_URL };
  if (host === "localhost" || (isAddress(host) && refusesAddress(host))) return { ok: false, reason: NOT_PUBLIC };
  return { ok: true, url, host };
}

async function vet(raw: string, lookup: Lookup): Promise<{ ok: true; url: URL; addresses: readonly string[] } | { ok: false; reason: string }> {
  const target = targetOf(raw);
  if (!target.ok) return target;
  if (isAddress(target.host)) return { ok: true, url: target.url, addresses: [target.host] };
  let ips: string[];
  try {
    ips = await lookup(target.host);
  } catch {
    return { ok: false, reason: NO_RESOLVE };
  }
  if (!Array.isArray(ips) || ips.length === 0) return { ok: false, reason: NO_RESOLVE };
  if (ips.some((ip) => typeof ip !== "string" || refusesAddress(ip))) return { ok: false, reason: NOT_PUBLIC };
  return { ok: true, url: target.url, addresses: ips };
}

async function readCapped(response: Response, cap = CAP): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return { ok: false, reason: TOO_LARGE };
  try {
    if (!response.body) {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > cap) return { ok: false, reason: TOO_LARGE };
      return { ok: true, text };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: TOO_LARGE };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(merged) };
  } catch {
    return { ok: false, reason: NO_LOAD };
  }
}

function nextLocation(location: string | null, base: URL): { ok: true; href: string } | { ok: false; reason: string } {
  if (location === null || location.trim() === "") return { ok: false, reason: NO_LOCATION };
  try {
    return { ok: true, href: new URL(location.trim(), base).href };
  } catch {
    return { ok: false, reason: NO_LOCATION };
  }
}

type Opened = { ok: true; response: Response; finalUrl: string } | { ok: false; reason: string };

/** Open one public https address: every hop vetted (scheme, credentials, host, resolved addresses), redirects followed by hand, at most three, and a 2xx at the end. */
async function openPublic(url: string, deps: FetchDeps): Promise<Opened> {
  let current = url;
  for (let followed = 0; followed <= MAX_REDIRECTS; followed++) {
    const vetted = await vet(current, deps.lookup);
    if (!vetted.ok) return vetted;
    let response: Response;
    try {
      if (deps.connect) {
        response = await deps.connect({
          url: vetted.url,
          addresses: vetted.addresses,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } else {
        response = await deps.fetch(vetted.url.href, {
          redirect: "manual",
          credentials: "omit",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      }
    } catch {
      return { ok: false, reason: NO_LOAD };
    }
    if (response.status >= 300 && response.status < 400) {
      const next = nextLocation(response.headers.get("location"), vetted.url);
      if (!next.ok) return next;
      if (followed === MAX_REDIRECTS) return { ok: false, reason: TOO_MANY };
      current = next.href;
      continue;
    }
    let finalUrl = vetted.url.href;
    if (response.url) {
      let seen: URL;
      try {
        seen = new URL(response.url);
      } catch {
        return { ok: false, reason: NO_LOAD };
      }
      if (seen.href !== vetted.url.href) {
        const again = await vet(seen.href, deps.lookup);
        if (!again.ok) return again;
        finalUrl = again.url.href;
      }
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: NO_LOAD };
    return { ok: true, response, finalUrl };
  }
  return { ok: false, reason: TOO_MANY };
}

/** Fetch one public https document. Redirects are followed by hand, at most three. Passing connect binds the request to the vetted addresses. Omitting connect still checks DNS first but does not bind the socket. */
export async function fetchPublicDocument(url: string, deps: FetchDeps): Promise<FetchResult> {
  const opened = await openPublic(url, deps);
  if (!opened.ok) return opened;
  const body = await readCapped(opened.response);
  if (!body.ok) return body;
  return { ok: true, text: body.text, finalUrl: opened.finalUrl };
}

// ---- a picture for a link card ----

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type ImageResult = { ok: true; bytes: Uint8Array; contentType: ImageType } | { ok: false; reason: string };
/** A link card's picture is small: anything larger is not shown. */
export const IMAGE_CAP = 1_000_000;
const NOT_IMAGE = "That is not a picture Vyre shows.";

/** What the bytes are, from their first bytes; the server's content type is not trusted. SVG is never a picture here: it can carry script. */
export function sniffImage(b: Uint8Array): ImageType | null {
  const at = (i: number, ...xs: number[]): boolean => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

async function readBytes(response: Response, cap: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return { ok: false, reason: TOO_LARGE };
  try {
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > cap ? { ok: false, reason: TOO_LARGE } : { ok: true, bytes };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: TOO_LARGE };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: NO_LOAD };
  }
}

/**
 * Fetch a link card's picture on the server, through the same guard as a document, so a person's browser never asks a third-party site for it (which would tell that site who is
 * looking). A PNG, JPEG, GIF or WebP up to the cap, by its declared type and its first bytes both; anything else is refused.
 */
export async function fetchPublicImage(url: string, deps: FetchDeps, cap = IMAGE_CAP): Promise<ImageResult> {
  const opened = await openPublic(url, deps);
  if (!opened.ok) return opened;
  const declared = (opened.response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(declared)) {
    await opened.response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: NOT_IMAGE };
  }
  const body = await readBytes(opened.response, cap);
  if (!body.ok) return body;
  const type = sniffImage(body.bytes);
  if (!type) return { ok: false, reason: NOT_IMAGE };
  return { ok: true, bytes: body.bytes, contentType: type };
}

// ---- a request a step makes (HTTP request step) ----

export interface PublicRequest {
  method: string;
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs?: number;
  capBytes?: number;
}
export type RequestResult =
  | { ok: true; status: number; headers: Record<string, string>; text: string; finalUrl: string }
  | { ok: false; reason: string };

const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_CAP = 1_000_000;
/** Headers that must not follow a redirect to another origin. */
const SENSITIVE = /^(authorization|cookie|proxy-authorization|x-api-key|x-auth-token)$/i;

/**
 * One request to a public https address. Same guard as fetchPublicDocument: scheme, credentials and host are checked before the request and on every redirect, and the socket is bound to the
 * addresses that passed. A GET or HEAD follows at most three redirects, each vetted; any other method returns the redirect response as it is (an unsafe method is never replayed on a new address).
 * A header named as sensitive is dropped when a redirect leaves the origin. Any HTTP status is a result, not a failure: the caller reads the status.
 */
export async function requestPublic(req: PublicRequest, deps: FetchDeps): Promise<RequestResult> {
  const method = req.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD";
  const cap = req.capBytes ?? REQUEST_CAP;
  const deadline = AbortSignal.timeout(req.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let current = req.url;
  let headers: Record<string, string> = { ...(req.headers ?? {}) };
  let origin = "";
  for (let followed = 0; followed <= MAX_REDIRECTS; followed++) {
    const vetted = await vet(current, deps.lookup);
    if (!vetted.ok) return vetted;
    if (origin !== "" && vetted.url.origin !== origin) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SENSITIVE.test(k)));
    origin = vetted.url.origin;
    const body = req.body !== undefined && method !== "GET" && method !== "HEAD" ? req.body : undefined;
    let response: Response;
    try {
      if (deps.connect) {
        response = await deps.connect({ url: vetted.url, addresses: vetted.addresses, signal: deadline, method, headers, ...(body !== undefined ? { body } : {}) });
      } else {
        response = await deps.fetch(vetted.url.href, { method, headers, ...(body !== undefined ? { body } : {}), redirect: "manual", credentials: "omit", signal: deadline });
      }
    } catch {
      return { ok: false, reason: NO_LOAD };
    }
    if (safe && response.status >= 300 && response.status < 400 && response.headers.get("location") !== null) {
      const next = nextLocation(response.headers.get("location"), vetted.url);
      if (!next.ok) return next;
      if (followed === MAX_REDIRECTS) return { ok: false, reason: TOO_MANY };
      current = next.href;
      continue;
    }
    const text = method === "HEAD" ? { ok: true as const, text: "" } : await readCapped(response, cap);
    if (!text.ok) return text;
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
    return { ok: true, status: response.status, headers: out, text: text.text, finalUrl: vetted.url.href };
  }
  return { ok: false, reason: TOO_MANY };
}
