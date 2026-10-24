# stripe.payment_link.create

Create a reusable payment link

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
| HTTP | POST /v1/stripe/payment_link/create |
| MCP tool | stripe_payment_link_create (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  lineItems: Array<{
      priceId?: string;
      name?: string;
      unitAmount?: number;
      currency?: string;
      quantity: number;
    }>;
  metadata?: Record<string, string>;
  recordId?: string;
  siteId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  linkId: string;
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
    "recordId": "rec_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "linkId": "example",
    "url": "example"
  }
}
```
