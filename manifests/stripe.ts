// stripe (lane L5): Stripe connector. Restricted key in the Vault; used by sites for payments and as a source of payment
// events. Synced types are optional and not declared. ARCHITECTURE 8 table, spec 2.10 (Source: Stripe), 2.20.
// DECISION: toolset is `sites` because payments are used by sites; every provider action is deferred.
// DECISION: creating a checkout session, payment link, price or portal session only prepares a page; no money moves until
// the customer pays, so those use { act: 'none', reason }. Refunds use the Gate act 'pay'; sending an invoice uses 'send';
// canceling a subscription uses 'delete'.
// DECISION: Stripe object ids are provider strings (cus_..., pi_...), not Vyre ids. recordId and siteId ride in Stripe
// metadata so a normalised event can name the Vyre record or site it belongs to.
import { conn, defineManifest, ev, health, outward, read, t, write } from '../packages/contracts/src/index.ts';
import { email, id, pageIn } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const quiet = (what: string) => ({ act: 'none', reason: what });
const money = { amount: t.int({ minimum: 0, description: 'Smallest currency unit' }), currency: t.str({ pattern: '^[A-Z]{3}$', examples: ['USD'] }) };
const meta = t.opt(t.rec(t.str()));
const customer = t.obj({ id: t.str({ examples: ['cus_123'] }), email: t.opt(email), name: t.opt(t.str()), created: t.opt(t.ts()), metadata: meta });
const paymentIntent = t.obj({ id: t.str(), ...money, status: t.str(), customerId: t.opt(t.str()), receiptEmail: t.opt(email), created: t.ts(), metadata: meta });
const invoice = t.obj({ id: t.str(), ...money, status: t.str(), customerId: t.opt(t.str()), hostedUrl: t.opt(t.str()), dueDate: t.opt(t.ts()) });
const subscription = t.obj({ id: t.str(), status: t.str(), customerId: t.str(), priceId: t.opt(t.str()), currentPeriodEnd: t.opt(t.ts()), cancelAtPeriodEnd: t.bool() });
const lineItem = t.obj({ priceId: t.opt(t.str()), name: t.opt(t.str()), unitAmount: t.opt(t.int()), currency: t.opt(t.str()), quantity: t.int({ minimum: 1 }) });
const linkRefs = { recordId: t.opt(id.record), siteId: t.opt(id.site) };
const stripeEventType = t.str({ examples: ['checkout.session.completed'], description: 'Stripe event type string' });
const eventRefs = { eventId: t.str(), customerId: t.opt(t.str()), ...linkRefs };
const T = { tool: 'sites', deferred: true } as const;

const capabilities = [
  read('stripe.customer.get', 'Read a customer', { in: { customerId: t.str() }, out: { customer }, ...T }),
  read('stripe.customer.list', 'List or search customers', { in: { email: t.opt(email), pageToken: t.opt(t.str()), ...pageIn }, out: { customers: t.arr(customer), nextPageToken: t.opt(t.str()) }, ...T }),
  outward('stripe.customer.create', 'Create a customer', { in: { email: t.opt(email), name: t.opt(t.str()), metadata: meta }, out: { customer }, gate: quiet('Adds a customer to the Space Stripe account; nobody is contacted'), ...T }),
  read('stripe.product.list', 'List products', { in: { active: t.opt(t.bool()), pageToken: t.opt(t.str()) }, out: { products: t.arr(t.obj({ id: t.str(), name: t.str(), active: t.bool() })), nextPageToken: t.opt(t.str()) }, ...T }),
  read('stripe.price.list', 'List prices', {
    in: { productId: t.opt(t.str()), active: t.opt(t.bool()), pageToken: t.opt(t.str()) },
    out: { prices: t.arr(t.obj({ id: t.str(), productId: t.str(), unitAmount: t.opt(t.int()), currency: t.str(), recurring: t.opt(t.enm('day', 'week', 'month', 'year')), active: t.bool() })), nextPageToken: t.opt(t.str()) }, ...T,
  }),
  outward('stripe.checkout.create_session', 'Create a Checkout session for a site (payment, subscription or setup)', {
    in: { mode: t.enm('payment', 'subscription', 'setup'), lineItems: t.arr(lineItem, { minItems: 1 }), successUrl: t.str(), cancelUrl: t.str(), customerId: t.opt(t.str()), customerEmail: t.opt(email), metadata: meta, ...linkRefs },
    out: { sessionId: t.str(), url: t.str() }, gate: quiet('Creates a payment page; no money moves until the customer pays'), ...T,
  }),
  outward('stripe.payment_link.create', 'Create a reusable payment link', {
    in: { lineItems: t.arr(lineItem, { minItems: 1 }), metadata: meta, ...linkRefs }, out: { linkId: t.str(), url: t.str() }, gate: quiet('Creates a payment page; no money moves until the customer pays'), ...T,
  }),
  outward('stripe.customer_portal.create_session', 'Create a billing portal session for a customer', {
    in: { customerId: t.str(), returnUrl: t.str() }, out: { url: t.str() }, gate: quiet('Creates a short-lived portal link; nobody is contacted'), ...T,
  }),
  read('stripe.payment_intent.get', 'Read a payment', { in: { paymentIntentId: t.str() }, out: { paymentIntent }, ...T }),
  read('stripe.payment_intent.list', 'List payments', {
    in: { customerId: t.opt(t.str()), from: t.opt(t.ts()), to: t.opt(t.ts()), pageToken: t.opt(t.str()) }, out: { paymentIntents: t.arr(paymentIntent), nextPageToken: t.opt(t.str()) }, ...T,
  }),
  read('stripe.invoice.get', 'Read an invoice', { in: { invoiceId: t.str() }, out: { invoice }, ...T }),
  read('stripe.invoice.list', 'List invoices', { in: { customerId: t.opt(t.str()), status: t.opt(t.str()), pageToken: t.opt(t.str()) }, out: { invoices: t.arr(invoice), nextPageToken: t.opt(t.str()) }, ...T }),
  outward('stripe.invoice.send', 'Email an invoice to the customer', { in: { invoiceId: t.str() }, out: { invoice }, gate: 'send', ...T }),
  read('stripe.subscription.get', 'Read a subscription', { in: { subscriptionId: t.str() }, out: { subscription }, ...T }),
  read('stripe.subscription.list', 'List subscriptions', { in: { customerId: t.opt(t.str()), status: t.opt(t.str()), pageToken: t.opt(t.str()) }, out: { subscriptions: t.arr(subscription), nextPageToken: t.opt(t.str()) }, ...T }),
  outward('stripe.subscription.cancel', 'Cancel a subscription now or at period end', {
    in: { subscriptionId: t.str(), atPeriodEnd: t.opt(t.bool()) }, out: { subscription }, gate: 'delete', ...T,
  }),
  outward('stripe.refund.create', 'Refund a payment in full or in part', {
    in: { paymentIntentId: t.str(), amount: t.opt(t.int({ minimum: 1 })), reason: t.opt(t.enm('duplicate', 'fraudulent', 'requested_by_customer')) }, out: { refundId: t.str(), status: t.str() }, gate: 'pay', ...T,
  }),
  read('stripe.health', 'Health probe: GET /v1/balance', { in: {}, out: healthOut }),
  write('stripe.receive_webhook', 'Record a verified Stripe event after dedupe and normalise it into the payment events', {
    in: { eventId: t.str(), type: stripeEventType, objectId: t.str(), customerId: t.opt(t.str()), ...linkRefs, ...money, at: t.ts() },
    out: { accepted: t.bool() },
    emits: ['stripe.event_received', 'checkout.completed', 'payment.succeeded', 'payment.failed', 'subscription.created', 'subscription.updated', 'subscription.canceled', 'invoice.paid', 'invoice.payment_failed', 'refund.created', 'dispute.created'],
    idem: 'natural', offline: 'online',
  }),
];

