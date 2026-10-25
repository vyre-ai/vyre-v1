// The Stripe connector against recorded responses (spec 2.10, 2.20; ARCH 8): customers, products and prices, Checkout sessions, payment links, the billing portal,
// payments, invoices, subscriptions, refunds, error mapping and the health probe. No socket is opened; the recorded bodies follow Stripe's API reference.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkoutCreateSession, customerCreate, customerGet, customerList, customerPortalCreateSession, health, invoiceGet, invoiceList, invoiceSend, paymentIntentGet, paymentIntentList,
  paymentLinkCreate, priceList, productList, refundCreate, subscriptionCancel, subscriptionGet, subscriptionList,
} from "../handlers/index.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { setStripeHost, formEncode, stripeId } from "../projections.ts";
import { codeOf, contractErrors, harness, KEY, NOW, RECORDED } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

// ---- reading

test("a customer is read with the key and the pinned API version and mapped to the contract's shape", async () => {
  const h = harness();
  h.on("GET /v1/customers/cus_NffrFeUfNV2Hib", { status: 200, body: RECORDED.customer });
  const out = await customerGet(h.ctx, { customerId: "cus_NffrFeUfNV2Hib" });
  assert.deepEqual(contractErrors("stripe.customer.get", "out", out), []);
  assert.deepEqual(out.customer, { id: "cus_NffrFeUfNV2Hib", email: "pat@acme.test", name: "Pat Lee", created: 1_759_000_000_000, metadata: { recordId: "rec_lee01" } });
  const req = h.last();
  assert.deepEqual([req.method, req.path], ["GET", "/v1/customers/cus_NffrFeUfNV2Hib"]);
  assert.deepEqual(req.headers, { authorization: `Bearer ${KEY}`, accept: "application/json", "stripe-version": "2024-06-20" });
});

test("a customer list passes the email filter, caps a page at 100 and hands back the last id as the next page token", async () => {
  const h = harness();
  h.on("GET /v1/customers", { status: 200, body: RECORDED.customers });
  const input = { email: "pat@acme.test", limit: 500 };
  assert.deepEqual(contractErrors("stripe.customer.list", "in", input), []);
  const out = await customerList(h.ctx, input);
  assert.deepEqual(contractErrors("stripe.customer.list", "out", out), []);
  assert.deepEqual(out.customers.map((c) => c.id), ["cus_NffrFeUfNV2Hib", "cus_OOtherCustomer"]);
  assert.equal(out.nextPageToken, "cus_OOtherCustomer");
  assert.deepEqual(h.last().query, { email: "pat@acme.test", limit: "100" });
  h.on("GET /v1/customers", { status: 200, body: RECORDED.customersLast });
  const next = await customerList(h.ctx, { pageToken: out.nextPageToken!, limit: 2 });
  assert.equal(next.nextPageToken, undefined, "no more pages, no token");
  assert.deepEqual(h.last().query, { limit: "2", starting_after: "cus_OOtherCustomer" });
  await customerList(h.ctx, { cursor: "cus_OLastCustomer" });
  assert.equal(h.last().query.starting_after, "cus_OLastCustomer", "a cursor is read as a page token");
  await refused(customerList(h.ctx, { email: "nope" }), "validation.bad_input");
  await refused(customerList(h.ctx, { pageToken: "x/../y" }), "validation.bad_input");
  await refused(customerList(h.ctx, { limit: 0 }), "validation.bad_input");
});

test("products and prices are mapped: upper-case currency, the billing interval, no amount for a metered price", async () => {
  const h = harness();
  h.on("GET /v1/products", { status: 200, body: RECORDED.products });
  const products = await productList(h.ctx, { active: true });
  assert.deepEqual(contractErrors("stripe.product.list", "out", products), []);
  assert.deepEqual(products.products, [{ id: "prod_Retainer", name: "Monthly retainer", active: true }, { id: "prod_Old", name: "Old plan", active: false }]);
  assert.equal(h.last().query.active, "true");
  h.on("GET /v1/prices", { status: 200, body: RECORDED.prices });
  const prices = await priceList(h.ctx, { productId: "prod_Retainer", active: true });
  assert.deepEqual(contractErrors("stripe.price.list", "out", prices), []);
  assert.deepEqual(prices.prices, [
    { id: "price_1Retainer", productId: "prod_Retainer", unitAmount: 25000, currency: "USD", recurring: "month", active: true },
    { id: "price_1Flat", productId: "prod_Flat", currency: "USD", active: false },
  ]);
  assert.deepEqual(h.last().query, { product: "prod_Retainer", active: "true", limit: "25" });
});

