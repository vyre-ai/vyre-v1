// The Stripe connector (spec 2.10 Source: Stripe, 2.20 payments for sites; ARCH 8): customers, products and prices, Checkout sessions, payment links, billing portal
// sessions, payments, invoices, subscriptions, refunds, the health probe, and the webhook that turns Stripe's events into the payment events Vyre listens to.
//
// Nothing here decides whether a person may pay out or email a customer: the host applies the Gate act of each capability (refund: pay, invoice send: send, subscription
// cancel: delete) before a handler runs. The restricted key comes from the Vault for one call; the module never keeps it.
// DECISION: Stripe takes form-encoded bodies and counts in seconds, lower-case currencies and snake_case names; every answer here is mapped to the contract's shapes (milliseconds,
// upper-case ISO currencies, camelCase) and a list asks Stripe for at most 100 rows, handing back `nextPageToken` (the last id) for the next page.
// DECISION: recordId and siteId ride in Stripe metadata. Checkout puts them on the session and on the payment or subscription it creates, so the later events carry them.
// Every object this module creates also carries metadata.vyre_trace (ARCH trace propagation).
// DECISION: the signature is checked by `verifyWebhook`, which the host's /hooks/stripe route calls first (the connector source says `verify: 'hmac'`; Stripe signs
// `t.body` with HMAC-SHA256 under the webhook secret). Only a verified body is passed through `parseWebhook` to stripe.receive_webhook.
// DECISION: charge.refunded is not mapped to refund.created: Stripe sends it beside refund.created for the same refund, and one refund must count once.
// DECISION: a Stripe object that carries no money (a subscription with no priced item) arrives as 0 USD, because stripe.receive_webhook always carries an amount.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { api, bad, ensure, first, HANDLE, intOrUndef, list, ms, needHost, obj, raw, secs, stripeId, strOrUndef, text, upper } from "../projections.ts";
import type { Json, StripeCtx } from "../projections.ts";

const PAGE_MAX = 100;
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const REC = /^rec_[a-z0-9]+$/;
const SITE = /^sit_[a-z0-9]+$/;

// ---- shapes out

export interface CustomerOut { id: string; email?: string; name?: string; created?: number; metadata?: Record<string, string> }
export interface PaymentIntentOut { id: string; amount: number; currency: string; status: string; customerId?: string; receiptEmail?: string; created: number; metadata?: Record<string, string> }
export interface InvoiceOut { id: string; amount: number; currency: string; status: string; customerId?: string; hostedUrl?: string; dueDate?: number }
export interface SubscriptionOut { id: string; status: string; customerId: string; priceId?: string; currentPeriodEnd?: number; cancelAtPeriodEnd: boolean }

/** A Stripe reference is either an id or the expanded object; both give the id. */
const idOf = (v: unknown): string | undefined => (typeof v === "string" && v ? v : strOrUndef(obj(v).id));

function metadataOf(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Json)) if (typeof x === "string") out[k] = x;
  return out;
}

function mapCustomer(c: Json): CustomerOut {
  const out: CustomerOut = { id: text(c.id) };
  const email = strOrUndef(c.email);
  if (email && EMAIL.test(email)) out.email = email;
  const name = strOrUndef(c.name);
  if (name) out.name = name;
  const created = ms(c.created);
  if (created !== undefined) out.created = created;
  const metadata = metadataOf(c.metadata);
  if (metadata) out.metadata = metadata;
  return out;
}

function mapPaymentIntent(p: Json): PaymentIntentOut {
  const out: PaymentIntentOut = { id: text(p.id), amount: intOrUndef(p.amount) ?? 0, currency: upper(p.currency), status: text(p.status), created: ms(p.created) ?? 0 };
  const customerId = idOf(p.customer);
  if (customerId) out.customerId = customerId;
  const receipt = strOrUndef(p.receipt_email);
  if (receipt && EMAIL.test(receipt)) out.receiptEmail = receipt;
  const metadata = metadataOf(p.metadata);
  if (metadata) out.metadata = metadata;
  return out;
}

