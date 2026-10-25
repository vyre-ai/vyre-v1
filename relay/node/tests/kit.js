// @ts-check
// Test kit for the SNI passthrough tests (not a test file). It builds the three things S10 needs around a real relay on loopback sockets:
//   - a certificate authority and, on the Space, a key plus a certificate request the authority signs (the relay is never given the key or the certificate),
//   - a Space: an HTTPS server holding that certificate, and a box that bridges the relay's tunnel data sockets to it (what the daemon's tunnel end does),
//   - a visitor: a TLS client that checks the Space's certificate against the authority.
// The box taps every byte the relay carries in both directions, which is exactly what the relay can see.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { newRouteKey, routeId, authMessage, signRoute } from "../wire.js";

/** @param {string[]} args @param {string} cwd */
const openssl = (args, cwd) => execFileSync("openssl", args, { cwd, stdio: "ignore" });

/** A throwaway certificate authority. @returns {{ cert: string, dir: string }} */
export function makeCa() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-ca-"));
  openssl(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-subj", "/CN=relay-test-ca", "-days", "2",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"], dir);
  return { cert: fs.readFileSync(path.join(dir, "ca.pem"), "utf8"), dir };
}

/**
 * Issue a certificate the way a Space does: the key is made on the Space, the Space sends the authority a request that names the hosts, and only the signed certificate comes back.
 * Nothing here touches the relay. @param {{ dir: string }} ca @param {string[]} names @returns {{ cert: string, key: string }}
 */
