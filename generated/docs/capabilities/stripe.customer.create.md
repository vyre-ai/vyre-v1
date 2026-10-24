# stripe.customer.create

Create a customer

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
| HTTP | POST /v1/stripe/customer/create |
| MCP tool | stripe_customer_create (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "email": "maya@example.com",
    "idempotencyKey": "idem_1",
    "metadata": {},
    "name": "example"
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