const paid = (name: string, summary: string, title?: string) =>
  ev(name, summary, { p: { ...eventRefs, objectId: t.str(), ...money }, subject: ['entity', '/objectId'], label: 'subject', replay: 'stub', ...(title ? { trigger: { title, fields: ['/siteId', '/currency'] } } : {}) });

export default defineManifest({
  id: 'stripe',
  title: 'Stripe',
  kind: 'connector',
  owner: 'L5',
  events: [
    ev('stripe.event_received', 'A verified Stripe event arrived', { p: { eventId: t.str(), type: stripeEventType, objectId: t.str() }, subject: ['entity', '/eventId'] }),
    paid('checkout.completed', 'A customer completed Checkout', 'A checkout completes'),
    paid('payment.succeeded', 'A payment succeeded', 'A payment succeeds'),
    paid('payment.failed', 'A payment failed', 'A payment fails'),
    paid('invoice.paid', 'An invoice was paid', 'An invoice is paid'),
    paid('invoice.payment_failed', 'An invoice payment failed', 'An invoice payment fails'),
    paid('refund.created', 'A refund was created'),
    paid('dispute.created', 'A customer opened a dispute', 'A dispute opens'),
    ev('subscription.created', 'A subscription started', { p: { ...eventRefs, subscriptionId: t.str(), priceId: t.opt(t.str()) }, subject: ['entity', '/subscriptionId'], label: 'subject', trigger: { title: 'A subscription starts', fields: ['/siteId', '/priceId'] } }),
    ev('subscription.updated', 'A subscription changed', { p: { ...eventRefs, subscriptionId: t.str(), status: t.str() }, subject: ['entity', '/subscriptionId'], label: 'subject' }),
    ev('subscription.canceled', 'A subscription ended', { p: { ...eventRefs, subscriptionId: t.str() }, subject: ['entity', '/subscriptionId'], label: 'subject', trigger: { title: 'A subscription is canceled', fields: ['/siteId'] } }),
  ],
  capabilities,
  connectors: [
    conn('stripe', 'Stripe', {
      mode: 'api', scope: 'space', auth: { type: 'api_key', secret: 'Stripe_Key' }, domains: ['api.stripe.com'],
      secrets: [{ name: 'Stripe_Key', description: 'Restricted Stripe API key' }, { name: 'Stripe_Webhook_Secret', description: 'Signing secret for /hooks/stripe' }],
      sources: [{ key: 'stripe', path: '/hooks/stripe', verify: 'hmac', event: 'stripe.event_received', dedupe: '/eventId' }],
      actions: capabilities.map((c) => c.name), rate: { rps: 20, burst: 40 }, health: 'stripe.balance',
    }),
  ],
  health: [
    health('stripe.balance', 'Stripe', 'stripe.health', 'Check the Stripe_Key item in the Vault and that the restricted key still has read access.', { pauses: ['sends'] }),
  ],
});
