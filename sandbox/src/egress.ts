// The egress allow-list proxy (S8, spec 4.17): the only way out of a sandbox. A process in the sandbox has no route to anything but this proxy (the container's network is internal, Seatbelt allows
// only this port on loopback, bwrap points the process here), and the proxy lets a connection through only to a host the person's sandbox is allowed to name.
//
//   CONNECT host:443   tunnelled, for HTTPS. The proxy sees the name and port, never the bytes.
//   GET http://host/   forwarded, for plain HTTP, with hop-by-hop headers removed.
//
// The name is matched against the allow-list as written (policy.hostAllowed), then resolved here, once; every address must be public (no loopback, private, link-local or metadata address, so a
// name that points inside is refused, and a DNS answer that changes between check and connect cannot matter), and the connection goes to the address that was checked. IP literals are refused:
// the list is by name. Ports are 443 and 80 unless the caller says otherwise. Events carry the host and port and the verdict, never a path, a header or a byte.
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { hostAllowed, isPrivateAddress } from "./policy.ts";

export type Verdict = "allow" | "deny";
export interface EgressEvent { verdict: Verdict; host: string; port: number; reason: "ok" | "not_listed" | "bad_port" | "private_address" | "no_address" | "bad_request" | "busy" | "unreachable" }

export interface EgressOptions {
  /** Host patterns, or a function so the list can change while the proxy runs (a policy change takes effect on the next connection). */
  allow: readonly string[] | (() => readonly string[]);
  ports?: readonly number[];
  /** Resolve a name to addresses. Default: the system resolver. */
  lookup?: (host: string) => Promise<readonly string[]>;
  /** Open the connection to the address that passed. Default: net.connect. */
  connect?: (host: string, port: number, ip: string) => Promise<net.Socket>;
  onEvent?: (e: EgressEvent) => void;
  /** Connections at once. Default 256. */
  maxConnections?: number;
  /** No bytes in either direction for this long closes the tunnel. Default 120 s. */
  idleMs?: number;
}

