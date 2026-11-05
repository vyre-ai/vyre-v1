// The egress allow-list proxy (S8, spec 4.17): the only way out of a sandbox. A process in the sandbox has no route to anything but this proxy (the container's network is internal, Seatbelt allows
// only this port on loopback, bwrap points the process here), and the proxy lets a connection through only to a host the person's sandbox is allowed to name.
//
//   CONNECT host:443   tunnelled, for HTTPS. The proxy sees the name and port, never the bytes.
//   GET http://host/   forwarded, for plain HTTP, with hop-by-hop headers removed.
//
// Two rules (egress-policy.ts). A list: the name is matched against the allow-list as written (policy.hostAllowed), IP literals are refused (the list is by name), and ports are 443 and 80 unless
// the caller says otherwise. Public (owner ruling 3 Nov): any name or public address on any port, except Vyre's own ports. Either way a name is resolved here, once; every address must be public
// (no loopback, private, link-local or metadata address) and off this machine's own networks, so a name that points inside is refused, a DNS answer that changes between check and connect cannot
// matter, and the connection goes to the address that was checked. A host that does not answer is refused after `connectMs` with 502, never a hang. Events carry the host and port and the verdict,
// never a path, a header or a byte.
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { hostAllowed } from "./policy.ts";
import { VYRE_PORTS, addressRefusal, ownNetworks, targetOf } from "./egress-policy.ts";
import type { Cidr, EgressRule } from "./egress-policy.ts";

export type Verdict = "allow" | "deny";
export interface EgressEvent { verdict: Verdict; host: string; port: number; reason: "ok" | "not_listed" | "bad_port" | "private_address" | "own_network" | "no_address" | "bad_request" | "busy" | "unreachable" }

/** A host name the proxy answers itself instead of dialling out: the Space's own git address for a walled engine (modules/engine/github-session.ts). It never reaches the allow-list or the network. */
export interface LocalRoute { host: string; handle(req: http.IncomingMessage, res: http.ServerResponse): boolean }

export interface EgressOptions {
  /** Read at each request. Absent or null: no local host. */
  local?: () => LocalRoute | null;
  /** Host patterns, or a function so the list can change while the proxy runs (a policy change takes effect on the next connection). */
  allow: readonly string[] | (() => readonly string[]);
  /** The rule (egress-policy.ts). When given it decides, and `allow` is not read. A function lets it change under a running proxy. */
  rule?: EgressRule | (() => EgressRule);
  /** The list rule's ports. Default 443 and 80. The public rule takes any port but Vyre's own. */
  ports?: readonly number[];
  /** This machine's networks, refused whatever the rule. Default: read from the system every 30 s. */
  ownNetworks?: () => readonly Cidr[];
  /** Give up on a host that does not answer after this long. Default 20 s. */
  connectMs?: number;
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
const connectWithin = (ms: number) => (_h: string, port: number, ip: string): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const s = net.connect({ host: ip, port });
    const t = setTimeout(() => { s.destroy(); reject(new Error("timed out")); }, ms);
    s.once("connect", () => { clearTimeout(t); s.removeAllListeners("error"); resolve(s); });
    s.once("error", (e) => { clearTimeout(t); reject(e); });
  });

/** The networks of this machine, read at most every 30 s (an interface can come and go while the proxy runs). */
function cachedOwnNetworks(): () => readonly Cidr[] {
  let at = 0;
  let last: readonly Cidr[] = [];
  return () => { const now = Date.now(); if (now - at > 30_000) { try { last = ownNetworks(); } catch { /* keep the last answer */ } at = now; } return last; };
}

