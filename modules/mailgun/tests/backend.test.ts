// The Mailgun backend against recorded responses (spec 2.18, 2.19; ARCH 8.2): sending, delivery event lookups, domains and their DNS records, routes,
// health, and the delivery events and inbound mail the host passes on after it has verified the signature.
import test from "node:test";
import assert from "node:assert/strict";
import {
  domainsCreate, domainsDelete, domainsGet, domainsList, domainsVerify, eventsList, health, parseInbound, parseWebhook, receiveInbound, receiveWebhook, routesCreate, routesDelete,
  routesList, sendEmail,
} from "../handlers/backend.ts";
import { handlers, setMailgunHost } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { BASIC, codeOf, contractErrors, harness, NOW, PUBLIC_URL, RECORDED } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const PROVIDER_ID = "20251009085320.1.ABCDEF0123456789@mail.vyre.test";
const mail = (over: Partial<Parameters<typeof sendEmail>[1]> = {}): Parameters<typeof sendEmail>[1] => ({
  domain: "mail.vyre.test", from: "hello@mail.vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Hi Pat", idempotencyKey: "eml_abc123", ...over,
});

// ---- mailgun.send_email

test("an email is posted to the domain's messages with the key, one field per part, and the bare Message-Id comes back", async () => {
  const h = harness();
  h.on("POST /v3/mail.vyre.test/messages", { status: 200, body: RECORDED.sent });
  const input = mail({
    fromName: 'Hello "Team" <x>', to: ["pat@acme.test", "lee@acme.test"], cc: ["boss@acme.test"], bcc: ["audit@acme.test"], replyTo: "maya@vyre.test", html: "<p>Hi</p>",
    headers: { "X-Vyre-Trace": "abc", "Message-ID": "<eml_abc123@mail.vyre.test>" }, tags: ["message_id:eml_abc123", "campaign_id:cmp_spring", "a", "dropped-fourth"],
  });
  assert.deepEqual(contractErrors("mailgun.send_email", "in", input), []);
  const out = await sendEmail(h.ctx, input);
  assert.deepEqual(out, { providerId: PROVIDER_ID });
  assert.deepEqual(contractErrors("mailgun.send_email", "out", out), []);
  const [req] = h.requests;
  assert.deepEqual([req!.method, req!.base, req!.path], ["POST", "https://api.mailgun.net", "/v3/mail.vyre.test/messages"]);
  assert.deepEqual(req!.headers, { authorization: BASIC, accept: "application/json", "content-type": "application/x-www-form-urlencoded" });
  assert.deepEqual(req!.form, [
    ["from", "Hello Team x <hello@mail.vyre.test>"], ["subject", "Hello"], ["to", "pat@acme.test"], ["to", "lee@acme.test"], ["cc", "boss@acme.test"], ["bcc", "audit@acme.test"],
    ["h:Reply-To", "maya@vyre.test"], ["text", "Hi Pat"], ["html", "<p>Hi</p>"], ["h:X-Vyre-Trace", "abc"], ["h:Message-ID", "<eml_abc123@mail.vyre.test>"],
    ["o:tag", "message_id:eml_abc123"], ["o:tag", "campaign_id:cmp_spring"], ["o:tag", "a"],
  ]);
});

test("the Space's region picks the host", async () => {
  const h = harness({ region: "eu" });
  h.on("POST /v3/mail.vyre.test/messages", { status: 200, body: RECORDED.sent });
  await sendEmail(h.ctx, mail());
  assert.equal(h.requests[0]!.base, "https://api.eu.mailgun.net");
  assert.equal(h.calls("settings.get")[0]!.input.key, "mailgun.region");
});