export function issueOnSpace(ca, names) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "space-cert-"));
  try {
    const san = names.map(n => `DNS:${n}`).join(",");
    openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "space.key"], work);
    openssl(["req", "-new", "-key", "space.key", "-out", "space.csr", "-subj", `/CN=${names[0]}`, "-addext", `subjectAltName=${san}`], work);
    fs.writeFileSync(path.join(work, "ext.cnf"), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n`);
    openssl(["x509", "-req", "-in", "space.csr", "-CA", path.join(ca.dir, "ca.pem"), "-CAkey", path.join(ca.dir, "ca.key"), "-CAcreateserial", "-CAserial", path.join(work, "ca.srl"),
      "-out", "space.pem", "-days", "2", "-extfile", "ext.cnf"], work);
    return { cert: fs.readFileSync(path.join(work, "space.pem"), "utf8"), key: fs.readFileSync(path.join(work, "space.key"), "utf8") };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

/**
 * A Space's public face: an HTTPS server that holds the certificate. `swap` replaces the certificate in place (a renewal).
 * @param {{ cert: string, key: string }} tls @param {(req: import("node:http").IncomingMessage, body: Buffer, res: import("node:http").ServerResponse) => void} handler
 */
export async function startSpace(tls, handler) {
  const server = https.createServer({ cert: tls.cert, key: tls.key }, (req, res) => {
    /** @type {Buffer[]} */ const parts = [];
    req.on("data", d => parts.push(d));
    req.on("end", () => handler(req, Buffer.concat(parts), res));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", () => r(undefined)));
  return {
    port: /** @type {import("node:net").AddressInfo} */ (server.address()).port,
    swap: (/** @type {{ cert: string, key: string }} */ next) => server.setSecureContext({ cert: next.cert, key: next.key }),
    close: () => new Promise(r => { server.close(() => r(undefined)); server.closeAllConnections(); }),
  };
}

/** @typedef {{ up: Buffer[], down: Buffer[], tunnels: { host: string, ip: string, port: number }[] }} Tap */

/**
 * A box: signs in to the relay on its route, and for every `tunnel` message opens the data socket and bridges it to the Space's TLS port as plain TCP (the box never decrypts).
 * @param {{ relay: string, space: number, key?: ReturnType<typeof newRouteKey> }} o
 * @returns {Promise<{ route: string, tap: Tap, close: () => void }>}
 */
export async function startBox(o) {
  const key = o.key || newRouteKey();
  const route = routeId(key.pub);
  /** @type {Tap} */ const tap = { up: [], down: [], tunnels: [] };
  /** @type {Set<{ close(): void }>} */ const live = new Set();
  const control = new WebSocket(`${o.relay}/v1/box?route=${route}`);
  control.binaryType = "arraybuffer";
  /** @type {(v: string) => void} */ let gotTicket = () => {};
  const ticketP = new Promise(r => { gotTicket = r; });
  /** @type {string} */ let ticket = "";
  control.onmessage = e => {
    if (typeof e.data !== "string") return;
    const m = JSON.parse(e.data);
    if (m.t === "challenge") {
      control.send(JSON.stringify({ t: "auth", pub: key.pub.toString("base64url"), sig: signRoute(key.priv, authMessage(route, Buffer.from(m.n, "base64url"))).toString("base64url") }));
    } else if (m.t === "ready") {
      ticket = m.ticket;
      gotTicket(m.ticket);
    } else if (m.t === "tunnel") {
      tap.tunnels.push({ host: m.host, ip: m.ip, port: m.port });
      bridge(String(m.c));
    }
  };
  /** @param {string} c */
  function bridge(c) {
    const data = new WebSocket(`${o.relay}/v1/box?route=${route}&c=${c}&t=${ticket}`);
    data.binaryType = "arraybuffer";
    const tcp = net.connect(o.space, "127.0.0.1");
    tcp.setNoDelay(true);
    /** @type {Buffer[]} */ let queued = [];
    let open = false;
    const entry = { close: () => { try { data.close(); } catch { /* gone */ } tcp.destroy(); } };
    live.add(entry);
    data.onopen = () => { open = true; for (const b of queued) data.send(b); queued = []; };
    data.onmessage = e => { if (typeof e.data === "string") return; const b = Buffer.from(e.data); tap.up.push(b); tcp.write(b); };
    data.onclose = () => { live.delete(entry); tcp.destroy(); };
    data.onerror = () => tcp.destroy();
    tcp.on("data", d => { tap.down.push(Buffer.from(d)); if (open) data.send(d); else queued.push(Buffer.from(d)); });
    tcp.on("close", () => { live.delete(entry); try { data.close(); } catch { /* gone */ } });
    tcp.on("error", () => {});
  }
  await ticketP;
  return { route, tap, close: () => { for (const x of [...live]) x.close(); try { control.close(); } catch { /* gone */ } } };
}

/**
 * A visitor's HTTPS request to the relay's passthrough port, with `host` as the SNI name and the Host header, the certificate checked against `ca`.
 * @param {{ port: number, ca: string, host: string, method?: string, path: string, body?: string, headers?: Record<string, string> }} o
 * @returns {Promise<{ status: number, body: string, fingerprint: string }>}
 */
export function visit(o) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", port: o.port, ca: o.ca, agent: false, servername: o.host, method: o.method || "GET", path: o.path,
      headers: { host: o.host, connection: "close", ...(o.body !== undefined ? { "content-length": String(Buffer.byteLength(o.body)) } : {}), ...(o.headers || {}) }, timeout: 8000 }, res => {
      /** @type {Buffer[]} */ const parts = [];
      const seen = /** @type {import("node:tls").TLSSocket} */ (res.socket).getPeerCertificate().fingerprint256;
      res.on("data", d => parts.push(d));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(parts).toString(), fingerprint: seen }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(o.body);
  });
}

/** The TLS records in a byte stream, as { type, length } (the first five bytes of each record tell both); stops at a partial record. @param {Buffer} stream */
export function tlsRecords(stream) {
  /** @type {{ type: number, length: number }[]} */ const out = [];
  let p = 0;
  while (p + 5 <= stream.length) {
    const length = stream.readUInt16BE(p + 3);
    if (p + 5 + length > stream.length) break;
    out.push({ type: stream[p] ?? 0, length });
    p += 5 + length;
  }
  return out;
}

/** Resolves once `fn` returns truthy, polling; rejects after `ms`. @param {() => unknown} fn @param {number} [ms] */
export async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 15));
  }
}
