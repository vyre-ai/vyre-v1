// @ts-check
// SNI passthrough (V1-SPEC section 5 Networking, ARCH R11): the relay reads one ClientHello to learn the server name, asks which Space serves it, and carries bytes. TLS ends on the
// Space with the Space's own certificate, so the relay sees ciphertext only. Real sockets on loopback, a real relay, a real TLS handshake.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { createRelay } from "../server.js";
import net from "node:net";
import { X509Certificate } from "node:crypto";
import { makeCa, issueOnSpace, startSpace, startBox, visit, tlsRecords, until } from "./kit.js";

/** The SHA-256 fingerprint Node reports for a certificate. @param {string} pem */
const fingerprint = pem => new X509Certificate(pem).fingerprint256;

const A = "documents.harlow.example.test", B = "forms.juniper.example.test";
const SECRET_IN = "CLIENT-PRIVILEGED-MARKER-7731", SECRET_OUT = "SPACE-REPLY-MARKER-9912";

/** Two Spaces behind one relay: each has its own box, its own key and its own certificate; the relay is told which route serves which host and nothing else. */
async function world(/** @type {import("node:test").TestContext} */ t) {
  const ca = makeCa();
  /** @type {string[]} */ const asked = [];
  /** @type {Map<string, string>} */ const hosts = new Map();
  const relay = createRelay({ tunnel: { resolve: async h => { asked.push(h); const route = hosts.get(h); return route ? { route } : null; }, limits: { ttlMs: 0 } } });
  const base = await relay.listen();
  const { tls: tlsPort, http: httpPort } = await relay.listenTunnel();
  t.after(() => relay.close());
  /** @param {string} host */
  async function space(host) {
    const cert = issueOnSpace(ca, [host]);
    /** @type {{ host: string, url: string, body: string }[]} */ const received = [];
    const s = await startSpace(cert, (req, body, res) => { received.push({ host: String(req.headers.host), url: String(req.url), body: body.toString() }); res.setHeader("content-type", "text/plain"); res.end(`${SECRET_OUT} for ${host}`); });
    t.after(() => s.close());
    const box = await startBox({ relay: base, space: s.port });
    t.after(() => box.close());
    hosts.set(host, box.route);
    return { cert, box, received };
  }
  return { ca, relay, tlsPort, httpPort, asked, space };
}

test("the relay sees only ciphertext for app traffic: the request and the reply cross it as TLS records and no plaintext", async t => {
  const w = await world(t);
  const sp = await w.space(A);
  const r = await visit({ port: w.tlsPort, ca: w.ca.cert, host: A, method: "POST", path: "/private/note", body: SECRET_IN, headers: { "content-type": "text/plain" } });
  assert.equal(r.status, 200);
  assert.equal(r.body, `${SECRET_OUT} for ${A}`, "the visitor read the Space's reply");
  assert.equal(sp.received[0]?.body, SECRET_IN, "the Space read the visitor's request");
  assert.equal(sp.received[0]?.url, "/private/note");
  await until(() => sp.box.tap.down.length > 0);

  const up = Buffer.concat(sp.box.tap.up), down = Buffer.concat(sp.box.tap.down);
  for (const [name, stream] of [["visitor to Space", up], ["Space to visitor", down]] /** @type {const} */) {
    assert.ok(!stream.includes(SECRET_IN), `${name}: the request text is not in the bytes the relay carried`);
    assert.ok(!stream.includes(SECRET_OUT), `${name}: the reply text is not in the bytes the relay carried`);
    assert.ok(!stream.includes("/private/note"), `${name}: the path is not in the bytes the relay carried`);
    const recs = tlsRecords(stream);
    assert.ok(recs.length > 0, `${name}: the bytes are TLS records`);
    assert.ok(recs.every(x => [0x14, 0x15, 0x16, 0x17].includes(x.type)), `${name}: every record is a TLS record type`);
    assert.ok(recs.some(x => x.type === 0x17), `${name}: the payload travelled as application data records`);
  }
  assert.equal(up[0], 0x16, "the first thing the relay got from the visitor is the ClientHello");
  // the relay holds no certificate: the one the visitor verified belongs to the Space
  assert.equal(r.fingerprint, fingerprint(sp.cert.cert));
  assert.ok(!(w.relay.server instanceof https.Server) && w.relay.server instanceof http.Server, "the relay's own listener is plain HTTP; it has no TLS context");
});

