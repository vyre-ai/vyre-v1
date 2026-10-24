# stripe.payment_intent.get

Read a payment

| | |
|---|---|
| Module | stripe |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/stripe/payment_intent/get |
| MCP tool | stripe_payment_intent_get (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  paymentIntentId: string;
};
```

## Output

```ts
type Out = {
  paymentIntent: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    customerId?: string;
    receiptEmail?: string;
    created: number;
    metadata?: Record<string, string>;
  };
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
    "paymentIntentId": "example"
  },
  "output": {
    "paymentIntent": {
      "amount": 1,
      "created": 1760000000000,
      "currency": "USD",
      "customerId": "example",
      "id": "example",
      "metadata": {},
      "receiptEmail": "maya@example.com",
      "status": "example"
    }
  }
}
```
