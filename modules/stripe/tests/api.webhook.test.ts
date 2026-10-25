// The Stripe webhook (/hooks/stripe; spec 2.10): the signature, the normalising of Stripe's events into the payment events, each applied once. Replay only.
import test from "node:test";
import assert from "node:assert/strict";
import { parseWebhook, receiveWebhook, signatureMatches, signatureOf, verifyWebhook } from "../handlers/index.ts";
import { codeOf, contractErrors, EVENTS, harness, NOW, payloadErrors, RECORDED, WEBHOOK_SECRET } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

// ---- the signature

// HMAC-SHA256 of `1760000000.{"id":"evt_1"}` under whsec_test_not_real, computed outside this code base.
const KNOWN = "9d6ab970ee21c3b5625942a86fe7158c93bbfff2f38929fc126581ebef501efc";
const BODY = '{"id":"evt_1"}';

test("the signature is HMAC-SHA256 of the timestamp, a dot and the body, under the webhook secret", async () => {
  assert.equal(await signatureOf(WEBHOOK_SECRET, 1_760_000_000, BODY), KNOWN);
  assert.notEqual(await signatureOf(WEBHOOK_SECRET, 1_760_000_001, BODY), KNOWN);
  assert.notEqual(await signatureOf("whsec_other", 1_760_000_000, BODY), KNOWN);
});

test("a header is accepted only when a v1 signature matches, the body is untouched and the time is within five minutes", async () => {
  const ok = `t=1760000000,v1=${KNOWN}`;
  assert.equal(await signatureMatches(WEBHOOK_SECRET, ok, BODY, NOW), true);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, ok, BODY, NOW + 299_000), true);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, ok, BODY, NOW - 299_000), true);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, ok, BODY, NOW + 301_000), false, "an old delivery is a replay");
  assert.equal(await signatureMatches(WEBHOOK_SECRET, ok, BODY, NOW - 301_000), false, "so is one from the future");
  assert.equal(await signatureMatches(WEBHOOK_SECRET, ok, `${BODY} `, NOW), false);
  assert.equal(await signatureMatches("whsec_other", ok, BODY, NOW), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, `t=1760000000,v1=${KNOWN.replace(/.$/, "0")}`, BODY, NOW), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, `t=1760000000,v1=${KNOWN.slice(0, 20)}`, BODY, NOW), false, "a short signature is not a match");
  assert.equal(await signatureMatches(WEBHOOK_SECRET, `t=1760000000`, BODY, NOW), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, `v1=${KNOWN}`, BODY, NOW), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, `t=soon,v1=${KNOWN}`, BODY, NOW), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, "", BODY, NOW), false);
  assert.equal(await signatureMatches(WEBHOOK_SECRET, `t=1760000000,v1=${"0".repeat(64)},v1=${KNOWN}`, BODY, NOW), true, "during a secret roll Stripe sends two signatures");
});

async function signed(body: string, at = NOW): Promise<string> {
  const t = Math.floor(at / 1000);
  return `t=${t},v1=${await signatureOf(WEBHOOK_SECRET, t, body)}`;
}

test("the route verifies the signature first: an unsigned or forged body is refused, a signed one becomes the input of the webhook capability", async () => {
  const h = harness();
  const body = JSON.stringify(EVENTS.paid);
  await refused(verifyWebhook(h.ctx, { signature: undefined, body }), "auth.bad_credentials");
  await refused(verifyWebhook(h.ctx, { signature: "t=1,v1=abc", body }), "auth.bad_credentials");
  await refused(verifyWebhook(h.ctx, { signature: await signed(body, NOW - 3_600_000), body }), "auth.bad_credentials");
  const input = await verifyWebhook(h.ctx, { signature: await signed(body), body });
  assert.ok(input);
  assert.deepEqual(contractErrors("stripe.receive_webhook", "in", input), []);
  assert.equal(input.eventId, "evt_pi_ok1");
  const junk = "not json";
  await refused(verifyWebhook(h.ctx, { signature: await signed(junk), body: junk }), "validation.bad_input");
  const empty = JSON.stringify({ id: "evt_x", type: "ping", data: { object: {} } });
  assert.equal(await verifyWebhook(h.ctx, { signature: await signed(empty), body: empty }), null, "an event with no object has nothing to name");
});

// ---- normalising

