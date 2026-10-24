// Certificate state: what counts as an issued certificate, pending then failed, and the expiry the Console shows for renewal.
import test from "node:test";
import assert from "node:assert/strict";
import { CaddyAdmin, CaddyRouter, judgeCert } from "../src/caddy/index.ts";
import type { PeerCert, PeerFn } from "../src/caddy/index.ts";
import { FakeCaddy } from "../src/caddy/fake.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const good = (o: Partial<PeerCert> = {}): PeerCert => ({
  subjectaltname: "DNS:www.firm.com", subject: { CN: "www.firm.com" }, issuer: { CN: "R11", O: "Let's Encrypt" },
  valid_from: "Oct 20 00:00:00 2026 GMT", valid_to: "Jan 18 00:00:00 2027 GMT", ...o,
});

test("a certificate that names the host, is in date and has an outside issuer is issued", () => {
  const c = judgeCert(good(), "www.firm.com", NOW);
  assert.equal(c.issued, true);
  assert.equal(c.expiresAt, Date.parse("Jan 18 00:00:00 2027 GMT"));
  assert.equal(c.issuer, "Let's Encrypt");
});

test("no certificate, other names, expired, not yet valid, no end date, self-signed: none of them is issued", () => {
  assert.deepEqual(judgeCert(null, "www.firm.com", NOW), { issued: false });
  const cases: [PeerCert, RegExp][] = [
    [good({ subjectaltname: "DNS:other.com" }), /other hosts/],
    [good({ valid_to: "Oct 01 00:00:00 2026 GMT" }), /expired/],
    [good({ valid_from: "Dec 01 00:00:00 2026 GMT" }), /not valid yet/],
    [good({ valid_to: undefined }), /no end date/],
    [good({ issuer: { CN: "www.firm.com" } }), /self-signed/],
  ];
  for (const [cert, why] of cases) {
    const j = judgeCert(cert, "www.firm.com", NOW);
    assert.equal(j.issued, false, String(why));
    assert.match(j.why ?? "", why);
  }
});

test("a wildcard name covers one label, the subject name is used when there is no alt name list, and case does not matter", () => {
  assert.equal(judgeCert(good({ subjectaltname: "DNS:*.acme.vyre.run" }), "staging-1.acme.vyre.run", NOW).issued, true);
  assert.equal(judgeCert(good({ subjectaltname: "DNS:*.acme.vyre.run" }), "a.b.acme.vyre.run", NOW).issued, false);
  assert.equal(judgeCert(good({ subjectaltname: "DNS:*.acme.vyre.run" }), "acme.vyre.run", NOW).issued, false);
  assert.equal(judgeCert(good({ subjectaltname: undefined, subject: { CN: "WWW.firm.com" } }), "www.FIRM.com", NOW).issued, true);
});

function rig(peer: PeerFn, failAfter?: number) {
  const clock = { t: NOW };
  const calls: [string, number, string][] = [];
  const router = new CaddyRouter({
    admin: new CaddyAdmin({ fetch: new FakeCaddy().fetch }), space: "spc_1", now: () => clock.t, ...(failAfter !== undefined ? { certFailAfterMs: failAfter } : {}),
    tls: { host: "127.0.0.1", port: 443, peer: async (h, p, sn, ms) => { calls.push([h, p, sn]); void ms; return peer(h, p, sn, ms); } },
  });
  return { clock, calls, router };
}

test("pending right after the route is added, failed once the wait is over, issued as soon as Caddy has the certificate", async () => {
  let cert: PeerCert | null = null;
  const r = rig(async () => cert, 600_000);
  await r.router.setRoute({ host: "www.firm.com", upstream: "s:1", auth: null });
  assert.equal(await r.router.certState("www.firm.com"), "pending");
  r.clock.t += 599_999;
  assert.equal(await r.router.certState("www.firm.com"), "pending");
  r.clock.t += 2;
  assert.equal(await r.router.certState("www.firm.com"), "failed");
  cert = good();
  assert.equal(await r.router.certState("www.firm.com"), "issued");
  assert.deepEqual(r.calls[0], ["127.0.0.1", 443, "www.firm.com"], "the check goes to the local listener with the host as SNI");
});

test("a host the router never added is pending, not failed", async () => {
  const r = rig(async () => null, 1);
  r.clock.t += 10_000_000;
  assert.equal(await r.router.certState("never.firm.com"), "pending");
});

test("removing a route forgets its clock, so a route added again starts a new wait", async () => {
  const r = rig(async () => null, 1000);
  await r.router.setRoute({ host: "www.firm.com", upstream: "s:1", auth: null });
  r.clock.t += 5000;
  assert.equal(await r.router.certState("www.firm.com"), "failed");
  await r.router.removeRoute("www.firm.com");
  await r.router.setRoute({ host: "www.firm.com", upstream: "s:1", auth: null });
  assert.equal(await r.router.certState("www.firm.com"), "pending");
});

test("certInfo shows the expiry of a certificate Caddy renewed, so the Console can show days left", async () => {
  let cert = good({ valid_to: "Nov 02 00:00:00 2026 GMT" });
  const r = rig(async () => cert);
  const before = await r.router.certInfo("www.firm.com");
  assert.equal(before.issued, true);
  assert.equal(Math.round(((before.expiresAt ?? 0) - NOW) / 86_400_000), 8);
  cert = good({ valid_to: "Jan 31 00:00:00 2027 GMT" });
  const after = await r.router.certInfo("www.firm.com");
  assert.ok((after.expiresAt ?? 0) > (before.expiresAt ?? 0), "the renewed certificate has a later end date");
  assert.equal(await r.router.certState("www.firm.com"), "issued");
});
