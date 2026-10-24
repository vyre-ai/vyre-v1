# Stripe (stripe)

Lane L5. Kind connector. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (19)

- [stripe.checkout.create_session](../capabilities/stripe.checkout.create_session.md): Create a Checkout session for a site (payment, subscription or setup)
- [stripe.customer.create](../capabilities/stripe.customer.create.md): Create a customer
- [stripe.customer.get](../capabilities/stripe.customer.get.md): Read a customer
- [stripe.customer.list](../capabilities/stripe.customer.list.md): List or search customers
- [stripe.customer_portal.create_session](../capabilities/stripe.customer_portal.create_session.md): Create a billing portal session for a customer
- [stripe.health](../capabilities/stripe.health.md): Health probe: GET /v1/balance
- [stripe.invoice.get](../capabilities/stripe.invoice.get.md): Read an invoice
- [stripe.invoice.list](../capabilities/stripe.invoice.list.md): List invoices
- [stripe.invoice.send](../capabilities/stripe.invoice.send.md): Email an invoice to the customer
- [stripe.payment_intent.get](../capabilities/stripe.payment_intent.get.md): Read a payment
- [stripe.payment_intent.list](../capabilities/stripe.payment_intent.list.md): List payments
- [stripe.payment_link.create](../capabilities/stripe.payment_link.create.md): Create a reusable payment link
- [stripe.price.list](../capabilities/stripe.price.list.md): List prices
- [stripe.product.list](../capabilities/stripe.product.list.md): List products
- [stripe.receive_webhook](../capabilities/stripe.receive_webhook.md): Record a verified Stripe event after dedupe and normalise it into the payment events
- [stripe.refund.create](../capabilities/stripe.refund.create.md): Refund a payment in full or in part
- [stripe.subscription.cancel](../capabilities/stripe.subscription.cancel.md): Cancel a subscription now or at period end
- [stripe.subscription.get](../capabilities/stripe.subscription.get.md): Read a subscription
- [stripe.subscription.list](../capabilities/stripe.subscription.list.md): List subscriptions

## Events (11)

- [checkout.completed](../events/checkout.completed.md): A customer completed Checkout
- [dispute.created](../events/dispute.created.md): A customer opened a dispute
- [invoice.paid](../events/invoice.paid.md): An invoice was paid
- [invoice.payment_failed](../events/invoice.payment_failed.md): An invoice payment failed
- [payment.failed](../events/payment.failed.md): A payment failed
- [payment.succeeded](../events/payment.succeeded.md): A payment succeeded
- [refund.created](../events/refund.created.md): A refund was created
- [stripe.event_received](../events/stripe.event_received.md): A verified Stripe event arrived
- [subscription.canceled](../events/subscription.canceled.md): A subscription ended
- [subscription.created](../events/subscription.created.md): A subscription started
- [subscription.updated](../events/subscription.updated.md): A subscription changed
