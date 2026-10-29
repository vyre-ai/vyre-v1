// One fetcher for an https URL a person or a document names.
// Scheme, credentials, and host are checked before a request, and again on every redirect, including the addresses lookup returns.
// The body is returned as text. It is not parsed, evaluated, or scanned.

import { isIP } from "node:net";

export type Lookup = (host: string) => Promise<string[]>;

export interface FetchDeps {
  fetch: typeof fetch;
  lookup: Lookup;
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

function normalizedHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.+$/, "");
  const zone = host.indexOf("%");
  if (zone !== -1) host = host.slice(0, zone);
  return host;
}

function parseV4(ip: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return null;
  const parts = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function blockedV4(first: number, second: number): boolean {
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  try {
    text = new URL(`https://[${text}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const side = (part: string): number[] | null => {
    if (part === "") return [];
    const labels = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? "";
      if (label.includes(".")) {
        if (i !== labels.length - 1) return null;
        const v4 = parseV4(label);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(label)) return null;
      out.push(parseInt(label, 16));
    }
    return out;
  };
  if (halves.length === 1) {
    const full = side(text);
    return full && full.length === 8 ? full : null;
  }
  const left = side(halves[0] ?? "");
  const right = side(halves[1] ?? "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function blockedV6(words: number[]): boolean {
  const w0 = words[0] ?? 0;
  const w1 = words[1] ?? 0;
  const w2 = words[2] ?? 0;
  const w3 = words[3] ?? 0;
  const w4 = words[4] ?? 0;
  const w5 = words[5] ?? 0;
  const w6 = words[6] ?? 0;
  const w7 = words[7] ?? 0;
  if ((w0 & 0xfe00) === 0xfc00) return true;
  if ((w0 & 0xffc0) === 0xfe80) return true;
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0 && w7 === 1) return true;
  const mapped = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && (w5 === 0 || w5 === 0xffff);
  const nat64 = w0 === 0x0064 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0;
  const sixToFour = w0 === 0x2002;
  if ((mapped || nat64) && blockedV4(w6 >> 8, w6 & 0xff)) return true;
  if (sixToFour && blockedV4(w1 >> 8, w1 & 0xff)) return true;
  return false;
}

function refusesAddress(raw: string): boolean {
  const host = normalizedHost(raw);
  if (isIP(host) === 4) {
    const parts = parseV4(host);
    if (!parts) return true;
    return blockedV4(parts[0], parts[1]);
  }
  if (isIP(host) !== 6) return true;
  const words = expandV6(host);
  if (!words) return true;
  return blockedV6(words);
}

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

async function vet(raw: string, lookup: Lookup): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  const target = targetOf(raw);
  if (!target.ok) return target;
  if (isAddress(target.host)) return { ok: true, url: target.url };
  let ips: string[];
  try {
    ips = await lookup(target.host);
  } catch {
    return { ok: false, reason: NO_RESOLVE };
  }
  if (!Array.isArray(ips) || ips.length === 0) return { ok: false, reason: NO_RESOLVE };
  if (ips.some((ip) => typeof ip !== "string" || refusesAddress(ip))) return { ok: false, reason: NOT_PUBLIC };
  return { ok: true, url: target.url };
}

async function readCapped(response: Response): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > CAP) return { ok: false, reason: TOO_LARGE };
  try {
    if (!response.body) {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > CAP) return { ok: false, reason: TOO_LARGE };
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
      if (total > CAP) {
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

/** Fetch one public https document. Redirects are followed by hand, at most three. */
export async function fetchPublicDocument(url: string, deps: FetchDeps): Promise<FetchResult> {
  let current = url;
  for (let followed = 0; followed <= MAX_REDIRECTS; followed++) {
    const vetted = await vet(current, deps.lookup);
    if (!vetted.ok) return vetted;
    let response: Response;
    try {
      response = await deps.fetch(vetted.url.href, {
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
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
    const body = await readCapped(response);
    if (!body.ok) return body;
    return { ok: true, text: body.text, finalUrl };
  }
  return { ok: false, reason: TOO_MANY };
}