// ---- writing: customers, checkout, links, portal

test("a customer is created with a form body, the trace in metadata and the idempotency key", async () => {
  const h = harness();
  h.on("POST /v1/customers", { status: 200, body: RECORDED.customer });
  const input = { email: "pat@acme.test", name: "Pat Lee", metadata: { recordId: "rec_lee01" }, idempotencyKey: "idem_cus_1" };
  const out = await customerCreate(h.ctx, input);
  assert.deepEqual(contractErrors("stripe.customer.create", "out", out), []);
  const req = h.last();
  assert.equal(req.method, "POST");
  assert.equal(req.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(req.headers["idempotency-key"], "idem_cus_1");
  assert.deepEqual(Object.fromEntries(req.form), { email: "pat@acme.test", name: "Pat Lee", "metadata[recordId]": "rec_lee01", "metadata[vyre_trace]": "0123456789abcdef0123456789abcdef" });
  await refused(customerCreate(h.ctx, { email: "not an email" }), "validation.bad_input");
  await refused(customerCreate(h.ctx, { metadata: { ["k".repeat(41)]: "v" } }), "validation.bad_input");
});

test("a Checkout session for a site payment carries the record and site on the session and on the payment it creates", async () => {
  const h = harness();
  h.on("POST /v1/checkout/sessions", { status: 200, body: RECORDED.session });
  const input = {
    mode: "payment", lineItems: [{ priceId: "price_1Retainer", quantity: 2 }, { name: "Filing fee", unitAmount: 4500, currency: "usd", quantity: 1 }],
    successUrl: "https://firm.example/thanks", cancelUrl: "https://firm.example/pay", customerEmail: "pat@acme.test", metadata: { campaign: "spring" },
    recordId: "rec_lee01", siteId: "sit_firm01", idempotencyKey: "idem_cs_1",
  } as const;
  const asked = { ...input, lineItems: [...input.lineItems] };
  assert.deepEqual(contractErrors("stripe.checkout.create_session", "in", asked), []);
  const out = await checkoutCreateSession(h.ctx, asked);
  assert.deepEqual(out, { sessionId: "cs_test_a1B2c3D4", url: "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4" });
  assert.deepEqual(contractErrors("stripe.checkout.create_session", "out", out), []);
  const form = Object.fromEntries(h.last().form);
  assert.deepEqual(form, {
    mode: "payment", success_url: "https://firm.example/thanks", cancel_url: "https://firm.example/pay", customer_email: "pat@acme.test",
    "line_items[0][price]": "price_1Retainer", "line_items[0][quantity]": "2",
    "line_items[1][price_data][currency]": "usd", "line_items[1][price_data][unit_amount]": "4500", "line_items[1][price_data][product_data][name]": "Filing fee", "line_items[1][quantity]": "1",
    "metadata[campaign]": "spring", "metadata[recordId]": "rec_lee01", "metadata[siteId]": "sit_firm01", "metadata[vyre_trace]": "0123456789abcdef0123456789abcdef",
    "payment_intent_data[metadata][campaign]": "spring", "payment_intent_data[metadata][recordId]": "rec_lee01", "payment_intent_data[metadata][siteId]": "sit_firm01",
    "payment_intent_data[metadata][vyre_trace]": "0123456789abcdef0123456789abcdef",
  });
  assert.equal(h.last().headers["idempotency-key"], "idem_cs_1");
});

test("a subscription session needs Stripe prices and carries the refs to the subscription; a known customer replaces the email; a setup session sends no items", async () => {
  const h = harness();
  h.on("POST /v1/checkout/sessions", { status: 200, body: RECORDED.session });
  const base = { successUrl: "https://firm.example/ok", cancelUrl: "https://firm.example/no", customerId: "cus_NffrFeUfNV2Hib", customerEmail: "ignored@acme.test", siteId: "sit_firm01" };
  await checkoutCreateSession(h.ctx, { ...base, mode: "subscription", lineItems: [{ priceId: "price_1Retainer", quantity: 1 }] });
  const sub = Object.fromEntries(h.last().form);
  assert.equal(sub.customer, "cus_NffrFeUfNV2Hib");
  assert.equal(sub.customer_email, undefined, "a customer and an email are not sent together");
  assert.equal(sub["subscription_data[metadata][siteId]"], "sit_firm01");
  assert.equal(sub["payment_intent_data[metadata][siteId]"], undefined);
  await refused(checkoutCreateSession(h.ctx, { ...base, mode: "subscription", lineItems: [{ name: "Ad hoc", unitAmount: 100, currency: "usd", quantity: 1 }] }), "validation.bad_input");
  await checkoutCreateSession(h.ctx, { ...base, mode: "setup", lineItems: [{ priceId: "price_1Retainer", quantity: 1 }] });
  assert.ok(![...h.last().form.keys()].some((k) => k.startsWith("line_items")), "Stripe takes no items on a setup session");
});

test("a Checkout session is refused for bad addresses, items, quantities, ids and metadata before Stripe is asked", async () => {
  const h = harness();
  const ok = { mode: "payment", lineItems: [{ priceId: "price_1Retainer", quantity: 1 }], successUrl: "https://firm.example/ok", cancelUrl: "https://firm.example/no" } as const;
  const lines = [...ok.lineItems];
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: lines, successUrl: "http://firm.example/ok" }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: lines, cancelUrl: "javascript:alert(1)" }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: [], }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: [{ priceId: "price_1Retainer", quantity: 0 }] }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: [{ priceId: "price_1/../x", quantity: 1 }] }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: [{ name: "No amount", quantity: 1 }] }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: lines, recordId: "bad" }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: lines, siteId: "bad" }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: lines, customerEmail: "no" }), "validation.bad_input");
  await refused(checkoutCreateSession(h.ctx, { ...ok, lineItems: lines, mode: "barter" as never }), "validation.bad_input");
  assert.equal(h.requests.length, 0);
  const local = harness();
  local.on("POST /v1/checkout/sessions", { status: 200, body: RECORDED.session });
  await checkoutCreateSession(local.ctx, { ...ok, lineItems: lines, successUrl: "http://localhost:3000/ok" });
  assert.equal(local.requests.length, 1, "plain http is fine on this machine");
  local.on("POST /v1/checkout/sessions", { status: 200, body: RECORDED.sessionNoUrl });
  await refused(checkoutCreateSession(local.ctx, { ...ok, lineItems: lines }), "provider.bad_response");
});