function mapInvoice(i: Json): InvoiceOut {
  const out: InvoiceOut = { id: text(i.id), amount: intOrUndef(i.amount_due) ?? 0, currency: upper(i.currency), status: text(i.status) };
  const customerId = idOf(i.customer);
  if (customerId) out.customerId = customerId;
  const url = strOrUndef(i.hosted_invoice_url);
  if (url) out.hostedUrl = url;
  const due = ms(i.due_date);
  if (due !== undefined) out.dueDate = due;
  return out;
}

function mapSubscription(s: Json): SubscriptionOut {
  const item = obj(list(obj(s.items).data)[0]);
  const out: SubscriptionOut = { id: text(s.id), status: text(s.status), customerId: idOf(s.customer) ?? "", cancelAtPeriodEnd: s.cancel_at_period_end === true };
  const price = idOf(obj(item).price);
  if (price) out.priceId = price;
  const end = ms(s.current_period_end) ?? ms(item.current_period_end);   // newer API versions moved the period to the item
  if (end !== undefined) out.currentPeriodEnd = end;
  return out;
}

// ---- lists

interface PageIn { pageToken?: string; cursor?: string; limit?: number }

function pageQuery(ctx: StripeCtx, input: PageIn): Record<string, string | number> {
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1) bad(ctx, "The limit is 1 or more.");
  const q: Record<string, string | number> = { limit: Math.min(limit, PAGE_MAX) };
  const after = input.pageToken ?? input.cursor;
  if (after !== undefined) q.starting_after = stripeId(ctx, after, "The page token");
  return q;
}

async function listOf(ctx: StripeCtx, path: string, input: PageIn, extra: Record<string, string | number | boolean | undefined>): Promise<{ rows: Json[]; next?: string }> {
  const res = await api(ctx, { path, query: { ...extra, ...pageQuery(ctx, input) } });
  const rows = list(res.data).map(obj);
  const last = rows[rows.length - 1];
  return res.has_more === true && last && text(last.id) ? { rows, next: text(last.id) } : { rows };
}

const withNext = <K extends string, T>(key: K, rows: T[], next: string | undefined): { [P in K]: T[] } & { nextPageToken?: string } =>
  ({ [key]: rows, ...(next ? { nextPageToken: next } : {}) }) as { [P in K]: T[] } & { nextPageToken?: string };

// ---- customers, products, prices

export async function customerGet(ctx: StripeCtx, input: { customerId: string }): Promise<{ customer: CustomerOut }> {
  ensure(ctx);
  return { customer: mapCustomer(await api(ctx, { path: `/v1/customers/${stripeId(ctx, input.customerId, "The customer")}` })) };
}

export async function customerList(ctx: StripeCtx, input: PageIn & { email?: string }) {
  ensure(ctx);
  if (input.email !== undefined && !EMAIL.test(input.email)) bad(ctx, "That is not an email address.");
  const { rows, next } = await listOf(ctx, "/v1/customers", input, { email: input.email });
  return withNext("customers", rows.map(mapCustomer), next);
}

/** The metadata a call sends: the caller's own pairs, then ours, which cannot be overridden. */
function metadataFor(ctx: StripeCtx, given: Record<string, string> | undefined, refs: { recordId?: string; siteId?: string } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (given !== undefined) {
    if (typeof given !== "object" || Array.isArray(given) || Object.keys(given).length > 40) bad(ctx, "Metadata is up to 40 name and value pairs.");
    for (const [k, v] of Object.entries(given)) {
      if (!k || k.length > 40 || typeof v !== "string" || v.length > 500) bad(ctx, "A metadata name is up to 40 characters and its value up to 500.");
      out[k] = v;
    }
  }
  if (refs.recordId !== undefined) {
    if (!REC.test(refs.recordId)) bad(ctx, "The record is not a record id.");
    out.recordId = refs.recordId;
  }
  if (refs.siteId !== undefined) {
    if (!SITE.test(refs.siteId)) bad(ctx, "The site is not a site id.");
    out.siteId = refs.siteId;
  }
  out.vyre_trace = ctx.trace.traceId;
  return out;
}