test("an email with attachments goes up as a multipart form through the host, with the same fields", async () => {
  const h = harness();
  const out = await sendEmail(h.ctx, mail({ attachments: [{ name: "intake.pdf", fileId: "fil_one" }], tags: ["t1"] }));
  assert.equal(out.providerId, PROVIDER_ID);
  assert.equal(h.requests.length, 0, "ctx.http carries text only");
  assert.deepEqual(h.uploads, [{
    url: "https://api.mailgun.net/v3/mail.vyre.test/messages", fields: [["from", "hello@mail.vyre.test"], ["subject", "Hello"], ["to", "pat@acme.test"], ["text", "Hi Pat"], ["o:tag", "t1"]],
    files: [{ field: "attachment", name: "intake.pdf", fileId: "fil_one" }],
  }]);
  h.uploadAnswers({ status: 401, text: "{}" });
  await refused(sendEmail(h.ctx, mail({ attachments: [{ name: "a.pdf", fileId: "fil_one" }] })), "provider.auth_failed");
  h.uploadAnswers({ status: 200, text: "not json" });
  await refused(sendEmail(h.ctx, mail({ attachments: [{ name: "a.pdf", fileId: "fil_one" }] })), "provider.bad_response");
});

test("an email without a body, or for a domain that is not one, is refused before Mailgun is asked", async () => {
  const h = harness();
  const noBody = mail();
  delete noBody.text;
  await refused(sendEmail(h.ctx, noBody), "validation.bad_input");
  await refused(sendEmail(h.ctx, mail({ domain: "not a domain" })), "validation.bad_input");
  await refused(sendEmail(h.ctx, mail({ domain: "../v3/domains" })), "validation.bad_input");
  assert.equal(h.requests.length + h.uploads.length, 0);
});

test("Mailgun's refusals map to the codes mail.send declares, and its own words are not passed on", async () => {
  const h = harness();
  for (const [status, code] of [[401, "provider.auth_failed"], [403, "provider.auth_failed"], [429, "provider.rate_limited"], [400, "provider.bad_response"], [402, "provider.bad_response"], [500, "provider.unavailable"]] as const) {
    h.on("POST /v3/mail.vyre.test/messages", { status, body: { message: "Domain mail.vyre.test is not allowed to send: pat@acme.test" } });
    await assert.rejects(sendEmail(h.ctx, mail()), (e: unknown) => {
      assert.equal(codeOf(e), code, `status ${status}`);
      assert.ok(!JSON.stringify(e).includes("pat@acme.test"));
      return true;
    });
  }
  h.on("POST /v3/mail.vyre.test/messages", { status: 200, body: { message: "Queued." } });
  await refused(sendEmail(h.ctx, mail()), "provider.bad_response");
  h.on("POST /v3/mail.vyre.test/messages", { status: 0, throws: true });
  await refused(sendEmail(h.ctx, mail()), "provider.network");
  setMailgunHost(null);
  await refused(sendEmail(h.ctx, mail()), "internal.unavailable");
});

// ---- mailgun.events.list

test("delivery events are read for a domain and turned into the module's own shape", async () => {
  const h = harness();
  h.on("GET /v3/mail.vyre.test/events?limit=100&ascending=yes", { status: 200, body: RECORDED.events });
  const out = await eventsList(h.ctx, { domain: "mail.vyre.test" });
  assert.deepEqual(out.events, [
    { eventId: "ev-accepted", event: "accepted", providerId: PROVIDER_ID, address: "pat@acme.test", at: 1_760_000_000_123 },
    { eventId: "ev-delivered", event: "delivered", providerId: PROVIDER_ID, address: "pat@acme.test", at: 1_760_000_001_500 },
    { eventId: "ev-failed", event: "failed", providerId: "y", address: "gone@acme.test", at: 1_760_000_003_000 },
  ]);
  assert.equal(out.nextPageToken, "/v3/mail.vyre.test/events/W3siYiI6IjIwMjUifV0=?limit=100");
  assert.deepEqual(contractErrors("mailgun.events.list", "out", out), []);
});

test("the next page is read by its token, and an empty page ends the list", async () => {
  const h = harness();
  h.on("GET /v3/mail.vyre.test/events/W3siYiI6IjIwMjUifV0=?limit=100", { status: 200, body: RECORDED.eventsLast });
  const out = await eventsList(h.ctx, { domain: "mail.vyre.test", pageToken: "/v3/mail.vyre.test/events/W3siYiI6IjIwMjUifV0=?limit=100" });
  assert.deepEqual(out, { events: [] });
  await refused(eventsList(h.ctx, { domain: "mail.vyre.test", pageToken: "/v3/domains/mail.vyre.test" }), "validation.bad_input");
  await refused(eventsList(h.ctx, { domain: "mail.vyre.test", pageToken: "/v3/other.test/events/x" }), "validation.bad_input");
});