test("a payment link takes prices only and a portal session takes a customer and a way back", async () => {
  const h = harness();
  h.on("POST /v1/payment_links", { status: 200, body: RECORDED.link });
  const out = await paymentLinkCreate(h.ctx, { lineItems: [{ priceId: "price_1Retainer", quantity: 3 }], recordId: "rec_lee01", siteId: "sit_firm01", idempotencyKey: "idem_pl_1" });
  assert.deepEqual(out, { linkId: "plink_1Abc", url: "https://buy.stripe.com/test_abc123" });
  assert.deepEqual(contractErrors("stripe.payment_link.create", "out", out), []);
  assert.deepEqual(Object.fromEntries(h.last().form), {
    "line_items[0][price]": "price_1Retainer", "line_items[0][quantity]": "3", "metadata[recordId]": "rec_lee01", "metadata[siteId]": "sit_firm01", "metadata[vyre_trace]": "0123456789abcdef0123456789abcdef",
  });
  await refused(paymentLinkCreate(h.ctx, { lineItems: [{ name: "Ad hoc", unitAmount: 100, currency: "usd", quantity: 1 }], idempotencyKey: "idem_pl_2" }), "validation.bad_input");
  h.on("POST /v1/billing_portal/sessions", { status: 200, body: RECORDED.portal });
  const portal = await customerPortalCreateSession(h.ctx, { customerId: "cus_NffrFeUfNV2Hib", returnUrl: "https://firm.example/account", idempotencyKey: "idem_bp_1" });
  assert.deepEqual(portal, { url: "https://billing.stripe.com/p/session/test_abc" });
  assert.deepEqual(Object.fromEntries(h.last().form), { customer: "cus_NffrFeUfNV2Hib", return_url: "https://firm.example/account" });
  await refused(customerPortalCreateSession(h.ctx, { customerId: "cus_1", returnUrl: "ftp://x", idempotencyKey: "i" }), "validation.bad_input");
});

