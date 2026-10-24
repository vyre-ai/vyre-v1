# stripe.invoice.list

List invoices

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
| HTTP | POST /v1/stripe/invoice/list |
| MCP tool | stripe_invoice_list (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  customerId?: string;
  status?: string;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  invoices: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      customerId?: string;
      hostedUrl?: string;
      dueDate?: number;
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
    "pageToken": "example",
    "status": "example"
  },
  "output": {
    "invoices": [
      {
        "amount": 1,
        "currency": "USD",
        "customerId": "example",
        "dueDate": 1760000000000,
        "hostedUrl": "example",
        "id": "example",
        "status": "example"
      }
    ],
    "nextPageToken": "example"
  }
}
```
