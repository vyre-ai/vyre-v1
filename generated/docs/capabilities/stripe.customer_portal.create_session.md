# stripe.customer_portal.create_session

Create a billing portal session for a customer

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
| HTTP | POST /v1/stripe/customer_portal/create_session |
| MCP tool | stripe_customer_portal_create_session (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  customerId: string;
  returnUrl: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
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
    "customerId": "example",
    "idempotencyKey": "idem_1",
    "returnUrl": "example"
  },
  "output": {
    "url": "example"
  }
}
```