test("events can be asked for by message, kind and time", async () => {
  const h = harness();
  const asked = new URLSearchParams({ limit: "100", ascending: "yes", "message-id": PROVIDER_ID, event: "delivered", begin: String(NOW / 1000) }).toString();
  h.on(`GET /v3/mail.vyre.test/events?${asked}`, { status: 200, body: { items: [] } });
  assert.deepEqual(await eventsList(h.ctx, { domain: "mail.vyre.test", providerId: `<${PROVIDER_ID}>`, event: "delivered", since: NOW }), { events: [] });
  h.on("GET /v3/mail.vyre.test/events?limit=100&ascending=yes", { status: 404, body: {} });
  await refused(eventsList(h.ctx, { domain: "mail.vyre.test" }), "validation.not_found");
});

// ---- domains

test("the domain list shows each domain's state", async () => {
  const h = harness();
  h.on("GET /v4/domains?limit=1000", { status: 200, body: RECORDED.domains });
  const out = await domainsList(h.ctx);
  assert.deepEqual(out.domains.map((d) => [d.name, d.state, d.spf, d.dkim, d.dmarc, d.region]), [
    ["mail.vyre.test", "active", "pass", "pass", "pending", "us"], ["send.other.test", "unverified", "pending", "pending", "pending", "us"], ["old.other.test", "disabled", "pending", "pending", "pending", "us"],
  ]);
  assert.deepEqual(contractErrors("mailgun.domains.list", "out", out), []);
});

test("a domain comes with the DNS records to publish, each with its own state", async () => {
  const h = harness();
  h.on("GET /v4/domains/mail.vyre.test", { status: 200, body: RECORDED.domain });
  const out = await domainsGet(h.ctx, { name: "mail.vyre.test" });
  assert.deepEqual(out.records, [
    { purpose: "spf", type: "TXT", name: "mail.vyre.test", value: "v=spf1 include:mailgun.org ~all", state: "pass" },
    { purpose: "dkim", type: "TXT", name: "smtp._domainkey.mail.vyre.test", value: "k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCtest", state: "pending" },
    { purpose: "verify", type: "CNAME", name: "email.mail.vyre.test", value: "mailgun.org", state: "pass" },
    { purpose: "mx", type: "MX", name: "mail.vyre.test", value: "10 mxa.mailgun.org", state: "pending" },
    { purpose: "mx", type: "MX", name: "mail.vyre.test", value: "10 mxb.mailgun.org", state: "pending" },
  ]);
  assert.deepEqual(out.domain, { name: "mail.vyre.test", state: "unverified", spf: "pass", dkim: "pending", dmarc: "pending", region: "us" });
  assert.deepEqual(contractErrors("mailgun.domains.get", "out", out), []);
});

test("a DMARC record's state counts for the domain", async () => {
  const h = harness();
  h.on("GET /v4/domains/mail.vyre.test", { status: 200, body: RECORDED.domainActive });
  const out = await domainsGet(h.ctx, { name: "Mail.Vyre.test" });
  assert.deepEqual([out.domain.state, out.domain.spf, out.domain.dkim, out.domain.dmarc], ["active", "pass", "pass", "fail"]);
  assert.deepEqual(out.records.map((r) => r.purpose), ["spf", "dkim", "dmarc", "mx"]);
});

test("creating a domain posts its name to the region asked for and returns the records", async () => {
  const h = harness();
  h.on("POST /v4/domains", { status: 200, body: RECORDED.domain });
  const out = await domainsCreate(h.ctx, { name: " Mail.Vyre.test ", region: "eu" });
  assert.deepEqual([h.requests[0]!.base, h.requests[0]!.form], ["https://api.eu.mailgun.net", [["name", "mail.vyre.test"]]]);
  assert.equal(out.domain.region, "eu");
  assert.equal(out.records.length, 5);
  assert.deepEqual(contractErrors("mailgun.domains.create", "out", out), []);
  await refused(domainsCreate(h.ctx, { name: "vyre" }), "validation.bad_input");
  await refused(domainsCreate(h.ctx, { name: "mail.vyre.test", region: "asia" as unknown as "us" }), "validation.bad_input");
  h.on("POST /v4/domains", { status: 400, body: {} });
  await refused(domainsCreate(h.ctx, { name: "mail.vyre.test" }), "validation.bad_input");
  assert.equal(h.requests.length, 2);
});