export async function customerCreate(ctx: StripeCtx, input: { email?: string; name?: string; metadata?: Record<string, string>; idempotencyKey?: string }): Promise<{ customer: CustomerOut }> {
  ensure(ctx);
  if (input.email !== undefined && !EMAIL.test(input.email)) bad(ctx, "That is not an email address.");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 256)) bad(ctx, "A name is up to 256 characters.");
  const form: Json = { metadata: metadataFor(ctx, input.metadata) };
  if (input.email) form.email = input.email;
  if (input.name) form.name = input.name;
  return { customer: mapCustomer(await api(ctx, { method: "POST", path: "/v1/customers", form, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) })) };
}

export async function productList(ctx: StripeCtx, input: PageIn & { active?: boolean }) {
  ensure(ctx);
  const { rows, next } = await listOf(ctx, "/v1/products", input, { active: input.active });
  return withNext("products", rows.map((p) => ({ id: text(p.id), name: text(p.name), active: p.active === true })), next);
}

export async function priceList(ctx: StripeCtx, input: PageIn & { productId?: string; active?: boolean }) {
  ensure(ctx);
  const product = input.productId === undefined ? undefined : stripeId(ctx, input.productId, "The product");
  const { rows, next } = await listOf(ctx, "/v1/prices", input, { product, active: input.active });
  const prices = rows.map((p) => {
    const interval = text(obj(p.recurring).interval);
    const out: { id: string; productId: string; unitAmount?: number; currency: string; recurring?: "day" | "week" | "month" | "year"; active: boolean } = {
      id: text(p.id), productId: idOf(p.product) ?? "", currency: upper(p.currency), active: p.active === true,
    };
    const amount = intOrUndef(p.unit_amount);
    if (amount !== undefined) out.unitAmount = amount;
    if (interval === "day" || interval === "week" || interval === "month" || interval === "year") out.recurring = interval;
    return out;
  });
  return withNext("prices", prices, next);
}

// ---- checkout, payment links, portal

interface LineItemIn { priceId?: string; name?: string; unitAmount?: number; currency?: string; quantity: number }

function lineItems(ctx: StripeCtx, items: LineItemIn[], subscription: boolean): Json[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) bad(ctx, "A checkout has 1 to 20 line items.");
  return items.map((i) => {
    if (!Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 10_000) bad(ctx, "A quantity is 1 to 10000.");
    if (i.priceId !== undefined) return { price: stripeId(ctx, i.priceId, "The price"), quantity: i.quantity };
    if (subscription) bad(ctx, "A subscription needs a Stripe price for each item.");
    if (!i.name || !Number.isSafeInteger(i.unitAmount) || (i.unitAmount ?? -1) < 0 || !i.currency || !/^[A-Za-z]{3}$/.test(i.currency)) {
      bad(ctx, "An item without a price needs a name, an amount and a currency.");
    }
    return { price_data: { currency: i.currency.toLowerCase(), unit_amount: i.unitAmount, product_data: { name: i.name } }, quantity: i.quantity };
  });
}

function pageUrl(ctx: StripeCtx, v: unknown, what: string): string {
  if (typeof v !== "string" || v.length > 2000) bad(ctx, `${what} must be a web address.`);
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return bad(ctx, `${what} must be a web address.`);
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) bad(ctx, `${what} must start with https://.`);
  return v;
}