export interface EgressProxy {
  /** Start listening. `127.0.0.1` and port 0 by default. */
  listen(port?: number, host?: string): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
  stats(): { allowed: number; denied: number; open: number };
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
const DENIED_BODY = "Blocked by this Space's network policy.\n";

async function systemLookup(host: string): Promise<readonly string[]> {
  const r = await dns.lookup(host, { all: true, verbatim: true });
  return r.map((x) => x.address);
}
const defaultConnect = (_h: string, port: number, ip: string): Promise<net.Socket> =>
  new Promise((resolve, reject) => { const s = net.connect({ host: ip, port }); s.once("connect", () => { s.removeAllListeners("error"); resolve(s); }); s.once("error", reject); });

export function createEgressProxy(o: EgressOptions): EgressProxy {
  const ports = new Set(o.ports ?? [443, 80]);
  const lookup = o.lookup ?? systemLookup;
  const connect = o.connect ?? defaultConnect;
  const maxConnections = o.maxConnections ?? 256;
  const idleMs = o.idleMs ?? 120_000;
  const allowList = (): readonly string[] => (typeof o.allow === "function" ? o.allow() : o.allow);
  const sockets = new Set<Duplex>();
  let allowed = 0;
  let denied = 0;
  let open = 0;

  const note = (e: EgressEvent): void => { if (e.verdict === "allow") allowed++; else denied++; try { o.onEvent?.(e); } catch { /* an observer must not break the proxy */ } };

  /** Check a target and resolve it. Returns the address to connect to, or the reason it was refused. */
  async function admit(host: string, port: number): Promise<{ ok: true; ip: string } | { ok: false; reason: EgressEvent["reason"] }> {
    if (!ports.has(port)) return { ok: false, reason: "bad_port" };
    if (!hostAllowed(host, allowList())) return { ok: false, reason: "not_listed" };
    let ips: readonly string[];
    try { ips = await lookup(host); } catch { return { ok: false, reason: "no_address" }; }
    if (ips.length === 0) return { ok: false, reason: "no_address" };
    // Every address must be public: a name that also points inside is refused whole, so a resolver cannot pick the private one at connect time.
    if (ips.some(isPrivateAddress)) return { ok: false, reason: "private_address" };
    return { ok: true, ip: ips[0] as string };
  }

  /** Remember a socket so close() can end it. `counted` ones are the connections a client holds open (a tunnel, a request in flight), which maxConnections limits. */
  function track(s: Duplex, counted: boolean): void {
    sockets.add(s);
    if (counted) open++;
    s.once("close", () => { sockets.delete(s); if (counted) open--; });
  }

  /** "host:port" of a CONNECT line. The host is a name (no brackets, no address, no spaces). */
  function parseAuthority(t: string): { host: string; port: number } | null {
    const m = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(t);
    if (!m) return null;
    const port = Number(m[2]);
    return port >= 1 && port <= 65535 ? { host: m[1] as string, port } : null;
  }

  const refuse = (socket: Duplex, status: number, text: string): void => {
    try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${DENIED_BODY.length}\r\n\r\n${DENIED_BODY}`); } catch { socket.destroy(); }
  };

  const server = http.createServer(async (req, res) => {
    // Plain HTTP through a proxy arrives in absolute form: GET http://host/path.
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { note({ verdict: "deny", host: "", port: 0, reason: "bad_request" }); res.writeHead(400, { "content-type": "text/plain", connection: "close" }).end("This is a proxy: send absolute URLs.\n"); return; }
    if (url.protocol !== "http:") { note({ verdict: "deny", host: url.hostname, port: Number(url.port || 0), reason: "bad_request" }); res.writeHead(400, { connection: "close" }).end(); return; }
    const host = url.hostname;
    const port = Number(url.port || 80);
    if (open >= maxConnections) { note({ verdict: "deny", host, port, reason: "busy" }); res.writeHead(503, { connection: "close" }).end("Busy.\n"); return; }
    const v = await admit(host, port);
    if (!v.ok) { note({ verdict: "deny", host, port, reason: v.reason }); res.writeHead(403, { "content-type": "text/plain", connection: "close" }).end(DENIED_BODY); return; }
    let upstream: net.Socket;
    try { upstream = await connect(host, port, v.ip); } catch { note({ verdict: "deny", host, port, reason: "unreachable" }); res.writeHead(502, { connection: "close" }).end("Could not reach that host.\n"); return; }
    note({ verdict: "allow", host, port, reason: "ok" });
    track(upstream, false);
    open++;
    res.once("close", () => { open--; });
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, val] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase()) && val !== undefined) headers[k] = val;
    headers["host"] = url.host;
    headers["connection"] = "close";
    const out = http.request({ createConnection: () => upstream, method: req.method ?? "GET", path: `${url.pathname}${url.search}`, headers }, (r) => {
      const rh: http.OutgoingHttpHeaders = {};
      for (const [k, val] of Object.entries(r.headers)) if (!HOP_BY_HOP.has(k.toLowerCase()) && val !== undefined) rh[k] = val;
      res.writeHead(r.statusCode ?? 502, rh);
      r.pipe(res);
    });
    out.on("error", () => { if (!res.headersSent) res.writeHead(502, { connection: "close" }); res.end(); });
    req.pipe(out);
  });
  server.keepAliveTimeout = 1;
  server.headersTimeout = 15_000;

  server.on("connect", async (req, clientSocket: Duplex, head: Buffer) => {
    track(clientSocket, true);
    clientSocket.on("error", () => clientSocket.destroy());
    const target = parseAuthority(req.url ?? "");
    if (!target) { note({ verdict: "deny", host: "", port: 0, reason: "bad_request" }); refuse(clientSocket, 400, "Bad Request"); return; }
    if (open > maxConnections) { note({ verdict: "deny", ...target, reason: "busy" }); refuse(clientSocket, 503, "Service Unavailable"); return; }   // this tunnel is already counted
    const v = await admit(target.host, target.port);
    if (!v.ok) { note({ verdict: "deny", ...target, reason: v.reason }); refuse(clientSocket, 403, "Forbidden"); return; }
    let upstream: net.Socket;
    try { upstream = await connect(target.host, target.port, v.ip); } catch { note({ verdict: "deny", ...target, reason: "unreachable" }); refuse(clientSocket, 502, "Bad Gateway"); return; }
    note({ verdict: "allow", ...target, reason: "ok" });
    track(upstream, false);
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    for (const s of [clientSocket, upstream] as net.Socket[]) { s.setTimeout?.(idleMs, () => { clientSocket.destroy(); upstream.destroy(); }); }
  });

  server.on("clientError", (_e, socket) => {
    note({ verdict: "deny", host: "", port: 0, reason: "bad_request" });
    try { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); } catch { socket.destroy(); }
  });

  return {
    listen: (port = 0, host = "127.0.0.1") => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.off("error", reject); const a = server.address() as net.AddressInfo; resolve({ port: a.port, host: a.address }); });
    }),
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
    stats: () => ({ allowed, denied, open }),
  };
}
