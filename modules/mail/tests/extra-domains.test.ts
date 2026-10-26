// mail.domain.list / get / add / check / set_default / remove (P-L5_01c). Providers are scripted, DNS is a recorded zone.
import test from "node:test";
import assert from "node:assert/strict";
import { domainAdd, domainCheck, domainGet, domainList, domainRemove, domainSetDefault } from "../handlers/extra/domains.ts";
import { bindDns } from "../handlers/extra/dns.ts";
import { eventErrors, hostError, script, seedDomain, zone } from "../handlers/extra/kit.ts";
import type { Zone } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

let keys = 0;
const key = (): string => `idem-dom-${++keys}`;

const RESEND_RECORDS = [
  { purpose: "spf", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all", state: "pending" },
  { purpose: "dkim", type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSqGSIb3", state: "pending" },
  { purpose: "mx", type: "MX", name: "send", value: "10 feedback-smtp.us-east-1.amazonses.com", state: "pending" },
  { purpose: "dmarc", type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;", state: "pending" },
];
const GREEN: Zone = {
  txt: {
    "send.example.com": ["v=spf1 include:amazonses.com include:_spf.google.com ~all"],
    "resend._domainkey.example.com": ["p=MIGfMA0GCSqGSIb3"],
    "_dmarc.example.com": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"],
  },
  mx: { "send.example.com": ["feedback-smtp.us-east-1.amazonses.com"] },
};

interface Provider { verified: boolean; fail: boolean }

/** Resend scripted: create answers the record list above, verify answers per `p`. */
function resend(h: Harness, p: Provider = { verified: true, fail: false }): Provider {
  script(h, {
    "resend.domains.create": (i) => ({
      domain: { providerDomainId: "pdm_1", name: i.name, status: "not_started", spf: "pending", dkim: "pending", dmarc: "pending" }, records: RESEND_RECORDS,
    }),
    "resend.domains.verify": (i) => {
      if (p.fail) throw hostError(h, "provider.unavailable");
      return { domain: { providerDomainId: i.providerDomainId, name: "example.com", status: p.verified ? "verified" : "pending", spf: "pass", dkim: "pass", dmarc: "pass" } };
    },
    "resend.domains.delete": () => ({ deleted: true }),
  });
  return p;
}

function setup(): Harness {
  const h = harness();
  seedMailbox(h, "mbx_hello", "hello@example.com", { kind: "shared", privacy: "space" });
  return h;
}

const row = (h: Harness, id: string) => h.rows(`SELECT * FROM mail_domain WHERE id = ?`, id)[0]!;

test("add registers the domain at the provider and returns the DNS records to publish", async () => {
  const h = setup();
  resend(h);
  const out = await domainAdd(h.ctx, { name: " Example.COM. ", provider: "resend", idempotencyKey: key() });
  assert.deepEqual(contractErrors("mail.domain.add", "out", out), []);
  assert.deepEqual(h.calls("resend.domains.create").map((c) => c.input), [{ name: "example.com" }]);
  const d = out.domain;
  assert.deepEqual([d.name, d.provider, d.spf, d.dkim, d.dmarc, d.verified, d.isDefault, d.checkedAt], ["example.com", "resend", "pending", "pending", "pending", false, false, undefined]);
  assert.deepEqual(out.records, RESEND_RECORDS);
  assert.deepEqual(h.named("sending_domain.added").map((e) => [e.subject, e.payload]), [[`domain/${d.id}`, { domainId: d.id, name: "example.com", provider: "resend" }]]);
  assert.deepEqual(eventErrors(h), []);
  assert.deepEqual(await domainGet(h.ctx, { domainId: d.id }), out);
});

test("add with the same key answers the first domain and registers nothing again", async () => {
  const h = setup();
  resend(h);
  const k = key();
  const a = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: k });
  const b = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: k });
  assert.deepEqual(b, a);
  assert.equal(h.calls("resend.domains.create").length, 1);
  assert.equal(h.named("sending_domain.added").length, 1);
});

