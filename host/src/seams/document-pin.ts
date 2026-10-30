// The host fetch for a public document. The socket dials the addresses that already passed the check.
// servername stays the URL hostname so TLS still matches the name. The lookup on the socket returns those addresses and does not resolve again.

import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

export interface PinnedRequest {
  url: URL;
  addresses: readonly string[];
  signal: AbortSignal;
  /** Absent means GET with no body (a document). A request step sets all three. */
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}

export interface DocumentFetch {
  fetch: typeof fetch;
  lookup: (host: string) => Promise<string[]>;
  connect: (req: PinnedRequest) => Promise<Response>;
}

function socketLookup(addresses: readonly string[]): net.LookupFunction {
  const rows: LookupAddress[] = addresses.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
  return (_hostname, options, callback) => {
    const first = rows[0];
    if (!first) {
      callback(Object.assign(new Error("No address to dial."), { code: "ENOTFOUND" }), "");
      return;
    }
    if (options.all) callback(null, rows);
    else callback(null, first.address, first.family);
  };
}

function tlsName(url: URL): string | undefined {
  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "" || net.isIP(host) !== 0) return undefined;
  return host;
}

function responseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else headers.append(key, value);
  }
  return headers;
}

function connectPinned(req: PinnedRequest): Promise<Response> {
  const addresses = req.addresses.filter((address) => net.isIP(address) !== 0);
  if (addresses.length === 0) return Promise.reject(new Error("No address to dial."));
  const dial = addresses[0]!;
  const method = req.method ?? "GET";
  const name = tlsName(req.url);
  const port = req.url.port === "" ? 443 : Number(req.url.port);
  return new Promise((resolve, reject) => {
    if (req.signal.aborted) {
      reject(req.signal.reason instanceof Error ? req.signal.reason : new Error("aborted"));
      return;
    }
    let request: ReturnType<typeof https.request>;
    try {
      request = https.request({
        host: dial,
        family: net.isIPv6(dial) ? 6 : 4,
        port,
        method,
        path: `${req.url.pathname || "/"}${req.url.search}`,
        headers: { accept: "*/*", ...(req.headers ?? {}), host: req.url.host, ...(req.body !== undefined ? { "content-length": String(Buffer.byteLength(req.body)) } : {}) },
        lookup: socketLookup(addresses),
        autoSelectFamily: false,
        agent: false,
        signal: req.signal,
        ...(name ? { servername: name } : {}),
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.resume();
          reject(new Error("The document did not load."));
          return;
        }
        // A redirect is returned as its status. This function does not open the next address.
        const redirect = status >= 300 && status < 400;
        if (redirect) res.resume();
        const body = redirect ? null : Readable.toWeb(res);
        resolve(new Response(body, { status, headers: responseHeaders(res) }));
      });
    } catch (err) {
      reject(err);
      return;
    }
    request.on("error", reject);
    request.end(req.body);
  });
}

export function documentPin(): DocumentFetch {
  return {
    fetch: globalThis.fetch,
    lookup: async (host) => {
      const rows = await dns.lookup(host, { all: true, verbatim: true });
      return rows.map((row) => row.address);
    },
    connect: connectPinned,
  };
}