// ---- payments, invoices, subscriptions, refunds

test("a payment is read in milliseconds and upper-case currency; a payment list asks for a time range in seconds", async () => {
  const h = harness();
  h.on("GET /v1/payment_intents/pi_3NabcDEF", { status: 200, body: RECORDED.paymentIntent });
  const one = await paymentIntentGet(h.ctx, { paymentIntentId: "pi_3NabcDEF" });
  assert.deepEqual(contractErrors("stripe.payment_intent.get", "out", one), []);
  assert.deepEqual(one.paymentIntent, {
    id: "pi_3NabcDEF", amount: 50_000, currency: "USD", status: "succeeded", customerId: "cus_NffrFeUfNV2Hib", receiptEmail: "pat@acme.test", created: 1_759_500_000_000,
    metadata: { recordId: "rec_lee01", siteId: "sit_firm01" },
  });
  h.on("GET /v1/payment_intents", { status: 200, body: RECORDED.paymentIntents });
  const many = await paymentIntentList(h.ctx, { customerId: "cus_NffrFeUfNV2Hib", from: NOW - 86_400_000, to: NOW });
  assert.deepEqual(contractErrors("stripe.payment_intent.list", "out", many), []);
  assert.equal(many.paymentIntents.length, 1);
  assert.deepEqual(h.last().query, { customer: "cus_NffrFeUfNV2Hib", "created[gte]": String((NOW - 86_400_000) / 1000), "created[lte]": String(NOW / 1000), limit: "25" });
  await refused(paymentIntentList(h.ctx, { from: NOW, to: NOW - 1 }), "validation.bad_input");
  await refused(paymentIntentList(h.ctx, { from: -1 }), "validation.bad_input");
});

test("an invoice is read, listed by status and sent; its amount is what is due", async () => {
  const h = harness();
  h.on("GET /v1/invoices/in_1Abc", { status: 200, body: RECORDED.invoice });
  const one = await invoiceGet(h.ctx, { invoiceId: "in_1Abc" });
  assert.deepEqual(contractErrors("stripe.invoice.get", "out", one), []);
  assert.deepEqual(one.invoice, { id: "in_1Abc", amount: 120_000, currency: "USD", status: "open", customerId: "cus_NffrFeUfNV2Hib", hostedUrl: "https://invoice.stripe.com/i/acct_1/test_1Abc", dueDate: 1_761_000_000_000 });
  h.on("GET /v1/invoices", { status: 200, body: RECORDED.invoices });
  const many = await invoiceList(h.ctx, { customerId: "cus_NffrFeUfNV2Hib", status: "open" });
  assert.deepEqual(contractErrors("stripe.invoice.list", "out", many), []);
  assert.deepEqual(h.last().query, { customer: "cus_NffrFeUfNV2Hib", status: "open", limit: "25" });
  await refused(invoiceList(h.ctx, { status: "weird" }), "validation.bad_input");
  h.on("POST /v1/invoices/in_1Abc/send", { status: 200, body: RECORDED.invoiceSent });
  const sent = await invoiceSend(h.ctx, { invoiceId: "in_1Abc", idempotencyKey: "idem_send_1" });
  assert.deepEqual(contractErrors("stripe.invoice.send", "out", sent), []);
  assert.equal(h.last().headers["idempotency-key"], "idem_send_1");
});

test("a subscription is read with its price and period end, from the subscription or from its item", async () => {
  const h = harness();
  h.on("GET /v1/subscriptions/sub_1Abc", { status: 200, body: RECORDED.subscription });
  const one = await subscriptionGet(h.ctx, { subscriptionId: "sub_1Abc" });
  assert.deepEqual(contractErrors("stripe.subscription.get", "out", one), []);
  assert.deepEqual(one.subscription, { id: "sub_1Abc", status: "active", customerId: "cus_NffrFeUfNV2Hib", priceId: "price_1Retainer", currentPeriodEnd: 1_762_600_000_000, cancelAtPeriodEnd: false });
  h.on("GET /v1/subscriptions/sub_1New", { status: 200, body: RECORDED.subscriptionItemPeriod });
  const moved = await subscriptionGet(h.ctx, { subscriptionId: "sub_1New" });
  assert.deepEqual(moved.subscription, { id: "sub_1New", status: "trialing", customerId: "cus_NffrFeUfNV2Hib", priceId: "price_1Retainer", currentPeriodEnd: 1_763_000_000_000, cancelAtPeriodEnd: true });
  h.on("GET /v1/subscriptions", { status: 200, body: RECORDED.subscriptions });
  const many = await subscriptionList(h.ctx, { customerId: "cus_NffrFeUfNV2Hib", status: "active" });
  assert.deepEqual(contractErrors("stripe.subscription.list", "out", many), []);
  assert.deepEqual(many.subscriptions, [{ id: "sub_1Abc", status: "active", customerId: "cus_NffrFeUfNV2Hib", cancelAtPeriodEnd: false }]);
  await refused(subscriptionList(h.ctx, { status: "nope" }), "validation.bad_input");
});