test("asking Mailgun to verify returns the domain as it stands after the check", async () => {
  const h = harness();
  h.on("PUT /v4/domains/mail.vyre.test/verify", { status: 200, body: RECORDED.domainActive });
  const out = await domainsVerify(h.ctx, { name: "mail.vyre.test" });
  assert.equal(out.domain.state, "active");
  assert.deepEqual(contractErrors("mailgun.domains.verify", "out", out), []);
  assert.equal(h.requests.length, 1);
});

test("deleting a domain asks Mailgun once; a domain that is not there is not found", async () => {
  const h = harness();
  h.on("DELETE /v3/domains/mail.vyre.test", { status: 200, body: { message: "Domain has been deleted" } });
  assert.deepEqual(await domainsDelete(h.ctx, { name: "mail.vyre.test" }), { deleted: true });
  h.on("DELETE /v3/domains/gone.vyre.test", { status: 404, body: {} });
  await refused(domainsDelete(h.ctx, { name: "gone.vyre.test" }), "validation.not_found");
});

// ---- routes

test("routes are listed with the addresses they forward to", async () => {
  const h = harness();
  h.on("GET /v3/routes?limit=100&skip=0", { status: 200, body: RECORDED.routes });
  const out = await routesList(h.ctx);
  assert.deepEqual(out.routes, [
    { routeId: "5f6e8c1a0b2d3e4f5a6b7c8d", expression: 'match_recipient("hello@mail.vyre.test")', forwardTo: ["https://space.example.test/hooks/mail/mailgun"], priority: 0, description: "hello@" },
    { routeId: "5f6e8c1a0b2d3e4f5a6b7c8e", expression: 'match_recipient(".*@old.vyre.test")', forwardTo: ["ops@vyre.test"], priority: 10 },
  ]);
  assert.deepEqual(contractErrors("mailgun.routes.list", "out", out), []);
});

test("a long list of routes is read page by page", async () => {
  const h = harness();
  h.on("GET /v3/routes?limit=100&skip=0", { status: 200, body: { total_count: 3, items: RECORDED.routes.items } });
  h.on("GET /v3/routes?limit=100&skip=2", { status: 200, body: { total_count: 3, items: [{ id: "abc123", expression: "catch_all()", actions: ["stop()"], priority: 99 }] } });
  const out = await routesList(h.ctx);
  assert.deepEqual(out.routes.map((r) => r.routeId), ["5f6e8c1a0b2d3e4f5a6b7c8d", "5f6e8c1a0b2d3e4f5a6b7c8e", "abc123"]);
  assert.deepEqual(out.routes[2]!.forwardTo, []);
});

test("a route forwards inbound mail to this Space's hook, keeps a stored copy, and stops", async () => {
  const h = harness();
  h.on("POST /v3/routes", { status: 200, body: RECORDED.routeCreated });
  const input = { expression: 'match_recipient("support@mail.vyre.test")', priority: 0, description: "Support" };
  assert.deepEqual(contractErrors("mailgun.routes.create", "in", input), []);
  const out = await routesCreate(h.ctx, input);
  assert.deepEqual(h.requests[0]!.form, [
    ["priority", "0"], ["expression", 'match_recipient("support@mail.vyre.test")'], ["action", `forward("${PUBLIC_URL}/hooks/mail/mailgun")`], ["action", "store()"], ["action", "stop()"], ["description", "Support"],
  ]);
  assert.deepEqual(out.route, { routeId: "6a7b8c9d0e1f2a3b4c5d6e7f", expression: 'match_recipient("support@mail.vyre.test")', forwardTo: [`${PUBLIC_URL}/hooks/mail/mailgun`], priority: 0, description: "Support" });
  assert.deepEqual(contractErrors("mailgun.routes.create", "out", out), []);
});

