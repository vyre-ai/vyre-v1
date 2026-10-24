# stripe.checkout.create_session

Create a Checkout session for a site (payment, subscription or setup)

| | |
|---|---|
| Module | stripe |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/stripe/checkout/create_session |
| MCP tool | stripe_checkout_create_session (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  mode: "payment" | "subscription" | "setup";
  lineItems: Array<{
      priceId?: string;
      name?: string;
      unitAmount?: number;
      currency?: string;
      quantity: number;
    }>;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
  recordId?: string;
  siteId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sessionId: string;
  url: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cancelUrl": "example",
    "customerEmail": "maya@example.com",
    "customerId": "example",
    "idempotencyKey": "idem_1",
    "lineItems": [
      {
        "currency": "example",
        "name": "example",
        "priceId": "example",
        "quantity": 1,
        "unitAmount": 1
      }
    ],
    "metadata": {},
    "mode": "payment",
    "recordId": "rec_a1b2c3",
    "siteId": "sit_a1b2c3",
    "successUrl": "example"
  },
  "output": {
    "sessionId": "example",
    "url": "example"
  }
}
```