test("a subscription is canceled now with DELETE, or at the end of the period with a POST", async () => {
  const h = harness();
  h.on("DELETE /v1/subscriptions/sub_1Abc", { status: 200, body: RECORDED.subscriptionCanceled });
  const now = await subscriptionCancel(h.ctx, { subscriptionId: "sub_1Abc", idempotencyKey: "idem_c1" });
  assert.deepEqual(contractErrors("stripe.subscription.cancel", "out", now), []);
  assert.equal(now.subscription.status, "canceled");
  assert.deepEqual([h.last().method, h.last().path, h.last().headers["idempotency-key"]], ["DELETE", "/v1/subscriptions/sub_1Abc", "idem_c1"]);
  h.on("POST /v1/subscriptions/sub_1Abc", { status: 200, body: { ...RECORDED.subscription, cancel_at_period_end: true } });
  const later = await subscriptionCancel(h.ctx, { subscriptionId: "sub_1Abc", atPeriodEnd: true, idempotencyKey: "idem_c2" });
  assert.equal(later.subscription.cancelAtPeriodEnd, true);
  assert.deepEqual(Object.fromEntries(h.last().form), { cancel_at_period_end: "true" });
  await refused(subscriptionCancel(h.ctx, { subscriptionId: "sub_1Abc", atPeriodEnd: "yes" as never, idempotencyKey: "i" }), "validation.bad_input");
});

test("a refund names the payment, the amount and the reason, and carries the trace; a refund already made is a state error", async () => {
  const h = harness();
  h.on("POST /v1/refunds", { status: 200, body: RECORDED.refund });
  const input = { paymentIntentId: "pi_3NabcDEF", amount: 10_000, reason: "requested_by_customer", idempotencyKey: "idem_ref_1" } as const;
  assert.deepEqual(contractErrors("stripe.refund.create", "in", input), []);
  const out = await refundCreate(h.ctx, input);
  assert.deepEqual(out, { refundId: "re_3NabcDEF", status: "succeeded" });
  assert.deepEqual(contractErrors("stripe.refund.create", "out", out), []);
  assert.deepEqual(Object.fromEntries(h.last().form), {
    payment_intent: "pi_3NabcDEF", amount: "10000", reason: "requested_by_customer", "metadata[vyre_trace]": "0123456789abcdef0123456789abcdef",
  });
  assert.equal(h.last().headers["idempotency-key"], "idem_ref_1");
  await refundCreate(h.ctx, { paymentIntentId: "pi_3NabcDEF", idempotencyKey: "idem_ref_2" });
  assert.equal(h.last().form.has("amount"), false, "no amount means the whole payment");
  h.on("POST /v1/refunds", { status: 400, body: RECORDED.errorRefunded });
  await refused(refundCreate(h.ctx, { paymentIntentId: "pi_3NabcDEF", idempotencyKey: "idem_ref_3" }), "validation.precondition_failed");
  await refused(refundCreate(h.ctx, { paymentIntentId: "pi_3NabcDEF", amount: 0, idempotencyKey: "i" }), "validation.bad_input");
  await refused(refundCreate(h.ctx, { paymentIntentId: "pi_3NabcDEF", reason: "bored" as never, idempotencyKey: "i" }), "validation.bad_input");
  await refused(refundCreate(h.ctx, { paymentIntentId: "not a payment", idempotencyKey: "i" }), "validation.bad_input");
});

// ---- errors and health