test("a route needs an expression and sane numbers, and deleting one asks Mailgun once", async () => {
  const h = harness();
  await refused(routesCreate(h.ctx, { expression: "  " }), "validation.bad_input");
  await refused(routesCreate(h.ctx, { expression: "x".repeat(1001) }), "validation.bad_input");
  await refused(routesCreate(h.ctx, { expression: "catch_all()", priority: -1 }), "validation.bad_input");
  await refused(routesCreate(h.ctx, { expression: "catch_all()", priority: 1.5 }), "validation.bad_input");
  await refused(routesCreate(h.ctx, { expression: "catch_all()", description: "x".repeat(201) }), "validation.bad_input");
  assert.equal(h.requests.length, 0);
  h.on("DELETE /v3/routes/6a7b8c9d0e1f2a3b4c5d6e7f", { status: 200, body: { message: "Route has been deleted", id: "6a7b8c9d0e1f2a3b4c5d6e7f" } });
  assert.deepEqual(await routesDelete(h.ctx, { routeId: "6a7b8c9d0e1f2a3b4c5d6e7f" }), { deleted: true });
  await refused(routesDelete(h.ctx, { routeId: "../domains" }), "validation.bad_input");
});

// ---- health

test("health follows the key and the domain's state", async () => {
  const h = harness();
  h.on("GET /v4/domains?limit=1", { status: 200, body: RECORDED.domains });
  const ok = await health(h.ctx, {});
  assert.deepEqual(ok, { state: "healthy", latencyMs: 0 });
  assert.deepEqual(contractErrors("mailgun.health", "out", ok), []);
  h.on("GET /v4/domains/mail.vyre.test", { status: 200, body: RECORDED.domainActive });
  assert.equal((await health(h.ctx, { domain: "mail.vyre.test" })).state, "healthy");
  h.on("GET /v4/domains/mail.vyre.test", { status: 200, body: RECORDED.domain });
  assert.equal((await health(h.ctx, { domain: "mail.vyre.test" })).state, "degraded");
  h.on("GET /v4/domains/mail.vyre.test", { status: 200, body: { domain: { name: "mail.vyre.test", state: "disabled" } } });
  assert.equal((await health(h.ctx, { domain: "mail.vyre.test" })).state, "down");
  for (const [status, state] of [[401, "down"], [403, "down"], [404, "down"], [429, "degraded"], [500, "degraded"]] as const) {
    h.on("GET /v4/domains?limit=1", { status, body: {} });
    assert.equal((await health(h.ctx, {})).state, state, `status ${status}`);
  }
  h.on("GET /v4/domains?limit=1", { status: 0, throws: true });
  assert.deepEqual(await health(h.ctx, {}), { state: "down", detail: "Mailgun could not be reached." });
  setMailgunHost(null);
  assert.deepEqual(await health(h.ctx, {}), { state: "down", detail: "Mailgun is not set up on this server." });
});

// ---- delivery events

const hook = (event: string, extra: Record<string, unknown> = {}, id = "ev1") => ({
  signature: { timestamp: "1760000100", token: "t", signature: "s" },
  "event-data": { id, event, timestamp: 1_760_000_100.5, recipient: "Pat@Acme.test", message: { headers: { "message-id": "abc@mail.vyre.test" } }, ...extra },
});
const AT = 1_760_000_100_500;

test("a verified webhook body becomes the input of mailgun.receive_webhook", () => {
  assert.deepEqual(parseWebhook(hook("delivered"), NOW), { eventId: "ev1", event: "delivered", providerId: "abc@mail.vyre.test", address: "pat@acme.test", at: AT });
  assert.deepEqual(
    parseWebhook(hook("failed", { severity: "permanent", reason: "bounce", "delivery-status": { code: 550, message: "550 5.1.1 mailbox unavailable", description: "" } }), NOW),
    { eventId: "ev1", event: "failed", providerId: "abc@mail.vyre.test", address: "pat@acme.test", severity: "permanent", reason: "550 5.1.1 mailbox unavailable", at: AT },
  );
  assert.deepEqual(parseWebhook(hook("failed", { severity: "temporary", "delivery-status": { message: "", description: "Mailbox full" } }), NOW)!.reason, "Mailbox full");
  assert.equal(parseWebhook(hook("failed", { reason: "suppress-bounce" }), NOW)!.reason, "suppress-bounce");
  assert.equal(parseWebhook(hook("clicked", { url: "https://acme.test/a" }), NOW)!.url, "https://acme.test/a");
  assert.equal(parseWebhook(hook("delivered", { url: "https://acme.test/a" }), NOW)!.url, undefined);
  assert.deepEqual(["accepted", "opened", "complained", "unsubscribed"].map((e) => parseWebhook(hook(e), NOW)!.event), ["accepted", "opened", "complained", "unsubscribed"]);
  assert.equal(parseWebhook({ "event-data": { id: "e", event: "delivered", message: { headers: { "message-id": "<x@y.test>" } } } }, NOW)!.at, NOW, "a payload without a time takes the Space's");
  assert.equal(parseWebhook({ "event-data": { id: "e", event: "delivered", message: { headers: { "message-id": "<x@y.test>" } } } }, NOW)!.providerId, "x@y.test");
});

