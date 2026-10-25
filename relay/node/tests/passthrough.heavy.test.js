// @ts-check
// S10 (ARCH R11, spike outcome): a public hostname through the relay's passthrough, the certificate issued on the Space, a form submit that reaches the host.
// The whole path on loopback sockets: visitor TLS client -> relay public port (SNI only) -> relay control channel tells the box -> box data socket -> Space HTTPS server.
//   - The certificate is issued the way a Space issues one: the key is made on the Space, a request naming the hosts goes to the authority, the signed certificate comes back. The relay is
//     never given the key or the certificate, and is not asked for either (DNS-01 is proved in the Space's DNS, not through the relay; port 80 on the relay is a fixed redirect).
//   - A form submit (POST of an urlencoded form, then a JSON one) reaches the Space's handler intact, and the answer returns the same way.
//   - A renewal swaps the certificate on the Space with the relay untouched; the next visitor sees the new one.
//   - Taking a name away at the directory refuses the next visitor with no restart.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "../server.js";
import { X509Certificate } from "node:crypto";
import { makeCa, issueOnSpace, startSpace, startBox, visit, until } from "./kit.js";

/** The SHA-256 fingerprint Node reports for a certificate. @param {string} pem */
const fingerprint = pem => new X509Certificate(pem).fingerprint256;

const HOST = "forms.harlow.example.test";

test("S10: a public hostname through passthrough, the certificate issued on the Space, and a form submit that reaches the host", async t => {
  const ca = makeCa();
  const cert1 = issueOnSpace(ca, [HOST]);
  /** @type {{ method: string, url: string, host: string, type: string, body: string }[]} */ const seen = [];
  /** @type {{ id: string, fields: Record<string, string> }[]} */ const submissions = [];
  const space = await startSpace(cert1, (req, body, res) => {
    seen.push({ method: String(req.method), url: String(req.url), host: String(req.headers.host), type: String(req.headers["content-type"] || ""), body: body.toString() });
    if (req.method === "POST" && req.url === "/f/intake/submit") {
      const type = String(req.headers["content-type"] || "");
      const fields = type.startsWith("application/json") ? JSON.parse(body.toString()) : Object.fromEntries(new URLSearchParams(body.toString()));
      const id = `sub_${submissions.length + 1}`;
      submissions.push({ id, fields });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, id }));
      return;
    }
    res.statusCode = 404;
    res.end("no");
  });
  t.after(() => space.close());

  // the directory's answer: this host belongs to this box's route, and the support switch can take it away
  let route = "", suspended = false;
  /** @type {string[]} */ const asked = [];
  const relay = createRelay({ tunnel: { resolve: async h => { asked.push(h); return h === HOST && !suspended && route ? { route } : null; }, limits: { ttlMs: 0 } } });
  const base = await relay.listen();
  const { tls: tlsPort } = await relay.listenTunnel();
  t.after(() => relay.close());
  const box = await startBox({ relay: base, space: space.port });
  t.after(() => box.close());
  route = box.route;

  // the form submit, urlencoded as a browser sends it
  const form = new URLSearchParams({ name: "Pat Rivera", email: "pat@example.test", matter: "Estate plan for two" }).toString();
  const r1 = await visit({ port: tlsPort, ca: ca.cert, host: HOST, method: "POST", path: "/f/intake/submit", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(r1.status, 201);
  assert.deepEqual(JSON.parse(r1.body), { ok: true, id: "sub_1" });
  assert.deepEqual(submissions[0]?.fields, { name: "Pat Rivera", email: "pat@example.test", matter: "Estate plan for two" }, "the host got every field exactly");
  assert.equal(seen[0]?.host, HOST, "and the Host header the visitor sent");
  assert.equal(r1.fingerprint, fingerprint(cert1.cert), "the certificate the visitor verified is the one issued on the Space");

  // the same through a JSON submit from a script
  const r2 = await visit({ port: tlsPort, ca: ca.cert, host: HOST, method: "POST", path: "/f/intake/submit", body: JSON.stringify({ name: "Sam Cho", matter: "Lease review" }), headers: { "content-type": "application/json" } });
  assert.equal(r2.status, 201);
  assert.deepEqual(submissions[1]?.fields, { name: "Sam Cho", matter: "Lease review" });

  // a path the Space does not serve is the Space's own 404, carried back as is
  assert.equal((await visit({ port: tlsPort, ca: ca.cert, host: HOST, path: "/admin" })).status, 404);

  // the relay was asked about the name each time and told the box the name and the address on its own channel
  assert.ok(asked.every(h => h === HOST));
  assert.equal(box.tap.tunnels.length, 3);
  assert.ok(box.tap.tunnels.every(x => x.host === HOST && x.ip === "127.0.0.1"));

  // the Space's key never crossed the relay
  const wire = Buffer.concat([...box.tap.up, ...box.tap.down]);
  assert.ok(!wire.includes("PRIVATE KEY"), "no key material in the bytes the relay carried");
  assert.ok(!wire.includes(Buffer.from(form)), "and no form text");

  // a certificate that this authority did not issue for this host does not verify through the relay either: the visitor checks the Space, not the relay
  const other = makeCa();
  await assert.rejects(visit({ port: tlsPort, ca: other.cert, host: HOST, path: "/f/intake/submit" }), /certificate|issuer|self.signed|unable to/i);

  // renewal on the Space: a new certificate, the relay untouched, the next visitor sees it
  const cert2 = issueOnSpace(ca, [HOST]);
  assert.notEqual(fingerprint(cert2.cert), fingerprint(cert1.cert));
  space.swap(cert2);
  const r3 = await visit({ port: tlsPort, ca: ca.cert, host: HOST, method: "POST", path: "/f/intake/submit", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(r3.status, 201);
  assert.equal(r3.fingerprint, fingerprint(cert2.cert), "the renewed certificate is served with no relay change");
  assert.equal(submissions.length, 3);

  // the directory takes the name away: the next visitor is refused at the relay, no box is told, and lifting it serves again
  await until(() => relay.stats().conns === 0);
  const told = box.tap.tunnels.length;
  suspended = true;
  await assert.rejects(visit({ port: tlsPort, ca: ca.cert, host: HOST, path: "/f/intake/submit" }));
  assert.equal(box.tap.tunnels.length, told, "no box was told");
  suspended = false;
  assert.equal((await visit({ port: tlsPort, ca: ca.cert, host: HOST, method: "POST", path: "/f/intake/submit", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 201);
});

// Re-run on the merged main so this file reports ok in the final run (P-L10_02).