test("each event Stripe sends becomes the input of stripe.receive_webhook with the money, the customer and the Vyre refs from its metadata", () => {
  const at = 1_760_000_000_000;
  const cases: [keyof typeof EVENTS, object][] = [
    ["checkout", { eventId: "evt_checkout1", type: "checkout.session.completed", objectId: "cs_test_a1B2c3D4", amount: 50_000, currency: "USD", at, customerId: "cus_NffrFeUfNV2Hib", recordId: "rec_lee01", siteId: "sit_firm01" }],
    ["paid", { eventId: "evt_pi_ok1", type: "payment_intent.succeeded", objectId: "pi_3NabcDEF", amount: 50_000, currency: "USD", at, customerId: "cus_NffrFeUfNV2Hib", siteId: "sit_firm01" }],
    ["failed", { eventId: "evt_pi_bad1", type: "payment_intent.payment_failed", objectId: "pi_3Nfail", amount: 7_000, currency: "USD", at, customerId: "cus_OOtherCustomer" }],
    ["invoicePaid", { eventId: "evt_inv_ok1", type: "invoice.paid", objectId: "in_1Abc", amount: 120_000, currency: "USD", at, customerId: "cus_NffrFeUfNV2Hib", recordId: "rec_lee01" }],
    ["invoiceFailed", { eventId: "evt_inv_bad1", type: "invoice.payment_failed", objectId: "in_1Def", amount: 9_900, currency: "EUR", at, customerId: "cus_OOtherCustomer", siteId: "sit_firm01" }],
    ["refund", { eventId: "evt_ref1", type: "refund.created", objectId: "re_3NabcDEF", amount: 10_000, currency: "USD", at }],
    ["dispute", { eventId: "evt_dis1", type: "charge.dispute.created", objectId: "dp_1Abc", amount: 50_000, currency: "USD", at }],
    ["subCreated", { eventId: "evt_sub_new1", type: "customer.subscription.created", objectId: "sub_1Abc", amount: 25_000, currency: "USD", at, customerId: "cus_NffrFeUfNV2Hib", recordId: "rec_lee01", siteId: "sit_firm01" }],
    ["subUpdated", { eventId: "evt_sub_upd1", type: "customer.subscription.updated", objectId: "sub_1Abc", amount: 0, currency: "USD", at, customerId: "cus_NffrFeUfNV2Hib" }],
    ["other", { eventId: "evt_other1", type: "customer.created", objectId: "cus_NffrFeUfNV2Hib", amount: 0, currency: "USD", at }],
  ];
  for (const [name, want] of cases) {
    const got = parseWebhook(EVENTS[name], NOW);
    assert.deepEqual(got, want, name);
    assert.deepEqual(contractErrors("stripe.receive_webhook", "in", got), [], name);
  }
});

test("a paid payment with a partial capture counts what was received; refs that are not Vyre ids are ignored; a missing time is now", () => {
  const e = { ...EVENTS.paid, created: undefined, data: { object: { id: "pi_3Npart", amount: 10_000, amount_received: 4_000, currency: "gbp", metadata: { recordId: "nope", siteId: "sit_BAD" } } } };
  assert.deepEqual(parseWebhook(e, NOW), { eventId: "evt_pi_ok1", type: "payment_intent.succeeded", objectId: "pi_3Npart", amount: 4_000, currency: "GBP", at: NOW });
  assert.equal(parseWebhook({ type: "x", data: { object: { id: "a" } } }, NOW), null);
  assert.equal(parseWebhook({ id: "e", data: { object: { id: "a" } } }, NOW), null);
  assert.equal(parseWebhook({ id: "e", type: "x", data: {} }, NOW), null);
  assert.equal(parseWebhook("nope", NOW), null);
});

// ---- applying

const names = (h: Harness): string[] => h.emitted.map((e) => e.name);

test("a payment event is recorded once and lands as the event a site or automation listens for, with the refs", async () => {
  const h = harness();
  const input = parseWebhook(EVENTS.checkout, NOW)!;
  assert.deepEqual(await receiveWebhook(h.ctx, input), { accepted: true });
  assert.deepEqual(names(h), ["stripe.event_received", "checkout.completed"]);
  assert.deepEqual(h.emitted[0]!.payload, { eventId: "evt_checkout1", type: "checkout.session.completed", objectId: "cs_test_a1B2c3D4" });
  assert.equal(h.emitted[0]!.subject, "entity/evt_checkout1");
  assert.deepEqual(h.emitted[1]!.payload, {
    eventId: "evt_checkout1", objectId: "cs_test_a1B2c3D4", amount: 50_000, currency: "USD", customerId: "cus_NffrFeUfNV2Hib", recordId: "rec_lee01", siteId: "sit_firm01",
  });
  assert.equal(h.emitted[1]!.subject, "entity/cs_test_a1B2c3D4");
  for (const e of h.emitted) assert.deepEqual(payloadErrors(e.name, e.payload), [], e.name);
  assert.deepEqual(await receiveWebhook(h.ctx, input), { accepted: true }, "Stripe retries until it gets a 2xx");
  assert.equal(h.emitted.length, 2, "the retry changes nothing");
  assert.equal(h.rows(`SELECT "eventId" FROM stripe_event_log`).length, 1);
});