export async function checkoutCreateSession(
  ctx: StripeCtx,
  input: {
    mode: "payment" | "subscription" | "setup"; lineItems: LineItemIn[]; successUrl: string; cancelUrl: string; customerId?: string; customerEmail?: string;
    metadata?: Record<string, string>; recordId?: string; siteId?: string; idempotencyKey?: string;
  },
): Promise<{ sessionId: string; url: string }> {
  ensure(ctx);
  if (input.mode !== "payment" && input.mode !== "subscription" && input.mode !== "setup") bad(ctx, "The mode is payment, subscription or setup.");
  if (input.customerEmail !== undefined && !EMAIL.test(input.customerEmail)) bad(ctx, "That is not an email address.");
  const items = lineItems(ctx, input.lineItems, input.mode === "subscription");
  const metadata = metadataFor(ctx, input.metadata, input);
  const form: Json = { mode: input.mode, success_url: pageUrl(ctx, input.successUrl, "The success address"), cancel_url: pageUrl(ctx, input.cancelUrl, "The cancel address"), metadata };
  // A setup session has no line items in Stripe; the contract asks for at least one, which only validates the caller's intent.
  if (input.mode !== "setup") form.line_items = items;
  if (input.mode === "payment") form.payment_intent_data = { metadata };
  if (input.mode === "subscription") form.subscription_data = { metadata };
  if (input.customerId) form.customer = stripeId(ctx, input.customerId, "The customer");
  else if (input.customerEmail) form.customer_email = input.customerEmail;
  const s = await api(ctx, { method: "POST", path: "/v1/checkout/sessions", form, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
  const url = strOrUndef(s.url);
  if (!text(s.id) || !url) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Stripe made a session with no page to send the customer to." });
  return { sessionId: text(s.id), url };
}

export async function paymentLinkCreate(
  ctx: StripeCtx, input: { lineItems: LineItemIn[]; metadata?: Record<string, string>; recordId?: string; siteId?: string; idempotencyKey?: string },
): Promise<{ linkId: string; url: string }> {
  ensure(ctx);
  // A payment link takes Stripe prices only: it has no room for an ad-hoc amount.
  for (const i of input.lineItems ?? []) if (i.priceId === undefined) bad(ctx, "A payment link needs a Stripe price for each item.");
  const form: Json = { line_items: lineItems(ctx, input.lineItems, false), metadata: metadataFor(ctx, input.metadata, input) };
  const l = await api(ctx, { method: "POST", path: "/v1/payment_links", form, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
  const url = strOrUndef(l.url);
  if (!text(l.id) || !url) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Stripe made a payment link with no address." });
  return { linkId: text(l.id), url };
}

export async function customerPortalCreateSession(ctx: StripeCtx, input: { customerId: string; returnUrl: string; idempotencyKey?: string }): Promise<{ url: string }> {
  ensure(ctx);
  const form = { customer: stripeId(ctx, input.customerId, "The customer"), return_url: pageUrl(ctx, input.returnUrl, "The return address") };
  const s = await api(ctx, { method: "POST", path: "/v1/billing_portal/sessions", form, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
  const url = strOrUndef(s.url);
  if (!url) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Stripe made a portal session with no address." });
  return { url };
}

// ---- payments, invoices, subscriptions, refunds

export async function paymentIntentGet(ctx: StripeCtx, input: { paymentIntentId: string }): Promise<{ paymentIntent: PaymentIntentOut }> {
  ensure(ctx);
  return { paymentIntent: mapPaymentIntent(await api(ctx, { path: `/v1/payment_intents/${stripeId(ctx, input.paymentIntentId, "The payment")}` })) };
}

export async function paymentIntentList(ctx: StripeCtx, input: PageIn & { customerId?: string; from?: number; to?: number }) {
  ensure(ctx);
  for (const t of [input.from, input.to]) if (t !== undefined && (!Number.isSafeInteger(t) || t < 0)) bad(ctx, "Times are milliseconds since the epoch.");
  if (input.from !== undefined && input.to !== undefined && input.to < input.from) bad(ctx, "The range ends after it starts.");
  const extra: Record<string, string | number | undefined> = {
    customer: input.customerId === undefined ? undefined : stripeId(ctx, input.customerId, "The customer"),
    "created[gte]": input.from === undefined ? undefined : secs(input.from),
    "created[lte]": input.to === undefined ? undefined : secs(input.to),
  };
  const { rows, next } = await listOf(ctx, "/v1/payment_intents", input, extra);
  return withNext("paymentIntents", rows.map(mapPaymentIntent), next);
}

export async function invoiceGet(ctx: StripeCtx, input: { invoiceId: string }): Promise<{ invoice: InvoiceOut }> {
  ensure(ctx);
  return { invoice: mapInvoice(await api(ctx, { path: `/v1/invoices/${stripeId(ctx, input.invoiceId, "The invoice")}` })) };
}

export async function invoiceList(ctx: StripeCtx, input: PageIn & { customerId?: string; status?: string }) {
  ensure(ctx);
  if (input.status !== undefined && !["draft", "open", "paid", "uncollectible", "void"].includes(input.status)) bad(ctx, "An invoice status is draft, open, paid, uncollectible or void.");
  const { rows, next } = await listOf(ctx, "/v1/invoices", input, { customer: input.customerId === undefined ? undefined : stripeId(ctx, input.customerId, "The customer"), status: input.status });
  return withNext("invoices", rows.map(mapInvoice), next);
}

export async function invoiceSend(ctx: StripeCtx, input: { invoiceId: string; idempotencyKey?: string }): Promise<{ invoice: InvoiceOut }> {
  ensure(ctx);
  const path = `/v1/invoices/${stripeId(ctx, input.invoiceId, "The invoice")}/send`;
  return { invoice: mapInvoice(await api(ctx, { method: "POST", path, form: {}, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) })) };
}

export async function subscriptionGet(ctx: StripeCtx, input: { subscriptionId: string }): Promise<{ subscription: SubscriptionOut }> {
  ensure(ctx);
  return { subscription: mapSubscription(await api(ctx, { path: `/v1/subscriptions/${stripeId(ctx, input.subscriptionId, "The subscription")}` })) };
}

const SUB_STATUS = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused", "all", "ended"];

export async function subscriptionList(ctx: StripeCtx, input: PageIn & { customerId?: string; status?: string }) {
  ensure(ctx);
  if (input.status !== undefined && !SUB_STATUS.includes(input.status)) bad(ctx, "That is not a subscription status.");
  const { rows, next } = await listOf(ctx, "/v1/subscriptions", input, { customer: input.customerId === undefined ? undefined : stripeId(ctx, input.customerId, "The customer"), status: input.status });
  return withNext("subscriptions", rows.map(mapSubscription), next);
}

export async function subscriptionCancel(ctx: StripeCtx, input: { subscriptionId: string; atPeriodEnd?: boolean; idempotencyKey?: string }): Promise<{ subscription: SubscriptionOut }> {
  ensure(ctx);
  const path = `/v1/subscriptions/${stripeId(ctx, input.subscriptionId, "The subscription")}`;
  if (input.atPeriodEnd !== undefined && typeof input.atPeriodEnd !== "boolean") bad(ctx, "At period end is true or false.");
  const idem = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {};
  const res = input.atPeriodEnd === true
    ? await api(ctx, { method: "POST", path, form: { cancel_at_period_end: true }, ...idem })
    : await api(ctx, { method: "DELETE", path, ...idem });
  return { subscription: mapSubscription(res) };
}

export async function refundCreate(
  ctx: StripeCtx, input: { paymentIntentId: string; amount?: number; reason?: "duplicate" | "fraudulent" | "requested_by_customer"; idempotencyKey?: string },
): Promise<{ refundId: string; status: string }> {
  ensure(ctx);
  if (input.amount !== undefined && (!Number.isSafeInteger(input.amount) || input.amount < 1)) bad(ctx, "A refund amount is a whole number of cents, 1 or more.");
  if (input.reason !== undefined && !["duplicate", "fraudulent", "requested_by_customer"].includes(input.reason)) bad(ctx, "A reason is duplicate, fraudulent or requested_by_customer.");
  const form: Json = { payment_intent: stripeId(ctx, input.paymentIntentId, "The payment"), metadata: { vyre_trace: ctx.trace.traceId } };
  if (input.amount !== undefined) form.amount = input.amount;
  if (input.reason !== undefined) form.reason = input.reason;
  const r = await api(ctx, { method: "POST", path: "/v1/refunds", form, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
  if (!text(r.id)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Stripe answered a refund with no id." });
  return { refundId: text(r.id), status: text(r.status) || "unknown" };
}

// ---- health

export async function health(ctx: StripeCtx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const t0 = ctx.now();
  try {
    const a = await raw(ctx, { path: "/v1/balance" });
    const latencyMs = Math.max(0, ctx.now() - t0);
    if (a.status < 300) return { state: "healthy", latencyMs };
    if (a.status === 401 || a.status === 403) return { state: "down", detail: "Stripe did not accept the key. Check Stripe_Key in the Vault and that it can read the balance." };
    if (a.status === 429) return { state: "degraded", detail: "Stripe is asking us to slow down.", latencyMs };
    return { state: "degraded", detail: "Stripe is not answering well right now.", latencyMs };
  } catch (e) {
    if (e instanceof HostError && e.error.code === "internal.unavailable") return { state: "down", detail: "Stripe is not set up on this server." };
    if (e instanceof HostError && e.error.code === "provider.network") return { state: "down", detail: "Stripe could not be reached." };
    if (e instanceof HostError && e.error.code === "provider.auth_failed") return { state: "down", detail: "There is no Stripe key. Add Stripe_Key to the Vault." };
    throw e;
  }
}

// ---- the webhook (/hooks/stripe)

const utf8 = (v: string) => new TextEncoder().encode(v);

/** HMAC through the platform's Web Crypto (B3: product code does not import node:crypto). The key is the Vault secret handed over for this one call. */
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, utf8(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The Stripe-Signature header is `t=<seconds>,v1=<hex>[,v1=<hex>]`; the signed text is `<t>.<body>`. */
export async function signatureOf(secret: string, timestamp: number, body: string): Promise<string> {
  return hmacHex(secret, `${timestamp}.${body}`);
}

const TOLERANCE_S = 300;

/** True when the header carries a v1 signature of this body made with the secret, no more than five minutes from `nowMs`. The whole string is compared whatever the first difference. */
export async function signatureMatches(secret: string, header: string, body: string, nowMs: number): Promise<boolean> {
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v !== undefined) t = Number(v);
    if (k === "v1" && v !== undefined) v1.push(v);
  }
  if (!Number.isSafeInteger(t) || !v1.length || Math.abs(secs(nowMs) - t) > TOLERANCE_S) return false;
  const want = await signatureOf(secret, t, body);
  let ok = false;
  for (const got of v1) {
    let diff = got.length ^ want.length;
    for (let i = 0; i < want.length; i++) diff |= (got.charCodeAt(i) || 0) ^ want.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  return ok;
}

/** What the host's /hooks/stripe route calls first: the body is Stripe's only if the signature is. Returns the input of stripe.receive_webhook, or null for an event with no object to name. */
export async function verifyWebhook(ctx: StripeCtx, a: { signature: string | undefined; body: string }): Promise<WebhookIn | null> {
  const secret = await needHost(ctx).secret(ctx, HANDLE.webhook);
  if (!a.signature || !(await signatureMatches(secret, a.signature, a.body, ctx.now()))) {
    throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request was not signed by Stripe." });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(a.body);
  } catch {
    return bad(ctx, "The body is not JSON.");
  }
  return parseWebhook(parsed, ctx.now());
}

export interface WebhookIn {
  eventId: string;
  type: string;
  objectId: string;
  customerId?: string;
  recordId?: string;
  siteId?: string;
  amount: number;
  currency: string;
  at: number;
}

/** The event type to the payment event it becomes. */
const PAID = {
  "checkout.session.completed": "checkout.completed", "checkout.session.async_payment_succeeded": "checkout.completed",
  "payment_intent.succeeded": "payment.succeeded", "payment_intent.payment_failed": "payment.failed",
  "invoice.paid": "invoice.paid", "invoice.payment_succeeded": "invoice.paid", "invoice.payment_failed": "invoice.payment_failed",
  "refund.created": "refund.created", "charge.dispute.created": "dispute.created",
} as const;
const SUBS = { "customer.subscription.created": "subscription.created", "customer.subscription.updated": "subscription.updated", "customer.subscription.deleted": "subscription.canceled" } as const;

function moneyOf(type: string, o: Json): { amount: number; currency: string } {
  const item = obj(list(obj(o.items).data)[0]);
  const price = obj(item.price);
  let amount: number | undefined;
  if (type.startsWith("checkout.session.")) amount = intOrUndef(o.amount_total);
  else if (type.startsWith("payment_intent.")) amount = (intOrUndef(o.amount_received) ?? 0) > 0 ? intOrUndef(o.amount_received) : intOrUndef(o.amount);
  else if (type === "invoice.paid" || type === "invoice.payment_succeeded") amount = intOrUndef(o.amount_paid);
  else if (type.startsWith("invoice.")) amount = intOrUndef(o.amount_due);
  else if (type.startsWith("customer.subscription.")) amount = intOrUndef(price.unit_amount);
  else amount = intOrUndef(o.amount);
  const currency = upper(o.currency) || upper(price.currency);
  return { amount: Math.max(0, amount ?? 0), currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD" };
}

/** A verified Stripe event object to the input of stripe.receive_webhook. Null when it has no id, type or object id to name. */
export function parseWebhook(body: unknown, now: number): WebhookIn | null {
  const e = obj(body);
  const eventId = text(e.id);
  const type = text(e.type);
  const o = obj(obj(e.data).object);
  const objectId = text(o.id);
  if (!eventId || !type || !objectId) return null;
  const out: WebhookIn = { eventId, type, objectId, ...moneyOf(type, o), at: ms(e.created) ?? now };
  const customer = idOf(o.customer);
  if (customer) out.customerId = customer;
  // The refs ride on the object's metadata; an invoice carries its subscription's on subscription_details or on its first line.
  const sources = [o.metadata, obj(o.subscription_details).metadata, obj(list(obj(o.lines).data)[0]).metadata];
  for (const meta of sources) {
    const m = obj(meta);
    if (out.recordId === undefined && REC.test(text(m.recordId))) out.recordId = text(m.recordId);
    if (out.siteId === undefined && SITE.test(text(m.siteId))) out.siteId = text(m.siteId);
  }
  return out;
}

export async function receiveWebhook(ctx: StripeCtx, input: WebhookIn): Promise<{ accepted: boolean }> {
  ensure(ctx);
  if (!input.eventId || !input.type || !input.objectId) bad(ctx, "An event needs its id, its type and the id of what it is about.");
  if (first(ctx.db.all(`SELECT "eventId" FROM stripe_event_log WHERE "eventId" = ?`, input.eventId))) return { accepted: true };   // sent twice: applied once
  ctx.db.run(`INSERT OR IGNORE INTO stripe_event_log ("eventId", "type", "objectId", "at") VALUES (?, ?, ?, ?)`, input.eventId, input.type, input.objectId, ctx.now());
  ctx.emit("stripe.event_received", `entity/${input.eventId}`, { eventId: input.eventId, type: input.type, objectId: input.objectId });
  const refs: Json = { eventId: input.eventId };
  if (input.customerId) refs.customerId = input.customerId;
  if (input.recordId) refs.recordId = input.recordId;
  if (input.siteId) refs.siteId = input.siteId;
  const paid = (PAID as Record<string, string>)[input.type];
  if (paid) {
    ctx.emit(paid, `entity/${input.objectId}`, { ...refs, objectId: input.objectId, amount: input.amount, currency: input.currency });
    return { accepted: true };
  }
  const sub = (SUBS as Record<string, string>)[input.type];
  if (sub) await emitSubscription(ctx, sub, input, refs);
  return { accepted: true };
}

/** The webhook does not carry a subscription's status or price, so subscription.created and subscription.updated read it from Stripe; a read that fails still lets the event through. */
async function emitSubscription(ctx: StripeCtx, name: string, input: WebhookIn, refs: Json): Promise<void> {
  const payload: Json = { ...refs, subscriptionId: input.objectId };
  if (name !== "subscription.canceled") {
    let found: SubscriptionOut | undefined;
    try {
      found = (await subscriptionGet(ctx, { subscriptionId: input.objectId })).subscription;
    } catch (e) {
      ctx.log.warn("stripe: could not read the subscription for its event", { code: (e as { error?: { code?: string } })?.error?.code ?? "" });
    }
    if (name === "subscription.created" && found?.priceId) payload.priceId = found.priceId;
    if (name === "subscription.updated") payload.status = found?.status || "unknown";
  }
  ctx.emit(name, `entity/${input.objectId}`, payload);
}
