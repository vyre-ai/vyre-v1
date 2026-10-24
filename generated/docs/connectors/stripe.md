# Stripe

Key stripe, module stripe. Mode api, owned by a space. Auth api_key.

## Egress domains

- api.stripe.com

## Secrets (names only)

- Stripe_Key: Restricted Stripe API key
- Stripe_Webhook_Secret: Signing secret for /hooks/stripe

## Webhook sources

- /hooks/stripe (hmac) emits stripe.event_received

## Actions

- stripe.customer.get
- stripe.customer.list
- stripe.customer.create
- stripe.product.list
- stripe.price.list
- stripe.checkout.create_session
- stripe.payment_link.create
- stripe.customer_portal.create_session
- stripe.payment_intent.get
- stripe.payment_intent.list
- stripe.invoice.get
- stripe.invoice.list
- stripe.invoice.send
- stripe.subscription.get
- stripe.subscription.list
- stripe.subscription.cancel
- stripe.refund.create
- stripe.health
- stripe.receive_webhook

## Synced types