test("every mapped payment type lands as its own event name, and one Stripe event is one event", async () => {
  const h = harness();
  const want: [keyof typeof EVENTS, string][] = [
    ["paid", "payment.succeeded"], ["failed", "payment.failed"], ["invoicePaid", "invoice.paid"], ["invoiceFailed", "invoice.payment_failed"], ["refund", "refund.created"],
    ["dispute", "dispute.created"],
  ];
  for (const [key, name] of want) {
    const before = h.emitted.length;
    await receiveWebhook(h.ctx, parseWebhook(EVENTS[key], NOW)!);
    assert.deepEqual(h.emitted.slice(before).map((e) => e.name), ["stripe.event_received", name], key);
    for (const e of h.emitted.slice(before)) assert.deepEqual(payloadErrors(e.name, e.payload), [], `${key} ${e.name}`);
  }
  const paidAgain = parseWebhook({ ...EVENTS.paid, id: "evt_pi_ok2", type: "invoice.payment_succeeded" }, NOW)!;
  await receiveWebhook(h.ctx, paidAgain);
  assert.equal(h.named("invoice.paid").length, 2, "invoice.payment_succeeded is an invoice.paid too");
  const refunded = parseWebhook({ ...EVENTS.refund, id: "evt_charge_ref", type: "charge.refunded" }, NOW)!;
  await receiveWebhook(h.ctx, refunded);
  assert.equal(h.named("refund.created").length, 1, "charge.refunded travels beside refund.created and is not counted again");
});

test("an event Vyre has no payment meaning for is still recorded as received", async () => {
  const h = harness();
  await receiveWebhook(h.ctx, parseWebhook(EVENTS.other, NOW)!);
  assert.deepEqual(names(h), ["stripe.event_received"]);
  await refused(receiveWebhook(h.ctx, { eventId: "", type: "x", objectId: "y", amount: 0, currency: "USD", at: NOW }), "validation.bad_input");
  await refused(receiveWebhook(h.ctx, { eventId: "e", type: "x", objectId: "", amount: 0, currency: "USD", at: NOW }), "validation.bad_input");
});

test("a new subscription says which price it is for and an updated one says its status, both read from Stripe; a canceled one asks nothing", async () => {
  const h = harness();
  h.on("GET /v1/subscriptions/sub_1Abc", { status: 200, body: { ...RECORDED.subscription, status: "past_due" } });
  await receiveWebhook(h.ctx, parseWebhook(EVENTS.subCreated, NOW)!);
  const created = h.named("subscription.created")[0]!;
  assert.deepEqual(created.payload, { eventId: "evt_sub_new1", customerId: "cus_NffrFeUfNV2Hib", recordId: "rec_lee01", siteId: "sit_firm01", subscriptionId: "sub_1Abc", priceId: "price_1Retainer" });
  assert.equal(created.subject, "entity/sub_1Abc");
  await receiveWebhook(h.ctx, parseWebhook(EVENTS.subUpdated, NOW)!);
  assert.deepEqual(h.named("subscription.updated")[0]!.payload, { eventId: "evt_sub_upd1", customerId: "cus_NffrFeUfNV2Hib", subscriptionId: "sub_1Abc", status: "past_due" });
  const reads = h.requests.length;
  await receiveWebhook(h.ctx, parseWebhook(EVENTS.subDeleted, NOW)!);
  assert.equal(h.requests.length, reads, "a canceled subscription needs no read");
  assert.deepEqual(h.named("subscription.canceled")[0]!.payload, { eventId: "evt_sub_del1", customerId: "cus_NffrFeUfNV2Hib", subscriptionId: "sub_1Abc" });
  for (const e of h.emitted) assert.deepEqual(payloadErrors(e.name, e.payload), [], e.name);
});

test("a subscription event still lands when Stripe cannot be read: no price, and a status of unknown", async () => {
  const h = harness();
  h.on("GET /v1/subscriptions/sub_1Abc", { status: 500, body: {} });
  await receiveWebhook(h.ctx, parseWebhook(EVENTS.subCreated, NOW)!);
  await receiveWebhook(h.ctx, parseWebhook(EVENTS.subUpdated, NOW)!);
  assert.equal("priceId" in h.named("subscription.created")[0]!.payload, false);
  assert.equal(h.named("subscription.updated")[0]!.payload.status, "unknown");
  for (const e of h.emitted) assert.deepEqual(payloadErrors(e.name, e.payload), [], e.name);
});