test("the server name alone picks the Space: each visitor gets that Space's certificate and only that Space's box is told", async t => {
  const w = await world(t);
  const a = await w.space(A), b = await w.space(B);
  const ra = await visit({ port: w.tlsPort, ca: w.ca.cert, host: A, path: "/a" });
  const rb = await visit({ port: w.tlsPort, ca: w.ca.cert, host: B, path: "/b" });
  assert.equal(ra.body, `${SECRET_OUT} for ${A}`);
  assert.equal(rb.body, `${SECRET_OUT} for ${B}`);
  assert.equal(ra.fingerprint, fingerprint(a.cert.cert));
  assert.equal(rb.fingerprint, fingerprint(b.cert.cert));
  assert.notEqual(ra.fingerprint, rb.fingerprint);
  assert.deepEqual(a.received.map(x => x.url), ["/a"]);
  assert.deepEqual(b.received.map(x => x.url), ["/b"]);
  assert.deepEqual(a.box.tap.tunnels.map(x => x.host), [A], "the box hears the name on the relay's own control channel");
  assert.deepEqual(b.box.tap.tunnels.map(x => x.host), [B]);
  assert.match(String(a.box.tap.tunnels[0]?.ip), /^127\.0\.0\.1$/, "and the visitor's address, never inside the byte stream");
});

test("a name no Space declared, a hello with no name and a non-TLS client are all closed before any box is told", async t => {
  const w = await world(t);
  const a = await w.space(A);
  await until(() => w.relay.stats().conns === 0);
  /** @param {import("node:tls").ConnectionOptions} o @returns {Promise<number>} the bytes that came back before the close */
  const probe = o => new Promise(res => {
    const s = tls.connect({ host: "127.0.0.1", port: w.tlsPort, rejectUnauthorized: false, ...o });
    let n = 0;
    s.on("data", d => { n += d.length; });
    s.on("error", () => {});
    s.once("close", () => res(n));
  });
  assert.equal(await probe({ servername: "evil.example.test" }), 0, "an undeclared name gets no byte");
  assert.equal(await probe({ servername: "" }), 0, "no server name gets no byte");
  // a client that does not speak TLS at all
  const plain = await new Promise(res => {
    const s = net.connect(w.tlsPort, "127.0.0.1", () => s.write("GET / HTTP/1.1\r\nhost: documents.harlow.example.test\r\n\r\n"));
    let n = 0;
    s.on("data", d => { n += d.length; });
    s.on("error", () => {});
    s.once("close", () => res(n));
  });
  assert.equal(plain, 0, "plain HTTP on the TLS port gets no byte and no box is told");
  assert.equal(a.box.tap.tunnels.length, 0, "no box was told about any of them");
  assert.equal(w.relay.stats().conns, 0);
  assert.ok(w.asked.includes("evil.example.test"), "the relay asked the directory about the name, and only the name");
  assert.deepEqual(w.asked, ["evil.example.test"], "a hello with no name and a client that is not TLS never reach the directory");
});

test("port 80 never reaches a Space: a fixed redirect to https for a host, 400 for anything else", async t => {
  const w = await world(t);
  const a = await w.space(A);
  /** @param {Record<string, string>} headers @param {string} p */
  const get = (headers, p) => new Promise(res => {
    const req = http.request({ host: "127.0.0.1", port: w.httpPort, path: p, headers, agent: false }, r => { r.resume(); r.on("end", () => res({ status: r.statusCode, location: r.headers.location })); });
    req.on("error", () => res({ status: 0, location: undefined }));
    req.end();
  });
  assert.deepEqual(await get({ host: A }, "/.well-known/acme-challenge/token"), { status: 308, location: `https://${A}/` });
  assert.deepEqual(await get({ host: "127.0.0.1" }, "/"), { status: 400, location: undefined });
  assert.equal(a.received.length, 0);
  assert.equal(a.box.tap.tunnels.length, 0);
});
