# stripe.customer.get

Read a customer

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
| HTTP | POST /v1/stripe/customer/get |
| MCP tool | stripe_customer_get (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  customerId: string;
};
```

## Output

```ts
type Out = {
  customer: {
    id: string;
    email?: string;
    name?: string;
    created?: number;
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
    "customerId": "example"
  },
  "output": {
    "customer": {
      "created": 1760000000000,
      "email": "maya@example.com",
      "id": "cus_123",
      "metadata": {},
      "name": "example"
    }
  }
}
```
