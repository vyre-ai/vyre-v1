# stripe.receive_webhook

Record a verified Stripe event after dedupe and normalise it into the payment events

| | |
|---|---|
| Module | stripe |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/stripe/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | stripe.event_received, checkout.completed, payment.succeeded, payment.failed, subscription.created, subscription.updated, subscription.canceled, invoice.paid, invoice.payment_failed, refund.created, dispute.created |

## Input

```ts
type In = {
  eventId: string;
  type: string;
  objectId: string;
  customerId?: string;
  recordId?: string;
  siteId?: string;
  amount: number;
  currency: string;
  at: number;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "amount": 1,
    "at": 1760000000000,
    "currency": "USD",
    "customerId": "example",
    "eventId": "example",
    "objectId": "example",
    "recordId": "rec_a1b2c3",
    "siteId": "sit_a1b2c3",
    "type": "checkout.session.completed"
  },
  "output": {
    "accepted": true
  }
}
```