export function createEgressProxy(o: EgressOptions): EgressProxy {
  const ports = new Set(o.ports ?? [443, 80]);
  const lookup = o.lookup ?? systemLookup;
  const connect = o.connect ?? connectWithin(o.connectMs ?? 20_000);
  const own = o.ownNetworks ?? cachedOwnNetworks();
  const maxConnections = o.maxConnections ?? 256;
  const idleMs = o.idleMs ?? 120_000;
  const allowList = (): readonly string[] => (typeof o.allow === "function" ? o.allow() : o.allow);
  const rule = (): EgressRule => {
    if (o.rule !== undefined) return typeof o.rule === "function" ? o.rule() : o.rule;
    return { egress: "list", allow: allowList() };
  };
  const sockets = new Set<Duplex>();
  let allowed = 0;
  let denied = 0;
  let open = 0;

  const note = (e: EgressEvent): void => { if (e.verdict === "allow") allowed++; else denied++; try { o.onEvent?.(e); } catch { /* an observer must not break the proxy */ } };

  /** Check a target and resolve it. Returns the address to connect to, or the reason it was refused. */
  async function admit(host: string, port: number): Promise<{ ok: true; ip: string } | { ok: false; reason: EgressEvent["reason"] }> {
    const r = rule();
    let ips: readonly string[];
    // the Space this turn belongs to, at exactly its own address and port (a turn on a person's computer reaches Vyre's tools there): reachable whatever the rest of the rule says
    if (r.space !== undefined && r.space === targetOf(host, port)) {
      if (net.isIP(host) !== 0) return { ok: true, ip: host };
      try { ips = await lookup(host); } catch { return { ok: false, reason: "no_address" }; }
      return ips.length > 0 ? { ok: true, ip: ips[0] as string } : { ok: false, reason: "no_address" };
    }
    if (r.egress === "public") {
      if (!Number.isInteger(port) || port < 1 || port > 65535 || VYRE_PORTS.includes(port)) return { ok: false, reason: "bad_port" };
      if (net.isIP(host) !== 0) ips = [host];   // a public address is as good as a public name; the checks below refuse every other kind
      else if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !host.includes(".")) return { ok: false, reason: "not_listed" };   // a single label (localhost, a LAN name) is never public
      else {
        try { ips = await lookup(host); } catch { return { ok: false, reason: "no_address" }; }
      }
    } else {
      if (!ports.has(port)) return { ok: false, reason: "bad_port" };
      if (!hostAllowed(host, r.allow)) return { ok: false, reason: "not_listed" };
      try { ips = await lookup(host); } catch { return { ok: false, reason: "no_address" }; }
    }
    if (ips.length === 0) return { ok: false, reason: "no_address" };
    // Every address must be public and off this machine's networks: a name that also points inside is refused whole, so a resolver cannot pick the private one at connect time.
    const nets = own();
    for (const ip of ips) { const why = addressRefusal(ip, nets); if (why) return { ok: false, reason: why }; }
    return { ok: true, ip: ips[0] as string };
  }

  /** Remember a socket so close() can end it. `counted` ones are the connections a client holds open (a tunnel, a request in flight), which maxConnections limits. */
  function track(s: Duplex, counted: boolean): void {
    sockets.add(s);
    if (counted) open++;
    s.once("close", () => { sockets.delete(s); if (counted) open--; });
  }

  /** "host:port" of a CONNECT line: a name or an IPv4 address, or a bracketed IPv6 address ([2606:4700::1111]:443). No spaces, no path. */
  function parseAuthority(t: string): { host: string; port: number } | null {
    const m = /^([A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\]):(\d{1,5})$/.exec(t);
    if (!m) return null;
    const port = Number(m[2]);
    const raw = m[1] as string;
    const host = raw.startsWith("[") ? raw.slice(1, -1) : raw;
    if (raw.startsWith("[") && net.isIPv6(host) === false) return null;
    return port >= 1 && port <= 65535 ? { host, port } : null;
  }

  const refuse = (socket: Duplex, status: number, text: string): void => {
    try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${DENIED_BODY.length}\r\n\r\n${DENIED_BODY}`, () => socket.destroy()); } catch { socket.destroy(); }   // answered at once and closed once written: a refused client never waits on a half-open tunnel
  };

  const server = http.createServer(async (req, res) => {
    // Plain HTTP through a proxy arrives in absolute form: GET http://host/path.
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { note({ verdict: "deny", host: "", port: 0, reason: "bad_request" }); res.writeHead(400, { "content-type": "text/plain", connection: "close" }).end("This is a proxy: send absolute URLs.\n"); return; }
    if (url.protocol !== "http:") { note({ verdict: "deny", host: url.hostname, port: Number(url.port || 0), reason: "bad_request" }); res.writeHead(400, { connection: "close" }).end(); return; }
    const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const port = Number(url.port || 80);
    const local = o.local?.();
    if (local && host === local.host && port === 80) {
      req.url = `${url.pathname}${url.search}`;
      if (!local.handle(req, res)) res.writeHead(404, { "content-type": "text/plain", connection: "close" }).end("Not found.\n");
      return;
    }
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
