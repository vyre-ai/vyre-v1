# stripe.invoice.send

Email an invoice to the customer

| | |
|---|---|
| Module | stripe |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/stripe/invoice/send |
| MCP tool | stripe_invoice_send (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  invoiceId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  invoice: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    customerId?: string;
    hostedUrl?: string;
    dueDate?: number;
  };
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
    "invoiceId": "example"
  },
  "output": {
    "invoice": {
      "amount": 1,
      "currency": "USD",
      "customerId": "example",
      "dueDate": 1760000000000,
      "hostedUrl": "example",
      "id": "example",
      "status": "example"
    }
  }
}
```