test("add refuses a domain that is already added, a bad name, a bad provider and a provider that answers nothing", async () => {
  const h = setup();
  resend(h);
  await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  await assert.rejects(domainAdd(h.ctx, { name: "EXAMPLE.com", provider: "resend", idempotencyKey: key() }), (e) => codeOf(e) === "validation.duplicate");
  for (const bad of ["localhost", "a b.com", "http://x.com", "-x.com", "x..com", "", "x.c"]) {
    await assert.rejects(domainAdd(h.ctx, { name: bad, provider: "resend", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input", bad);
  }
  await assert.rejects(domainAdd(h.ctx, { name: "b.example.org", provider: "ses" as never, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(domainAdd(h.ctx, { name: "b.example.org", provider: "resend", idempotencyKey: "" }), (e) => codeOf(e) === "validation.bad_input");
  script(h, { "resend.domains.create": () => ({ domain: {}, records: [] }) });
  await assert.rejects(domainAdd(h.ctx, { name: "c.example.org", provider: "resend", idempotencyKey: key() }), (e) => codeOf(e) === "provider.bad_response");
  assert.equal(h.rows(`SELECT id FROM mail_domain`).length, 1);
});

test("add through Mailgun keeps the domain name as the provider reference and drops malformed records", async () => {
  const h = setup();
  script(h, { "mailgun.domains.create": (i) => ({
    domain: { name: i.name, state: "unverified", spf: "pending", dkim: "pending", dmarc: "pending", region: "us" },
    records: [{ purpose: "spf", type: "TXT", name: "@", value: "v=spf1 include:mailgun.org ~all", state: "pending" }, { purpose: "bogus", type: "TXT" }, null],
  }) });
  const out = await domainAdd(h.ctx, { name: "example.com", provider: "mailgun", idempotencyKey: key() });
  assert.deepEqual(contractErrors("mail.domain.add", "out", out), []);
  assert.equal(out.domain.provider, "mailgun");
  assert.deepEqual(out.records.map((r) => r.purpose), ["spf"]);
  assert.match(String(row(h, out.domain.id).records), /"ref":"example\.com"/);
});

test("check finds every record, the provider verifies, and the domain turns green", async () => {
  const h = setup();
  resend(h);
  const added = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  bindDns(h.ctx, zone(GREEN));
  const out = await domainCheck(h.ctx, { domainId: added.domain.id });
  assert.deepEqual(contractErrors("mail.domain.check", "out", out), []);
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc, out.domain.verified, out.domain.checkedAt], ["pass", "pass", "pass", true, NOW]);
  assert.deepEqual(out.records.map((r) => [r.purpose, r.state]), [["spf", "pass"], ["dkim", "pass"], ["mx", "pass"], ["dmarc", "pass"]]);
  assert.deepEqual(h.calls("resend.domains.verify").map((c) => c.input), [{ providerDomainId: "pdm_1" }]);
  assert.deepEqual(h.named("sending_domain.checked").map((e) => e.payload), [{ domainId: added.domain.id, spf: "pass", dkim: "pass", dmarc: "pass" }]);
  assert.deepEqual(eventErrors(h), []);
});

test("check through Mailgun verifies by domain name", async () => {
  const h = setup();
  script(h, {
    "mailgun.domains.create": (i) => ({ domain: { name: i.name, state: "unverified", spf: "pending", dkim: "pending", dmarc: "pending", region: "us" }, records: [
      { purpose: "spf", type: "TXT", name: "@", value: "v=spf1 include:mailgun.org ~all", state: "pending" },
      { purpose: "dkim", type: "CNAME", name: "k1._domainkey", value: "dkim.mailgun.org.", state: "pending" },
    ] }),
    "mailgun.domains.verify": () => ({ domain: { name: "example.com", state: "active", spf: "pass", dkim: "pass", dmarc: "pending", region: "us" } }),
  });
  const added = await domainAdd(h.ctx, { name: "example.com", provider: "mailgun", idempotencyKey: key() });
  bindDns(h.ctx, zone({ txt: { "example.com": ["google-site-verification=abc", "v=spf1 include:mailgun.org include:other.net ~all"] }, cname: { "k1._domainkey.example.com": ["DKIM.mailgun.org"] } }));
  const out = await domainCheck(h.ctx, { domainId: added.domain.id });
  assert.deepEqual(h.calls("mailgun.domains.verify").map((c) => c.input), [{ name: "example.com" }]);
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc, out.domain.verified], ["pass", "pass", "pending", true]);   // DMARC is shown, not required
});

test("check marks a wrong record red, a missing one pending, and a record that disappeared red", async () => {
  const h = setup();
  resend(h);
  const { domain } = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  bindDns(h.ctx, zone({ txt: { "send.example.com": ["v=spf1 include:sendgrid.net ~all"], "resend._domainkey.example.com": ["p=SOMETHINGELSE"] } }));
  let out = await domainCheck(h.ctx, { domainId: domain.id });
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc, out.domain.verified], ["fail", "fail", "pending", false]);
  assert.deepEqual(out.records.map((r) => [r.purpose, r.state]), [["spf", "fail"], ["dkim", "fail"], ["mx", "pending"], ["dmarc", "pending"]]);
  bindDns(h.ctx, zone(GREEN));
  out = await domainCheck(h.ctx, { domainId: domain.id });
  assert.equal(out.domain.verified, true);
  bindDns(h.ctx, zone({}));   // everything was removed from DNS
  out = await domainCheck(h.ctx, { domainId: domain.id });
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc, out.domain.verified], ["fail", "fail", "fail", false]);
});

