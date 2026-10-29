// The one network guard for an address a person typed (a local model, a custom OpenAI-compatible endpoint): never link-local, and on a node that is not the caller's own computer never loopback or private
// either; the socket then connects to the address that was checked, so a name that answers differently the second time (DNS rebinding) changes nothing. Redirects are not followed.
// Used by the provider probe (host/src/seams/vault.ts) and by the API drivers' guarded fetch (agent/src/drivers/open), which streams.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** An address the probe may not reach (SSRF): link-local always (cloud metadata is 169.254.169.254); loopback, private, unique-local and unspecified unless this is the caller's own computer. */
export function blockedAddress(ip: string, own: boolean): string | null {
  const v4 = (a: number, b: number): string | null => {
    if (a === 169 && b === 254) return "a link-local address";
    if (own) return null;
    if (a === 127) return "a loopback address";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "a private network address";
    if (a === 0) return "an unspecified address";
    if (a === 100 && b >= 64 && b <= 127) return "a shared network address";
    return null;
  };
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return v4(a!, b!); }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    const mapped = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(low);
    if (mapped) return v4(Number(mapped[1]), Number(mapped[2]));
    const first = parseInt(low.split(":")[0] || "0", 16);
    if ((first & 0xffc0) === 0xfe80) return "a link-local address";
    if (own) return null;
    if (low === "::1") return "a loopback address";
    if (low === "::") return "an unspecified address";
    if ((first & 0xfe00) === 0xfc00) return "a private network address";
    return null;
  }
  return "not an address";
}

/** Where a local model may be reached from this node: http or https, and every address its name resolves to allowed (a name that resolves to a refused address is refused whole). `ips` are the addresses to connect to. */
export async function checkModelAddress(address: string, own: boolean, resolve: (host: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((r) => r.address)): Promise<{ why: string } | { url: URL; ips: string[] }> {
  let u: URL;
  try { u = new URL(address); } catch { return { why: "That is not an address." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { why: "A local model is reached over http or https." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let ips: string[];
  try { ips = net.isIP(host) ? [host] : await resolve(host); } catch { return { why: "That address could not be found." }; }
  if (!ips.length) return { why: "That address could not be found." };
  for (const ip of ips) {
    const why = blockedAddress(ip, own);
    if (why) return { why: own ? "That address is not allowed." : `A local model on this server cannot be ${why}.` };
  }
  return { url: u, ips };
}

/** Null when the address may be probed from this node, else why not. */
export async function refuseModelAddress(address: string, own: boolean, resolve?: (host: string) => Promise<string[]>): Promise<string | null> {
  const r = await checkModelAddress(address, own, resolve);
  return "why" in r ? r.why : null;
}

export interface PinnedResponse { status: number; ok: boolean; json(): Promise<unknown> }
export type PinnedRequest = (url: URL, o: { headers: Record<string, string>; ips: readonly string[]; timeoutMs?: number }) => Promise<PinnedResponse>;

/**
 * GET `url` connecting to one of `ips` (the addresses that were checked), whatever the name would resolve to now: the Host header and the TLS server name stay the name\'s, the socket goes to the checked
 * address. A redirect is not followed (it answers as a non-ok status). This is what closes the gap between checking an address and connecting to it (DNS rebinding).
 */
export const pinnedGet: PinnedRequest = (url, o) => new Promise((resolve, reject) => {
  const secure = url.protocol === "https:";
  const lib = secure ? https : http;
  const ips = [...o.ips];
  const req = lib.request({
    host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || (secure ? 443 : 80), path: `${url.pathname}${url.search}`, method: "GET",
    headers: { ...o.headers, host: url.host }, ...(secure ? { servername: net.isIP(url.hostname) ? undefined : url.hostname } : {}),
    lookup: (_host: string, opts: { all?: boolean }, cb: (err: Error | null, a: unknown, f?: number) => void) => {
      const pick = ips.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
      if (opts && opts.all) cb(null, pick); else cb(null, pick[0]!.address, pick[0]!.family);
    },
    timeout: o.timeoutMs ?? 10_000,
  } as http.RequestOptions, (res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (c: Buffer) => { size += c.length; if (size > 1_000_000) { req.destroy(new Error("too large")); return; } chunks.push(c); });
    res.on("end", () => {
      const status = res.statusCode ?? 0;
      resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    });
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", reject);
  req.end();
});


/** The shape the API drivers' Fetch port has (agent/src/drivers/api/types.ts), written structurally so lib imports nothing. */
export interface GuardedInit { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }
export interface GuardedResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export class AddressRefused extends Error {
  constructor(message: string) { super(message); this.name = "AddressRefused"; }
}

/**
 * A fetch for the drivers that talk to an address a person gave: every call checks the address (checkModelAddress) and then connects to one of the checked ips. The response body streams (server-sent
 * events pass through). Aborting the signal destroys the socket. `own` is true when the caller's own computer is the one asked (loopback and private allowed); link-local is never allowed.
 */
export function createGuardedFetch(o: { own: boolean; resolve?: (host: string) => Promise<string[]> }): (url: string, init: GuardedInit) => Promise<GuardedResponse> {
  return async (address, init) => {
    const checked = await checkModelAddress(address, o.own, o.resolve);
    if ("why" in checked) throw new AddressRefused(checked.why);
    const url = checked.url;
    const secure = url.protocol === "https:";
    const ips = checked.ips;
    return new Promise<GuardedResponse>((resolve, reject) => {
      const req = (secure ? https : http).request({
        host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || (secure ? 443 : 80), path: `${url.pathname}${url.search}`, method: init.method,
        headers: { ...init.headers, host: url.host, ...(init.body !== undefined ? { "content-length": String(Buffer.byteLength(init.body)) } : {}) },
        ...(secure ? { servername: net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname } : {}),
        lookup: (_host: string, opts: { all?: boolean }, cb: (err: Error | null, a: unknown, f?: number) => void) => {
          const pick = ips.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
          if (opts && opts.all) cb(null, pick); else cb(null, pick[0]!.address, pick[0]!.family);
        },
      } as http.RequestOptions, (res) => {
        const status = res.statusCode ?? 0;
        let used = false;
        const drain = async (): Promise<string> => { const parts: Buffer[] = []; for await (const c of res) parts.push(c as Buffer); return Buffer.concat(parts).toString("utf8"); };
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (n) => { const v = res.headers[n.toLowerCase()]; return Array.isArray(v) ? v.join(", ") : v ?? null; } },
          body: { [Symbol.asyncIterator]: () => { used = true; return (res as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator](); } },
          text: async () => (used ? "" : drain()),
          json: async () => JSON.parse(await drain()) as unknown,
        });
      });
      const abort = (): void => req.destroy(new Error("aborted"));
      if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      req.on("error", reject);
      req.on("close", () => init.signal.removeEventListener("abort", abort));
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
  };
}