test("webhooks this module does not act on, or cannot place, are left alone", () => {
  assert.equal(parseWebhook(hook("stored"), NOW), null);
  assert.equal(parseWebhook(hook("rejected"), NOW), null);
  assert.equal(parseWebhook(hook("delivered", { message: {} }), NOW), null);
  assert.equal(parseWebhook(hook("delivered", {}, ""), NOW), null);
  assert.equal(parseWebhook({}, NOW), null);
  assert.equal(parseWebhook("nonsense", NOW), null);
});

test("replay: delivered, permanent and temporary failures, complaints, opens and clicks reach mail.status_update once each", async () => {
  const h = harness();
  const events = [
    parseWebhook(hook("delivered", {}, "e-del"), NOW)!,
    parseWebhook(hook("failed", { severity: "permanent", "delivery-status": { message: "550 mailbox unavailable" } }, "e-perm"), NOW)!,
    parseWebhook(hook("failed", { severity: "temporary", "delivery-status": { message: "452 mailbox full" } }, "e-temp"), NOW)!,
    parseWebhook(hook("complained", {}, "e-comp"), NOW)!,
    parseWebhook(hook("opened", {}, "e-open"), NOW)!,
    parseWebhook(hook("clicked", { url: "https://acme.test/a" }, "e-click"), NOW)!,
  ];
  for (const e of events) {
    assert.deepEqual(contractErrors("mailgun.receive_webhook", "in", e), []);
    assert.deepEqual(await receiveWebhook(h.ctx, e), { accepted: true });
  }
  const base = { providerId: "abc@mail.vyre.test", address: "pat@acme.test", at: AT };
  assert.deepEqual(h.calls("mail.status_update").map((c) => c.input), [
    { ...base, status: "delivered" },
    { ...base, status: "bounced", kind: "hard", reason: "550 mailbox unavailable" },
    { ...base, status: "bounced", kind: "soft", reason: "452 mailbox full" },
    { ...base, status: "complained" },
    { ...base, status: "opened" },
    { ...base, status: "clicked", url: "https://acme.test/a" },
  ]);
  assert.equal(h.named("mailgun.event_received").length, 6);
  assert.deepEqual(h.rows(`SELECT * FROM mailgun_event_log`).map((r) => [r.eventId, r.appliedAs]), [
    ["e-del", "delivered"], ["e-perm", "bounced"], ["e-temp", "bounced"], ["e-comp", "complained"], ["e-open", "opened"], ["e-click", "clicked"],
  ]);
});

test("a failure with no severity is a plain failure, and accepted is recorded and not applied", async () => {
  const h = harness();
  await receiveWebhook(h.ctx, { eventId: "e1", event: "failed", providerId: "abc@mail.vyre.test", at: AT });
  await receiveWebhook(h.ctx, { eventId: "e2", event: "accepted", providerId: "abc@mail.vyre.test", at: AT });
  assert.deepEqual(h.calls("mail.status_update").map((c) => c.input), [{ providerId: "abc@mail.vyre.test", at: AT, status: "failed" }]);
  assert.equal(h.rows(`SELECT * FROM mailgun_event_log`).length, 2);
});

