# stripe.refund.create

Refund a payment in full or in part

| | |
|---|---|
| Module | stripe |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | pay |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/stripe/refund/create |
| MCP tool | stripe_refund_create (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  paymentIntentId: string;
  amount?: number;
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  refundId: string;
  status: string;
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
    "amount": 1,
    "idempotencyKey": "idem_1",
    "paymentIntentId": "example",
    "reason": "duplicate"
  },
  "output": {
    "refundId": "example",
    "status": "example"
  }
}
```