test("Stripe's refusals map to the error catalogue and its own words are never passed on", async () => {
  const cases: [number, unknown, string][] = [
    [401, RECORDED.error401, "provider.auth_failed"], [403, RECORDED.error401, "provider.auth_failed"], [404, RECORDED.error404, "validation.not_found"],
    [429, {}, "provider.rate_limited"], [500, {}, "provider.unavailable"], [503, {}, "provider.unavailable"], [400, RECORDED.error400, "validation.bad_input"],
    [409, {}, "validation.precondition_failed"], [402, {}, "validation.precondition_failed"], [418, {}, "provider.bad_response"],
  ];
  for (const [status, body, code] of cases) {
    const h = harness();
    h.on("GET /v1/customers/cus_1", { status, body });
    await assert.rejects(customerGet(h.ctx, { customerId: "cus_1" }), (e: unknown) => {
      assert.equal(codeOf(e), code, String(status));
      const text = JSON.stringify(e);
      assert.ok(!text.includes("typed_by_a_person") && !text.includes("Pat Lee"), "Stripe's message can echo what a person typed");
      return true;
    });
  }
  const net = harness();
  net.on("GET /v1/customers/cus_1", { status: 200, throws: true });
  await refused(customerGet(net.ctx, { customerId: "cus_1" }), "provider.network");
  const garbled = harness();
  garbled.on("GET /v1/customers/cus_1", { status: 200, body: "<html>" });
  await refused(customerGet(garbled.ctx, { customerId: "cus_1" }), "provider.bad_response");
});

test("a Stripe id that could reach another path is refused before any request", async () => {
  const h = harness();
  for (const bad of ["cus_1/../v1/account", "cus_1?expand=x", "", "cus", "../cus_1", "cus_1 "]) {
    await refused(customerGet(h.ctx, { customerId: bad }), "validation.bad_input");
  }
  assert.equal(h.requests.length, 0);
  assert.equal(stripeId({ trace: { traceId: "t" } }, "cs_test_a1B2c3", "x"), "cs_test_a1B2c3");
  assert.equal(stripeId({ trace: { traceId: "t" } }, "prod_Retainer", "x"), "prod_Retainer");
});

test("form encoding writes bracket keys for objects and arrays and leaves out what is empty", () => {
  assert.equal(formEncode({ a: 1, b: "x y", c: true, d: undefined, e: null }), "a=1&b=x%20y&c=true");
  assert.equal(formEncode({ line_items: [{ price: "p1", quantity: 2 }], metadata: { k: "v" } }), "line_items%5B0%5D%5Bprice%5D=p1&line_items%5B0%5D%5Bquantity%5D=2&metadata%5Bk%5D=v");
  assert.equal(formEncode({ x: { y: { z: [1, 2] } } }), "x%5By%5D%5Bz%5D%5B0%5D=1&x%5By%5D%5Bz%5D%5B1%5D=2");
});

test("health reads the balance: healthy with a latency, down on a refused key, degraded when slow or limited, down when not set up or unreachable", async () => {
  const h = harness();
  h.on("GET /v1/balance", { status: 200, body: RECORDED.balance });
  const ok = await health(h.ctx);
  assert.deepEqual(contractErrors("stripe.health", "out", ok), []);
  assert.equal(ok.state, "healthy");
  assert.ok(ok.latencyMs !== undefined && ok.latencyMs >= 0);
  h.on("GET /v1/balance", { status: 401, body: RECORDED.error401 });
  assert.deepEqual([(await health(h.ctx)).state, (await health(h.ctx)).detail], ["down", "Stripe did not accept the key. Check Stripe_Key in the Vault and that it can read the balance."]);
  h.on("GET /v1/balance", { status: 429, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET /v1/balance", { status: 502, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on("GET /v1/balance", { status: 200, throws: true });
  assert.deepEqual([(await health(h.ctx)).state, (await health(h.ctx)).detail], ["down", "Stripe could not be reached."]);
  setStripeHost(null);
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "Stripe is not set up on this server." });
  setStripeHost({ async secret(ctx) { throw fail("provider.auth_failed", ctx.trace.traceId); } });
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "There is no Stripe key. Add Stripe_Key to the Vault." });
  setStripeHost({ async secret() { throw new Error("vault exploded"); } });
  await assert.rejects(health(h.ctx), /vault exploded/);
});
