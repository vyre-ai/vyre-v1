// The Resend backend against recorded responses (spec 2.18, 2.19; ARCH 8.2): sending, delivery lookups, domains and their DNS records, health, and the
// delivery events (delivered, bounced, complained, and the rest) and inbound mail the host passes on after it has verified the signature.
import test from "node:test";
import assert from "node:assert/strict";
import {
  domainsCreate, domainsDelete, domainsGet, domainsList, domainsVerify, getEmail, health, inboundGetEmail, parseInbound, parseWebhook, receiveInbound, receiveWebhook, sendEmail,
} from "../handlers/backend.ts";
import { handlers, setResendHost } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { codeOf, contractErrors, harness, KEY, NOW, RECORDED } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const mail = (over: Partial<Parameters<typeof sendEmail>[1]> = {}): Parameters<typeof sendEmail>[1] => ({
  from: "hello@mail.vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Hi Pat", idempotencyKey: "eml_abc123", ...over,
});

// ---- resend.send_email

test("an email is posted to Resend with the key, the idempotency key and every part of it", async () => {
  const h = harness();
  h.files.set("fil_one", { name: "scan.pdf", mime: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) });
  h.on("POST /emails", { status: 200, body: RECORDED.sent });
  const input = mail({
    fromName: 'Hello "Team" <x>', cc: ["lee@acme.test"], bcc: ["boss@acme.test"], replyTo: "maya@vyre.test", html: "<p>Hi</p>", headers: { "X-Vyre-Trace": "abc", "Message-ID": "<eml_abc123@mail.vyre.test>" },
    tags: [{ name: "message_id", value: "eml_abc123" }, { name: "campaign id", value: "spring/2025" }], attachments: [{ name: "intake.pdf", fileId: "fil_one" }],
  });
  assert.deepEqual(contractErrors("resend.send_email", "in", input), []);
  const out = await sendEmail(h.ctx, input);
  assert.deepEqual(out, { providerId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  assert.deepEqual(contractErrors("resend.send_email", "out", out), []);
  const [req] = h.sent();
  assert.deepEqual([req!.method, req!.path], ["POST", "/emails"]);
  assert.deepEqual(req!.headers, { authorization: `Bearer ${KEY}`, accept: "application/json", "idempotency-key": "eml_abc123", "content-type": "application/json" });
  assert.deepEqual(req!.body, {
    from: "Hello Team x <hello@mail.vyre.test>", to: ["pat@acme.test"], subject: "Hello", cc: ["lee@acme.test"], bcc: ["boss@acme.test"], reply_to: "maya@vyre.test",
    text: "Hi Pat", html: "<p>Hi</p>", headers: { "X-Vyre-Trace": "abc", "Message-ID": "<eml_abc123@mail.vyre.test>" },
    tags: [{ name: "message_id", value: "eml_abc123" }, { name: "campaign_id", value: "spring_2025" }],
    attachments: [{ filename: "intake.pdf", content: "JVBERg==" }],
  });
});

test("a plain email carries only what it has, and the file's own name stands in for a missing one", async () => {
  const h = harness();
  h.files.set("fil_one", { name: "scan.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
  h.on("POST /emails", { status: 200, body: RECORDED.sent });
  await sendEmail(h.ctx, mail({ attachments: [{ name: "", fileId: "fil_one" }] }));
  assert.deepEqual(h.sent()[0]!.body, { from: "hello@mail.vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Hi Pat", attachments: [{ filename: "scan.pdf", content: "AQID" }] });
});

test("an email without a body is refused before Resend is asked", async () => {
  const h = harness();
  const noBody = mail();
  delete noBody.text;
  await refused(sendEmail(h.ctx, noBody), "validation.bad_input");
  assert.equal(h.sent().length, 0);
});

test("Resend's refusals map to the codes mail.send declares", async () => {
  const h = harness();
  for (const [status, code] of [[401, "provider.auth_failed"], [403, "provider.auth_failed"], [429, "provider.rate_limited"], [422, "provider.bad_response"], [400, "provider.bad_response"], [500, "provider.unavailable"]] as const) {
    h.on("POST /emails", { status, body: { name: "validation_error", message: "The sender domain is not verified: pat@acme.test", statusCode: status } });
    await assert.rejects(sendEmail(h.ctx, mail()), (e: unknown) => {
      assert.equal(codeOf(e), code, `status ${status}`);
      assert.ok(!JSON.stringify(e).includes("pat@acme.test"), "Resend's own message, which can echo an address, is not passed on");
      return true;
    });
  }
  h.on("POST /emails", { status: 200, body: {} });
  await refused(sendEmail(h.ctx, mail()), "provider.bad_response");
  h.on("POST /emails", { status: 200, body: "<html>nope" });
  await refused(sendEmail(h.ctx, mail()), "provider.bad_response");
  h.on("POST /emails", { status: 0, throws: true });
  await refused(sendEmail(h.ctx, mail()), "provider.network");
});

test("with no host registered nothing is sent and the cause is plain", async () => {
  const h = harness();
  setResendHost(null);
  await refused(sendEmail(h.ctx, mail()), "internal.unavailable");
  assert.equal(h.sent().length, 0);
});

// ---- resend.get_email

test("the delivery state of a sent email is read back", async () => {
  const h = harness();
  h.on("GET /emails/49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", { status: 200, body: RECORDED.email });
  const out = await getEmail(h.ctx, { providerId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  assert.deepEqual(out, { status: "delivered", lastEvent: "delivered", at: Date.parse("2025-10-09T08:53:20.000Z") });
  assert.deepEqual(contractErrors("resend.get_email", "out", out), []);
});

test("a delayed or unknown last event is named plainly, and a missing email is not found", async () => {
  const h = harness();
  h.on("GET /emails/a", { status: 200, body: { ...RECORDED.email, last_event: "delivery_delayed" } });
  assert.equal((await getEmail(h.ctx, { providerId: "a" })).lastEvent, "delayed");
  h.on("GET /emails/b", { status: 200, body: { id: "b", last_event: "scheduled" } });
  assert.deepEqual(await getEmail(h.ctx, { providerId: "b" }), { status: "scheduled" });
  h.on("GET /emails/c", { status: 200, body: { id: "c" } });
  assert.deepEqual(await getEmail(h.ctx, { providerId: "c" }), { status: "unknown" });
  h.on("GET /emails/gone", { status: 404, body: { name: "not_found" } });
  await refused(getEmail(h.ctx, { providerId: "gone" }), "validation.not_found");
});

// ---- domains

test("the domain list shows each domain's state from Resend's status", async () => {
  const h = harness();
  h.on("GET /domains", { status: 200, body: RECORDED.domains });
  const out = await domainsList(h.ctx);
  assert.deepEqual(out.domains.map((d) => [d.name, d.status, d.spf, d.dkim, d.dmarc, d.region]), [
    ["mail.vyre.test", "verified", "pass", "pass", "pending", "us-east-1"],
    ["send.other.test", "pending", "pending", "pending", "pending", "eu-west-1"],
    ["new.other.test", "not_started", "pending", "pending", "pending", "us-east-1"],
  ]);
  assert.deepEqual(contractErrors("resend.domains.list", "out", out), []);
});

test("a domain comes with the DNS records to publish, each with its own state", async () => {
  const h = harness();
  h.on("GET /domains/d91cd9bd-1176-453e-8fc1-35364d380206", { status: 200, body: RECORDED.domain });
  const out = await domainsGet(h.ctx, { providerDomainId: "d91cd9bd-1176-453e-8fc1-35364d380206" });
  assert.deepEqual(out.records, [
    { purpose: "spf", type: "MX", name: "send", value: "10 feedback-smtp.us-east-1.amazonses.com", state: "pass" },
    { purpose: "spf", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all", state: "pass" },
    { purpose: "dkim", type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDsc0kTest", state: "pending" },
    { purpose: "mx", type: "MX", name: "inbound", value: "10 inbound-smtp.us-east-1.amazonaws.com", state: "pending" },
  ]);
  assert.deepEqual([out.domain.status, out.domain.spf, out.domain.dkim, out.domain.dmarc], ["pending", "pass", "pending", "pending"]);
  assert.deepEqual(contractErrors("resend.domains.get", "out", out), []);
});

test("a DMARC record's state counts, and a failed record fails its group", async () => {
  const h = harness();
  h.on("GET /domains/x", { status: 200, body: RECORDED.domainVerified });
  const out = await domainsGet(h.ctx, { providerDomainId: "x" });
  assert.deepEqual([out.domain.status, out.domain.spf, out.domain.dkim, out.domain.dmarc], ["verified", "pass", "pass", "fail"]);
  assert.deepEqual(out.records.map((r) => r.purpose), ["spf", "dkim", "dmarc"]);
  h.on("GET /domains/y", { status: 200, body: { ...RECORDED.domain, id: "y", records: [{ record: "DKIM", name: "k", type: "TXT", status: "failed", value: "v" }, { record: "DKIM", name: "k2", type: "CNAME", status: "verified", value: "w" }] } });
  assert.equal((await domainsGet(h.ctx, { providerDomainId: "y" })).domain.dkim, "fail");
});

test("creating a domain returns the records, and the name must be a domain name", async () => {
  const h = harness();
  h.on("POST /domains", { status: 201, body: { ...RECORDED.domain, status: "not_started" } });
  const out = await domainsCreate(h.ctx, { name: " Mail.Vyre.test ", region: "us-east-1" });
  assert.deepEqual(h.sent()[0]!.body, { name: "mail.vyre.test", region: "us-east-1" });
  assert.equal(out.domain.status, "not_started");
  assert.equal(out.records.length, 4);
  assert.deepEqual(contractErrors("resend.domains.create", "out", out), []);
  for (const name of ["", "vyre", "mail vyre.test", "-a.vyre.test", "a..test", "x".repeat(300) + ".test"]) await refused(domainsCreate(h.ctx, { name }), "validation.bad_input");
  assert.equal(h.sent().length, 1);
});

test("a refused create is mapped, and an existing domain is a plain bad input", async () => {
  const h = harness();
  h.on("POST /domains", { status: 403, body: { name: "restricted_api_key" } });
  await refused(domainsCreate(h.ctx, { name: "mail.vyre.test" }), "provider.auth_failed");
  h.on("POST /domains", { status: 422, body: { name: "validation_error" } });
  await refused(domainsCreate(h.ctx, { name: "mail.vyre.test" }), "validation.bad_input");
});

test("asking Resend to verify posts the ask and reads the domain back", async () => {
  const h = harness();
  h.on("POST /domains/d1/verify", { status: 200, body: { object: "domain", id: "d1" } });
  h.on("GET /domains/d1", { status: 200, body: { ...RECORDED.domainVerified, id: "d1" } });
  const out = await domainsVerify(h.ctx, { providerDomainId: "d1" });
  assert.deepEqual(h.sent().map((r) => `${r.method} ${r.path}`), ["POST /domains/d1/verify", "GET /domains/d1"]);
  assert.equal(out.domain.status, "verified");
  assert.deepEqual(contractErrors("resend.domains.verify", "out", out), []);
});

test("deleting a domain asks Resend once; one that is not there is not found", async () => {
  const h = harness();
  h.on("DELETE /domains/d1", { status: 200, body: { object: "domain", id: "d1", deleted: true } });
  assert.deepEqual(await domainsDelete(h.ctx, { providerDomainId: "d1" }), { deleted: true });
  h.on("DELETE /domains/zz", { status: 404, body: { name: "not_found" } });
  await refused(domainsDelete(h.ctx, { providerDomainId: "zz" }), "validation.not_found");
});

test("a provider id with odd characters cannot change the path asked", async () => {
  const h = harness();
  h.on("GET /domains/a%2Fb%3Fc", { status: 200, body: RECORDED.domainVerified });
  await domainsGet(h.ctx, { providerDomainId: "a/b?c" });
  assert.equal(h.sent()[0]!.path, "/domains/a%2Fb%3Fc");
});

// ---- health

test("health is healthy when the key lists domains, and down or degraded for the reasons that matter", async () => {
  const h = harness();
  h.on("GET /domains?limit=1", { status: 200, body: RECORDED.domains });
  const ok = await health(h.ctx);
  assert.deepEqual(ok, { state: "healthy", latencyMs: 0 });
  assert.deepEqual(contractErrors("resend.health", "out", ok), []);
  h.on("GET /domains?limit=1", { status: 401, body: {} });
  assert.equal((await health(h.ctx)).state, "down");
  h.on("GET /domains?limit=1", { status: 429, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET /domains?limit=1", { status: 503, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET /domains?limit=1", { status: 0, throws: true });
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "Resend could not be reached." });
  setResendHost(null);
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "Resend is not set up on this server." });
});

// ---- delivery events

const hook = (type: string, data: Record<string, unknown>) => ({ type, created_at: "2025-10-09T09:00:00.000Z", data: { email_id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", from: "hello@mail.vyre.test", to: ["Pat Lee <Pat@Acme.test>"], subject: "Hello", ...data } });
const AT = Date.parse("2025-10-09T09:00:00.000Z");
const EMAIL = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";

test("a verified webhook body becomes the input of resend.receive_webhook", () => {
  assert.deepEqual(parseWebhook("evt1", hook("email.delivered", {}), NOW), { eventId: "evt1", type: "delivered", providerId: EMAIL, address: "pat@acme.test", at: AT });
  assert.deepEqual(
    parseWebhook("evt2", hook("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 mailbox does not exist" } }), NOW),
    { eventId: "evt2", type: "bounced", providerId: EMAIL, address: "pat@acme.test", bounceKind: "hard", reason: "550 5.1.1 mailbox does not exist", at: AT },
  );
  assert.deepEqual(parseWebhook("evt3", hook("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } }), NOW), {
    eventId: "evt3", type: "bounced", providerId: EMAIL, address: "pat@acme.test", bounceKind: "soft", reason: "MailboxFull", at: AT,
  });
  assert.equal(parseWebhook("evt4", hook("email.bounced", {}), NOW)!.bounceKind, "soft");
  assert.equal(parseWebhook("evt5", hook("email.complained", {}), NOW)!.type, "complained");
  assert.equal(parseWebhook("evt6", hook("email.clicked", { click: { link: "https://acme.test/a" } }), NOW)!.url, "https://acme.test/a");
  assert.equal(parseWebhook("evt7", hook("email.failed", { failed: { reason: "Sender domain not verified" } }), NOW)!.reason, "Sender domain not verified");
  assert.deepEqual(["email.sent", "email.delivery_delayed", "email.opened"].map((t) => parseWebhook("e", hook(t, {}), NOW)!.type), ["sent", "delayed", "opened"]);
  assert.equal(parseWebhook("e", { type: "email.delivered", data: { email_id: "x" } }, NOW)!.at, NOW, "a payload without a time takes the Space's");
});

test("webhooks this module does not act on, or cannot place, are left alone", () => {
  assert.equal(parseWebhook("e", hook("email.received", {}), NOW), null);
  assert.equal(parseWebhook("e", hook("contact.created", {}), NOW), null);
  assert.equal(parseWebhook("", hook("email.delivered", {}), NOW), null);
  assert.equal(parseWebhook("e", { type: "email.delivered", data: {} }, NOW), null);
  assert.equal(parseWebhook("e", "nonsense", NOW), null);
});

test("replay: delivered, bounced and complained events reach mail.status_update once each, with what mail needs", async () => {
  const h = harness();
  const events = [
    parseWebhook("evt-d", hook("email.delivered", {}), NOW)!,
    parseWebhook("evt-b", hook("email.bounced", { bounce: { type: "Permanent", message: "mailbox does not exist" } }), NOW)!,
    parseWebhook("evt-c", hook("email.complained", {}), NOW)!,
  ];
  for (const e of events) {
    assert.deepEqual(contractErrors("resend.receive_webhook", "in", e), []);
    assert.deepEqual(await receiveWebhook(h.ctx, e), { accepted: true });
  }
  assert.deepEqual(h.calls("mail.status_update").map((c) => c.input), [
    { providerId: EMAIL, status: "delivered", address: "pat@acme.test", at: AT },
    { providerId: EMAIL, status: "bounced", kind: "hard", reason: "mailbox does not exist", address: "pat@acme.test", at: AT },
    { providerId: EMAIL, status: "complained", address: "pat@acme.test", at: AT },
  ]);
  assert.deepEqual(h.named("resend.event_received").map((e) => [e.subject, e.payload]), [
    ["entity/evt-d", { eventId: "evt-d", type: "delivered", providerId: EMAIL }], ["entity/evt-b", { eventId: "evt-b", type: "bounced", providerId: EMAIL }],
    ["entity/evt-c", { eventId: "evt-c", type: "complained", providerId: EMAIL }],
  ]);
  assert.deepEqual(h.rows(`SELECT * FROM resend_event_log`).map((r) => [r.eventId, r.appliedAs]), [["evt-d", "delivered"], ["evt-b", "bounced"], ["evt-c", "complained"]]);
});

test("replay: opened and clicked events carry the link; sent and delayed are recorded and not applied", async () => {
  const h = harness();
  await receiveWebhook(h.ctx, parseWebhook("evt-o", hook("email.opened", {}), NOW)!);
  await receiveWebhook(h.ctx, parseWebhook("evt-k", hook("email.clicked", { click: { link: "https://acme.test/a" } }), NOW)!);
  await receiveWebhook(h.ctx, parseWebhook("evt-s", hook("email.sent", {}), NOW)!);
  await receiveWebhook(h.ctx, parseWebhook("evt-l", hook("email.delivery_delayed", {}), NOW)!);
  assert.deepEqual(h.calls("mail.status_update").map((c) => [c.input.status, c.input.url]), [["opened", undefined], ["clicked", "https://acme.test/a"]]);
  assert.equal(h.named("resend.event_received").length, 4);
  assert.equal(h.rows(`SELECT * FROM resend_event_log`).length, 4);
});

test("an event Svix delivers twice is applied once and announced once", async () => {
  const h = harness();
  const e = parseWebhook("evt-b", hook("email.bounced", { bounce: { type: "Permanent" } }), NOW)!;
  await receiveWebhook(h.ctx, e);
  assert.deepEqual(await receiveWebhook(h.ctx, e), { accepted: true });
  assert.equal(h.calls("mail.status_update").length, 1);
  assert.equal(h.named("resend.event_received").length, 1);
});

test("when mail cannot apply an event nothing is recorded, so Resend's retry applies it", async () => {
  const h = harness();
  const e = parseWebhook("evt-d", hook("email.delivered", {}), NOW)!;
  h.failStatusUpdates(true);
  await refused(receiveWebhook(h.ctx, e), "internal.unavailable");
  assert.equal(h.rows(`SELECT * FROM resend_event_log`).length, 0);
  h.failStatusUpdates(false);
  await receiveWebhook(h.ctx, e);
  assert.equal(h.calls("mail.status_update").length, 2);
  assert.equal(h.rows(`SELECT * FROM resend_event_log`).length, 1);
});

test("an event without its ids is refused", async () => {
  const h = harness();
  await refused(receiveWebhook(h.ctx, { eventId: "", type: "delivered", providerId: "x", at: NOW }), "validation.bad_input");
  await refused(receiveWebhook(h.ctx, { eventId: "e", type: "delivered", providerId: "", at: NOW }), "validation.bad_input");
});

// ---- inbound mail

test("the inbound webhook body names the email and the address it came in on", () => {
  assert.deepEqual(parseInbound({ type: "email.received", data: { email_id: "e1", to: ["Hello <Hello@Mail.Vyre.test>"] } }), { emailId: "e1", route: "hello@mail.vyre.test" });
  assert.deepEqual(parseInbound({ type: "email.received", data: { email_id: "e1" } }), { emailId: "e1" });
  assert.equal(parseInbound({ type: "email.delivered", data: { email_id: "e1" } }), null);
  assert.equal(parseInbound({ type: "email.received", data: {} }), null);
});

test("an inbound email is fetched, its attachments stored as blobs, and landed with mail.ingest", async () => {
  const h = harness();
  const id = RECORDED.inbound.id;
  h.on(`GET /emails/receiving/${id}`, { status: 200, body: RECORDED.inbound });
  h.on(`GET /emails/receiving/${id}/attachments/att-2`, { status: 200, body: RECORDED.attachment });
  const out = await receiveInbound(h.ctx, { emailId: id, route: "Hello@mail.vyre.test" });
  assert.deepEqual(out, { accepted: true, messageId: "eml_inbound1" });
  assert.deepEqual(contractErrors("resend.receive_inbound", "out", out), []);
  assert.deepEqual(h.downloads, [
    { url: "https://inbound-cdn.resend.test/att-1?sig=abc", mime: "application/pdf" }, { url: "https://inbound-cdn.resend.test/att-2?sig=def", mime: "image/jpeg" },
  ]);
  assert.deepEqual(h.calls("mail.ingest").map((c) => c.input), [{
    source: "resend", providerId: id, rfcMessageId: "<CAFx123@mail.acme.test>", direction: "in", from: { address: "pat@acme.test", name: "Pat Lee" },
    to: [{ address: "hello@mail.vyre.test", name: "Hello" }], subject: "Question about my case", receivedAt: Date.parse("2025-10-09T08:50:00.000Z"), envelopeTo: "hello@mail.vyre.test",
    text: "Can we talk Friday?", html: "<p>Can we talk Friday?</p>", headers: { "in-reply-to": "<prev@mail.vyre.test>", "x-mailer": "Test" },
    attachments: [{ name: "intake.pdf", mime: "application/pdf", size: 1001, blobId: "blb_1" }, { name: "photo.jpg", mime: "image/jpeg", size: 1002, blobId: "blb_2" }],
  }]);
  assert.deepEqual(h.named("resend.inbound_received").map((e) => [e.subject, e.payload]), [[`entity/${id}`, { emailId: id, route: "hello@mail.vyre.test" }]]);
  assert.deepEqual(h.rows(`SELECT * FROM resend_inbound_log`).map((r) => [r.emailId, r.messageId, r.route]), [[id, "eml_inbound1", "hello@mail.vyre.test"]]);
});

test("a repeated inbound delivery lands once and answers with the message it made", async () => {
  const h = harness();
  const id = RECORDED.inbound.id;
  h.on(`GET /emails/receiving/${id}`, { status: 200, body: { ...RECORDED.inbound, attachments: [] } });
  await receiveInbound(h.ctx, { emailId: id });
  const before = h.requests.length;
  assert.deepEqual(await receiveInbound(h.ctx, { emailId: id }), { accepted: true, messageId: "eml_inbound1" });
  assert.equal(h.requests.length, before, "nothing is fetched again");
  assert.equal(h.calls("mail.ingest").length, 1);
  assert.equal(h.named("resend.inbound_received").length, 1);
});

test("with no route given the first address it was sent to is the one the mailbox is looked up by", async () => {
  const h = harness();
  const id = RECORDED.inbound.id;
  h.on(`GET /emails/receiving/${id}`, { status: 200, body: { ...RECORDED.inbound, attachments: [], headers: undefined, message_id: undefined, text: undefined, html: undefined } });
  await receiveInbound(h.ctx, { emailId: id, route: "not an address" });
  const sent = h.calls("mail.ingest")[0]!.input;
  assert.equal(sent.envelopeTo, "hello@mail.vyre.test");
  assert.equal(sent.rfcMessageId, `<${id}@inbound.resend.test>`);
  assert.deepEqual(["text", "html", "headers", "attachments"].filter((k) => k in sent), []);
});

test("inbound mail Resend does not have is not found, and an id is required", async () => {
  const h = harness();
  h.on("GET /emails/receiving/zz", { status: 404, body: {} });
  await refused(receiveInbound(h.ctx, { emailId: "zz" }), "validation.not_found");
  await refused(receiveInbound(h.ctx, { emailId: "" }), "validation.bad_input");
  assert.equal(h.rows(`SELECT * FROM resend_inbound_log`).length, 0, "a failed fetch is retried, not remembered");
});

test("resend.inbound.get_email reads an inbound email without landing it", async () => {
  const h = harness();
  const id = RECORDED.inbound.id;
  h.on(`GET /emails/receiving/${id}`, { status: 200, body: { ...RECORDED.inbound, attachments: [] } });
  const out = await inboundGetEmail(h.ctx, { emailId: id });
  assert.deepEqual(contractErrors("resend.inbound.get_email", "out", out), []);
  assert.deepEqual([out.from, out.to, out.subject, out.messageId], ["Pat Lee <pat@acme.test>", ["Hello <hello@mail.vyre.test>"], "Question about my case", "<CAFx123@mail.acme.test>"]);
  assert.equal(h.calls("mail.ingest").length, 0);
});

// ---- the module entry

test("the handler map covers exactly the capabilities of the manifest and runs through the host signature", async () => {
  const declared = registry.capabilities.filter((c) => c.module === "resend").map((c) => c.name).sort();
  assert.equal(declared.length, 12);
  assert.deepEqual(Object.keys(handlers).sort(), declared);
  const h: Harness = harness();
  h.on("GET /domains", { status: 200, body: RECORDED.domains });
  const asHost = h.ctx as unknown as Parameters<(typeof handlers)[string]>[0];
  assert.equal(((await handlers["resend.domains.list"]!(asHost, {})) as { domains: unknown[] }).domains.length, 3);
});