test("check keeps the last answer when a lookup fails for a moment", async () => {
  const h = setup();
  resend(h);
  const { domain } = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  bindDns(h.ctx, zone(GREEN));
  await domainCheck(h.ctx, { domainId: domain.id });
  bindDns(h.ctx, zone({ ...GREEN, broken: ["send.example.com", "resend._domainkey.example.com", "_dmarc.example.com"] }));
  const out = await domainCheck(h.ctx, { domainId: domain.id });
  assert.deepEqual([out.domain.spf, out.domain.dkim, out.domain.dmarc, out.domain.verified], ["pass", "pass", "pass", true]);
});

test("check does not call the domain verified until the provider says so, and keeps its last word if it cannot be reached", async () => {
  const h = setup();
  const p = resend(h, { verified: false, fail: false });
  const { domain } = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  bindDns(h.ctx, zone(GREEN));
  assert.equal((await domainCheck(h.ctx, { domainId: domain.id })).domain.verified, false);   // DNS is right, the provider has not caught up
  p.verified = true;
  assert.equal((await domainCheck(h.ctx, { domainId: domain.id })).domain.verified, true);
  p.fail = true;
  assert.equal((await domainCheck(h.ctx, { domainId: domain.id })).domain.verified, true);    // provider down: its earlier answer stands
  assert.equal(h.named("sending_domain.checked").length, 3);
});

test("a domain that stops verifying stops being the default sender", async () => {
  const h = setup();
  resend(h);
  const { domain } = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  bindDns(h.ctx, zone(GREEN));
  await domainCheck(h.ctx, { domainId: domain.id });
  await domainSetDefault(h.ctx, { domainId: domain.id });
  assert.equal(row(h, domain.id).isDefault, 1);
  bindDns(h.ctx, zone({}));
  await domainCheck(h.ctx, { domainId: domain.id });
  assert.deepEqual([row(h, domain.id).verified, row(h, domain.id).isDefault], [0, 0]);
});

