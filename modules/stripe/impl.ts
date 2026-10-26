// stripe module entry (lane L5). The host serves the generated stubs while manifests/stripe.ts says `status: 'stub'`; the flip to live is a one-line edit to host/modules.json
// (ruling 25) once P-CI_02 has landed. The host registers its half once at boot with setStripeHost (the restricted key and the webhook secret from the Vault): see projections.ts.
// verifyWebhook is what the host's /hooks/stripe route calls first: it refuses a body Stripe did not sign and returns the input of stripe.receive_webhook.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { hostOnly } from "../../host/src/ctx/host-only.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { WebhookAccept } from "../../host/src/routes/webhooks.ts";
import { setStripeHost } from "./projections.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

export { setStripeHost };
export type { StripeHost } from "./projections.ts";
export { parseWebhook, signatureMatches, signatureOf, verifyWebhook } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "stripe.customer.get": (ctx, i) => h.customerGet(ctx, i),
  "stripe.customer.list": (ctx, i) => h.customerList(ctx, i),
  "stripe.customer.create": (ctx, i) => h.customerCreate(ctx, i),
  "stripe.product.list": (ctx, i) => h.productList(ctx, i),
  "stripe.price.list": (ctx, i) => h.priceList(ctx, i),
  "stripe.checkout.create_session": (ctx, i) => h.checkoutCreateSession(ctx, i),
  "stripe.payment_link.create": (ctx, i) => h.paymentLinkCreate(ctx, i),
  "stripe.customer_portal.create_session": (ctx, i) => h.customerPortalCreateSession(ctx, i),
  "stripe.payment_intent.get": (ctx, i) => h.paymentIntentGet(ctx, i),
  "stripe.payment_intent.list": (ctx, i) => h.paymentIntentList(ctx, i),
  "stripe.invoice.get": (ctx, i) => h.invoiceGet(ctx, i),
  "stripe.invoice.list": (ctx, i) => h.invoiceList(ctx, i),
  "stripe.invoice.send": (ctx, i) => h.invoiceSend(ctx, i),
  "stripe.subscription.get": (ctx, i) => h.subscriptionGet(ctx, i),
  "stripe.subscription.list": (ctx, i) => h.subscriptionList(ctx, i),
  "stripe.subscription.cancel": (ctx, i) => h.subscriptionCancel(ctx, i),
  "stripe.refund.create": (ctx, i) => h.refundCreate(ctx, i),
  "stripe.health": (ctx) => h.health(ctx),
  "stripe.receive_webhook": async (ctx, i) => { hostOnly(ctx, "stripe.receive_webhook"); return h.receiveWebhook(ctx, i); },
};

export const projections = { inline: {}, consumers: {} };

/** Where the host registers its half at boot (ruling 31). */
export const hostSeams: SeamSetters = { setStripeHost };

/** /hooks/stripe (P-L5_17): the host hands the raw request here; a body Stripe did not sign inside its time window is refused, anything else is recorded once. */
export const hostCalls = {
  "stripe.accept_webhook": async (ctx: Ctx, a: WebhookAccept): Promise<unknown> => {
    hostOnly(ctx, "stripe.accept_webhook");   // a host call: the webhook route is the only way in
    const input = await h.verifyWebhook(ctx, { signature: a.headers["stripe-signature"], body: a.body });
    return input === null ? { accepted: true } : h.receiveWebhook(ctx, input);   // an event with no object to name is acknowledged and ignored
  },
};
