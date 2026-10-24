# stripe.payment_intent.list

List payments

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
| HTTP | POST /v1/stripe/payment_intent/list |
| MCP tool | stripe_payment_intent_list (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  customerId?: string;
  from?: number;
  to?: number;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  paymentIntents: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      customerId?: string;
      receiptEmail?: string;
      created: number;
      metadata?: Record<string, string>;
    }>;
  nextPageToken?: string;
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
    "customerId": "example",
    "from": 1760000000000,
    "pageToken": "example",
    "to": 1760000000000
  },
  "output": {
    "nextPageToken": "example",
    "paymentIntents": [
      {
        "amount": 1,
        "created": 1760000000000,
        "currency": "USD",
        "customerId": "example",
        "id": "example",
        "metadata": {},
        "receiptEmail": "maya@example.com",
        "status": "example"
      }
    ]
  }
}
```