test("set_default needs a verified domain, makes it the only default, and is idempotent", async () => {
  const h = setup();
  seedDomain(h, { id: "dom_a", name: "a.example.com", verified: true, isDefault: true, spf: "pass", dkim: "pass" });
  seedDomain(h, { id: "dom_b", name: "b.example.com", verified: true, spf: "pass", dkim: "pass" });
  seedDomain(h, { id: "dom_c", name: "c.example.com", verified: false });
  await assert.rejects(domainSetDefault(h.ctx, { domainId: "dom_c" }), (e) => codeOf(e) === "validation.precondition_failed");
  const out = await domainSetDefault(h.ctx, { domainId: "dom_b" });
  assert.deepEqual(contractErrors("mail.domain.set_default", "out", out), []);
  assert.deepEqual([out.domain.isDefault, row(h, "dom_a").isDefault, row(h, "dom_b").isDefault], [true, 0, 1]);
  const again = await domainSetDefault(h.ctx, { domainId: "dom_b" });
  assert.equal(again.domain.isDefault, true);
  assert.equal(row(h, "dom_b").version, 2);
  await assert.rejects(domainSetDefault(h.ctx, { domainId: "dom_nope" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(domainSetDefault(h.ctx, { domainId: "domain" }), (e) => codeOf(e) === "validation.bad_input");
});

test("list and get show the domains in name order with their state and records", async () => {
  const h = setup();
  seedDomain(h, { id: "dom_b", name: "b.example.com", records: RESEND_RECORDS });
  seedDomain(h, { id: "dom_a", name: "a.example.com", provider: "mailgun", ref: "a.example.com" });
  const list = await domainList(h.ctx, {});
  assert.deepEqual(contractErrors("mail.domain.list", "out", list), []);
  assert.deepEqual(list.domains.map((d) => [d.name, d.provider]), [["a.example.com", "mailgun"], ["b.example.com", "resend"]]);
  const page = await domainList(h.ctx, { limit: 1 });
  assert.deepEqual([page.domains.length, page.next, page.total], [1, "1", 2]);
  const got = await domainGet(h.ctx, { domainId: "dom_b" });
  assert.deepEqual(contractErrors("mail.domain.get", "out", got), []);
  assert.deepEqual(got.records, RESEND_RECORDS);
  await assert.rejects(domainGet(h.ctx, { domainId: "dom_nope" }), (e) => codeOf(e) === "validation.not_found");
});

test("remove deletes the domain at the provider, takes its routes with it and clears the default", async () => {
  const h = setup();
  resend(h);
  const { domain } = await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() });
  h.ctx.db.run(`INSERT INTO mail_route (id, "domainId", "localPart", "mailboxId", provider, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, "rte_one", domain.id, "hello", "mbx_hello", "resend", 1, NOW, null);
  h.ctx.db.run(`UPDATE mail_domain SET "isDefault" = ?, verified = ? WHERE id = ?`, 1, 1, domain.id);
  const out = await domainRemove(h.ctx, { domainId: domain.id });
  assert.deepEqual(contractErrors("mail.domain.remove", "out", out), []);
  assert.deepEqual(out, { removed: true });
  assert.deepEqual(h.calls("resend.domains.delete").map((c) => c.input), [{ providerDomainId: "pdm_1" }]);
  assert.deepEqual([row(h, domain.id).deleted_at, row(h, domain.id).isDefault, row(h, domain.id).verified], [NOW, 0, 0]);
  assert.equal(h.rows(`SELECT deleted_at FROM mail_route WHERE id = ?`, "rte_one")[0]!.deleted_at, NOW);
  assert.deepEqual(h.named("sending_domain.removed").map((e) => e.payload), [{ domainId: domain.id, name: "example.com" }]);
  await assert.rejects(domainGet(h.ctx, { domainId: domain.id }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(await domainRemove(h.ctx, { domainId: domain.id }), { removed: true });   // a retry is quiet
  assert.equal(h.named("sending_domain.removed").length, 1);
  assert.equal(h.calls("resend.domains.delete").length, 1);
  assert.deepEqual((await domainList(h.ctx, {})).domains, []);
  assert.deepEqual(eventErrors(h), []);
  // The name can be added again.
  assert.equal((await domainAdd(h.ctx, { name: "example.com", provider: "resend", idempotencyKey: key() })).domain.name, "example.com");
});

test("remove through Mailgun deletes the domain and each provider route; a provider that no longer knows them is fine", async () => {
  const h = setup();
  seedDomain(h, { id: "dom_mg", name: "example.com", provider: "mailgun", ref: "example.com" });
  h.ctx.db.run(`INSERT INTO mail_route (id, "domainId", "localPart", "mailboxId", provider, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, "rte_one", "dom_mg", "hello", "mbx_hello", "mailgun", 1, NOW, null);
  h.ctx.db.run(`INSERT INTO mail_route_ext ("routeId", "providerRouteId") VALUES (?, ?)`, "rte_one", "mgr_77");
  script(h, {
    "mailgun.routes.delete": () => { throw hostError(h, "validation.not_found"); },
    "mailgun.domains.delete": () => { throw hostError(h, "validation.not_found"); },
  });
  assert.deepEqual(await domainRemove(h.ctx, { domainId: "dom_mg" }), { removed: true });
  assert.deepEqual(h.calls("mailgun.routes.delete").map((c) => c.input), [{ idempotencyKey: "mail.domains.remove:dom_mg:route:rte_one", routeId: "mgr_77" }]);
  assert.deepEqual(h.calls("mailgun.domains.delete").map((c) => c.input), [{ name: "example.com" }]);
});

test("remove leaves everything as it was when the provider fails", async () => {
  const h = setup();
  seedDomain(h, { id: "dom_a", name: "example.com", ref: "pdm_1" });
  script(h, { "resend.domains.delete": () => { throw hostError(h, "provider.auth_failed"); } });
  await assert.rejects(domainRemove(h.ctx, { domainId: "dom_a" }), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(row(h, "dom_a").deleted_at, null);
  assert.equal(h.named("sending_domain.removed").length, 0);
  await assert.rejects(domainRemove(h.ctx, { domainId: "dom_nope" }), (e) => codeOf(e) === "validation.not_found");
});