test("an unsubscribe event suppresses the address through contacts, once", async () => {
  const h = harness();
  const e = parseWebhook(hook("unsubscribed", {}, "e-unsub"), NOW)!;
  await receiveWebhook(h.ctx, e);
  await receiveWebhook(h.ctx, e);
  assert.deepEqual(h.calls("contacts.apply_optout").map((c) => c.input), [{ channel: "email", address: "pat@acme.test", keyword: "unsubscribe", source: "email_unsubscribe", at: AT }]);
  assert.equal(h.calls("mail.status_update").length, 0);
  await receiveWebhook(h.ctx, { eventId: "e-anon", event: "unsubscribed", providerId: "abc@mail.vyre.test", at: AT });
  assert.equal(h.calls("contacts.apply_optout").length, 1, "no address, nothing to suppress");
  assert.equal(h.rows(`SELECT * FROM mailgun_event_log`).length, 2);
});

test("an event Mailgun delivers twice is applied once and announced once", async () => {
  const h = harness();
  const e = parseWebhook(hook("complained", {}, "e-comp"), NOW)!;
  await receiveWebhook(h.ctx, e);
  assert.deepEqual(await receiveWebhook(h.ctx, e), { accepted: true });
  assert.equal(h.calls("mail.status_update").length, 1);
  assert.equal(h.named("mailgun.event_received").length, 1);
});

test("when mail cannot apply an event nothing is recorded, so Mailgun's retry applies it", async () => {
  const h = harness();
  const e = parseWebhook(hook("delivered", {}, "e-del"), NOW)!;
  h.failStatusUpdates(true);
  await refused(receiveWebhook(h.ctx, e), "internal.unavailable");
  assert.equal(h.rows(`SELECT * FROM mailgun_event_log`).length, 0);
  h.failStatusUpdates(false);
  await receiveWebhook(h.ctx, e);
  assert.equal(h.calls("mail.status_update").length, 2);
  await refused(receiveWebhook(h.ctx, { eventId: "", event: "delivered", providerId: "x", at: AT }), "validation.bad_input");
  await refused(receiveWebhook(h.ctx, { eventId: "e", event: "delivered", providerId: "", at: AT }), "validation.bad_input");
});

// ---- inbound mail

test("the inbound route post names the message and the address it came in on", () => {
  assert.deepEqual(parseInbound({ recipient: "Hello@Mail.Vyre.test", sender: "Pat@Acme.test", "Message-Id": "<CAFx123@mail.acme.test>", subject: "x" }), {
    messageId: "CAFx123@mail.acme.test", recipient: "hello@mail.vyre.test", sender: "pat@acme.test",
  });
  assert.equal(parseInbound({ recipient: "hello@mail.vyre.test", "message-id": "abc@y.test", from: "Pat <pat@acme.test>" })!.sender, "pat@acme.test");
  assert.equal(parseInbound({ recipient: "hello@mail.vyre.test" }), null);
  assert.equal(parseInbound({ "Message-Id": "<a@b.test>" }), null);
});

const STORED_EVENT = "GET /v3/mail.vyre.test/events?event=stored&message-id=CAFx123%40mail.acme.test&limit=1";

test("an inbound email is read from Mailgun's stored copy, its attachments stored as blobs, and landed with mail.ingest", async () => {
  const h = harness();
  h.on(STORED_EVENT, { status: 200, body: RECORDED.storedEvent });
  h.on("GET /v3/domains/mail.vyre.test/messages/KEY123", { status: 200, body: RECORDED.stored });
  const out = await receiveInbound(h.ctx, { messageId: "<CAFx123@mail.acme.test>", recipient: "Hello@mail.vyre.test", sender: "pat@acme.test" });
  assert.deepEqual(out, { accepted: true, mailMessageId: "eml_inbound1" });
  assert.deepEqual(contractErrors("mailgun.receive_inbound", "out", out), []);
  assert.deepEqual(h.downloads, [{ url: "https://storage-us-west1.api.mailgun.net/v3/domains/mail.vyre.test/messages/KEY123/attachments/0", mime: "application/pdf", auth: true }]);
  assert.deepEqual(h.calls("mail.ingest").map((c) => c.input), [{
    source: "mailgun", providerId: "CAFx123@mail.acme.test", rfcMessageId: "<CAFx123@mail.acme.test>", direction: "in", envelopeTo: "hello@mail.vyre.test",
    from: { address: "pat@acme.test", name: "Pat Lee" }, to: [{ address: "hello@mail.vyre.test", name: "Hello" }, { address: "lee@mail.vyre.test" }], subject: "Question about my case",
    receivedAt: 1_759_999_800_000, text: "Can we talk Friday?", html: "<p>Can we talk Friday?</p>", attachments: [{ name: "intake.pdf", mime: "application/pdf", size: 1001, blobId: "blb_1" }],
    headers: { received: "from a, from b", "in-reply-to": "<prev@mail.vyre.test>" },
  }]);
  assert.deepEqual(h.named("mailgun.inbound_received").map((e) => [e.subject, e.payload]), [["entity/CAFx123@mail.acme.test", { messageId: "CAFx123@mail.acme.test", recipient: "hello@mail.vyre.test" }]]);
  assert.deepEqual(h.rows(`SELECT * FROM mailgun_inbound_log`).map((r) => [r.messageId, r.mailMessageId, r.recipient]), [["CAFx123@mail.acme.test", "eml_inbound1", "hello@mail.vyre.test"]]);
});

