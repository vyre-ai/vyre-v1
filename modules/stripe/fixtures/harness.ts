// Test harness for the stripe handlers: an in-memory database, a recording ctx, a scripted Stripe (recorded responses matched by method and path, no socket is
// opened) and a fake host seam (the keys are made-up strings). The recorded bodies follow Stripe's API reference for the pinned version as of the recording
// (customers, products, prices, Checkout sessions, payment links, billing portal, payment intents, invoices, subscriptions, refunds, balance and events).
// Live-account proof waits on the owner's accounts (lead ruling 15); until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { API, setStripeHost } from "../projections.ts";
import type { StripeCtx, StripeHost } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const KEY = "rk_test_restricted_not_real";
export const WEBHOOK_SECRET = "whsec_test_not_real";

const customer = (id: string, email: string, name: string) => ({ id, object: "customer", created: 1_759_000_000, email, name, metadata: { recordId: "rec_lee01" } });

export const RECORDED = {
  customer: customer("cus_NffrFeUfNV2Hib", "pat@acme.test", "Pat Lee"),
  customers: { object: "list", url: "/v1/customers", has_more: true, data: [customer("cus_NffrFeUfNV2Hib", "pat@acme.test", "Pat Lee"), customer("cus_OOtherCustomer", "sam@acme.test", "Sam Fox")] },
  customersLast: { object: "list", url: "/v1/customers", has_more: false, data: [customer("cus_OLastCustomer", "kim@acme.test", "Kim Ng")] },
  products: { object: "list", has_more: false, data: [{ id: "prod_Retainer", object: "product", name: "Monthly retainer", active: true }, { id: "prod_Old", object: "product", name: "Old plan", active: false }] },
  prices: {
    object: "list", has_more: false,
    data: [
      { id: "price_1Retainer", object: "price", product: "prod_Retainer", unit_amount: 25000, currency: "usd", recurring: { interval: "month", interval_count: 1 }, active: true },
      { id: "price_1Flat", object: "price", product: "prod_Flat", unit_amount: null, currency: "usd", recurring: null, active: false },
    ],
  },
  session: { id: "cs_test_a1B2c3D4", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4", mode: "payment" },
  sessionNoUrl: { id: "cs_test_nourl", object: "checkout.session", url: null, mode: "setup" },
  link: { id: "plink_1Abc", object: "payment_link", url: "https://buy.stripe.com/test_abc123", active: true },
  portal: { id: "bps_1Abc", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/test_abc" },
  paymentIntent: {
    id: "pi_3NabcDEF", object: "payment_intent", amount: 50_000, amount_received: 50_000, currency: "usd", status: "succeeded", customer: "cus_NffrFeUfNV2Hib", receipt_email: "pat@acme.test",
    created: 1_759_500_000, metadata: { recordId: "rec_lee01", siteId: "sit_firm01" },
  },
  paymentIntents: { object: "list", has_more: false, data: [{ id: "pi_3NabcDEF", amount: 50_000, currency: "usd", status: "succeeded", customer: "cus_NffrFeUfNV2Hib", created: 1_759_500_000 }] },
  invoice: { id: "in_1Abc", object: "invoice", amount_due: 120_000, amount_paid: 0, currency: "usd", status: "open", customer: "cus_NffrFeUfNV2Hib", hosted_invoice_url: "https://invoice.stripe.com/i/acct_1/test_1Abc", due_date: 1_761_000_000 },
  invoiceSent: { id: "in_1Abc", object: "invoice", amount_due: 120_000, amount_paid: 0, currency: "usd", status: "open", customer: "cus_NffrFeUfNV2Hib", hosted_invoice_url: "https://invoice.stripe.com/i/acct_1/test_1Abc" },
  invoices: { object: "list", has_more: false, data: [{ id: "in_1Abc", amount_due: 120_000, currency: "usd", status: "open", customer: "cus_NffrFeUfNV2Hib" }] },
  subscription: {
    id: "sub_1Abc", object: "subscription", status: "active", customer: "cus_NffrFeUfNV2Hib", cancel_at_period_end: false, current_period_end: 1_762_600_000,
    items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_1Retainer", unit_amount: 25000, currency: "usd" } }] },
  },
  subscriptionItemPeriod: {
    id: "sub_1New", object: "subscription", status: "trialing", customer: { id: "cus_NffrFeUfNV2Hib" }, cancel_at_period_end: true,
    items: { data: [{ id: "si_2", current_period_end: 1_763_000_000, price: { id: "price_1Retainer", unit_amount: 25000, currency: "usd" } }] },
  },
  subscriptions: { object: "list", has_more: false, data: [{ id: "sub_1Abc", status: "active", customer: "cus_NffrFeUfNV2Hib", cancel_at_period_end: false }] },
  subscriptionCanceled: { id: "sub_1Abc", object: "subscription", status: "canceled", customer: "cus_NffrFeUfNV2Hib", cancel_at_period_end: false, items: { data: [] } },
  refund: { id: "re_3NabcDEF", object: "refund", status: "succeeded", amount: 10_000, payment_intent: "pi_3NabcDEF" },
  balance: { object: "balance", available: [{ amount: 100_000, currency: "usd" }], pending: [] },
  error404: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such customer: 'cus_secret_value_typed_by_a_person'", param: "customer" } },
  error400: { error: { type: "invalid_request_error", code: "parameter_invalid_integer", message: "Invalid integer: Pat Lee <pat@acme.test>" } },
  errorRefunded: { error: { type: "invalid_request_error", code: "charge_already_refunded", message: "Charge ch_1 has already been refunded." } },
  error401: { error: { type: "invalid_request_error", message: "Invalid API Key provided: rk_test_********" } },
} as const;

export function event(id: string, type: string, object: Record<string, unknown>, created = 1_760_000_000): Record<string, unknown> {
  return { id, object: "event", api_version: "2024-06-20", created, type, livemode: false, data: { object } };
}

/** Verified Stripe events as they arrive, one per type this module maps. */
export const EVENTS = {
  checkout: event("evt_checkout1", "checkout.session.completed", {
    id: "cs_test_a1B2c3D4", object: "checkout.session", amount_total: 50_000, currency: "usd", customer: "cus_NffrFeUfNV2Hib", metadata: { recordId: "rec_lee01", siteId: "sit_firm01", vyre_trace: "t" },
  }),
  paid: event("evt_pi_ok1", "payment_intent.succeeded", { id: "pi_3NabcDEF", object: "payment_intent", amount: 50_000, amount_received: 50_000, currency: "usd", customer: "cus_NffrFeUfNV2Hib", metadata: { siteId: "sit_firm01" } }),
  failed: event("evt_pi_bad1", "payment_intent.payment_failed", { id: "pi_3Nfail", object: "payment_intent", amount: 7_000, amount_received: 0, currency: "usd", customer: "cus_OOtherCustomer", metadata: {} }),
  invoicePaid: event("evt_inv_ok1", "invoice.paid", {
    id: "in_1Abc", object: "invoice", amount_due: 120_000, amount_paid: 120_000, currency: "usd", customer: "cus_NffrFeUfNV2Hib",
    subscription_details: { metadata: { recordId: "rec_lee01" } },
  }),
  invoiceFailed: event("evt_inv_bad1", "invoice.payment_failed", {
    id: "in_1Def", object: "invoice", amount_due: 9_900, amount_paid: 0, currency: "eur", customer: "cus_OOtherCustomer", lines: { data: [{ metadata: { siteId: "sit_firm01" } }] },
  }),
  refund: event("evt_ref1", "refund.created", { id: "re_3NabcDEF", object: "refund", amount: 10_000, currency: "usd", payment_intent: "pi_3NabcDEF", metadata: { vyre_trace: "t" } }),
  dispute: event("evt_dis1", "charge.dispute.created", { id: "dp_1Abc", object: "dispute", amount: 50_000, currency: "usd", charge: "ch_1Abc" }),
  subCreated: event("evt_sub_new1", "customer.subscription.created", {
    id: "sub_1Abc", object: "subscription", customer: "cus_NffrFeUfNV2Hib", metadata: { recordId: "rec_lee01", siteId: "sit_firm01" },
    items: { data: [{ price: { id: "price_1Retainer", unit_amount: 25000, currency: "usd" } }] },
  }),
  subUpdated: event("evt_sub_upd1", "customer.subscription.updated", { id: "sub_1Abc", object: "subscription", customer: "cus_NffrFeUfNV2Hib", items: { data: [] } }),
  subDeleted: event("evt_sub_del1", "customer.subscription.deleted", { id: "sub_1Abc", object: "subscription", customer: "cus_NffrFeUfNV2Hib", items: { data: [] } }),
  other: event("evt_other1", "customer.created", { id: "cus_NffrFeUfNV2Hib", object: "customer", email: "pat@acme.test" }),
} as const;

export interface Reply { status: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string; form: URLSearchParams }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }

export function harness() {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const scripted = new Map<string, Reply[]>();
  let clock = NOW;

  const host: StripeHost = {
    async secret(_ctx, handle) {
      if (handle === "#Stripe_Key") return KEY;
      if (handle === "#Stripe_Webhook_Secret") return WEBHOOK_SECRET;
      throw new Error(`unexpected secret ${handle}`);
    },
  };
  setStripeHost(host);

  const ctx: StripeCtx = {
    space: "spc_stripe",
    principal: { kind: "person", id: "usr_maya01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      called.push({ cap, input: input as Record<string, unknown> });
      throw new Error(`unexpected capability ${cap}`);
    },
    async http(url, init) {
      const method = init?.method ?? "GET";
      const [path = "", qs = ""] = (url.startsWith(API) ? url.slice(API.length) : url).split("?");
      const query = Object.fromEntries(new URLSearchParams(qs));
      const body = init?.body ?? "";
      requests.push({ method, path, query, headers: init?.headers ?? {}, body, form: new URLSearchParams(body) });
      const queue = scripted.get(`${method} ${path}`);
      if (!queue || queue.length === 0) throw new Error(`unscripted request ${method} ${path}`);
      const reply = queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
      if (reply.throws) throw new Error("socket hang up");
      const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { status: reply.status, text: async () => text };
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, requests, host,
    /** Script what Stripe answers to `METHOD /path` (no query); several replies for one request are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    last(): Seen { return requests[requests.length - 1] as Seen; },
  };
}

export type Harness = ReturnType<typeof harness>;

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** Errors of an event payload against the frozen schema of the event. */
export function payloadErrors(name: string, payload: unknown): string[] {
  const def = registry.events.filter((e) => e.name === name).sort((a, b) => b.sv - a.sv)[0];
  if (!def) return [`${name} is not in the registry`];
  return validate(def.payload, payload, "", registry.$defs);
}

/** The error code of a thrown HostError, or "" for anything else. */
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}