test("a repeated inbound post lands once and answers with the message it made", async () => {
  const h = harness();
  h.on(STORED_EVENT, { status: 200, body: RECORDED.storedEvent });
  h.on("GET /v3/domains/mail.vyre.test/messages/KEY123", { status: 200, body: { ...RECORDED.stored, attachments: [] } });
  const input = { messageId: "CAFx123@mail.acme.test", recipient: "hello@mail.vyre.test", sender: "pat@acme.test" };
  await receiveInbound(h.ctx, input);
  const before = h.requests.length;
  assert.deepEqual(await receiveInbound(h.ctx, input), { accepted: true, mailMessageId: "eml_inbound1" });
  assert.equal(h.requests.length, before);
  assert.equal(h.calls("mail.ingest").length, 1);
});

test("a message Mailgun has not stored yet is not found, and is not remembered, so the post is retried", async () => {
  const h = harness();
  h.on(STORED_EVENT, { status: 200, body: { items: [] } });
  const input = { messageId: "CAFx123@mail.acme.test", recipient: "hello@mail.vyre.test", sender: "pat@acme.test" };
  await refused(receiveInbound(h.ctx, input), "validation.not_found");
  assert.equal(h.rows(`SELECT * FROM mailgun_inbound_log`).length, 0);
  await refused(receiveInbound(h.ctx, { ...input, messageId: "" }), "validation.bad_input");
  await refused(receiveInbound(h.ctx, { ...input, recipient: "nobody" }), "validation.bad_input");
});

test("an inbound email with nothing but a subject lands with no body fields", async () => {
  const h = harness();
  h.on(STORED_EVENT, { status: 200, body: RECORDED.storedEvent });
  h.on("GET /v3/domains/mail.vyre.test/messages/KEY123", { status: 200, body: { Subject: "Hi" } });
  await receiveInbound(h.ctx, { messageId: "CAFx123@mail.acme.test", recipient: "hello@mail.vyre.test", sender: "Pat Lee <pat@acme.test>" });
  const sent = h.calls("mail.ingest")[0]!.input;
  assert.deepEqual(["text", "html", "headers", "attachments"].filter((k) => k in sent), []);
  assert.deepEqual([sent.from, sent.to, sent.subject], [{ address: "pat@acme.test", name: "Pat Lee" }, [{ address: "hello@mail.vyre.test" }], "Hi"]);
});

// ---- the module entry

test("the handler map covers exactly the capabilities of the manifest and runs through the host signature", async () => {
  const declared = registry.capabilities.filter((c) => c.module === "mailgun").map((c) => c.name).sort();
  assert.equal(declared.length, 13);
  assert.deepEqual(Object.keys(handlers).sort(), declared);
  const h = harness();
  h.on("GET /v4/domains?limit=1000", { status: 200, body: RECORDED.domains });
  const asHost = h.ctx as unknown as Parameters<(typeof handlers)[string]>[0];
  assert.equal(((await handlers["mailgun.domains.list"]!(asHost, {})) as { domains: unknown[] }).domains.length, 3);
});
