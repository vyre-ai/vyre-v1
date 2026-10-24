# stripe.subscription.get

Read a subscription

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
| HTTP | POST /v1/stripe/subscription/get |
| MCP tool | stripe_subscription_get (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  subscriptionId: string;
};
```

## Output

```ts
type Out = {
  subscription: {
    id: string;
    status: string;
    customerId: string;
    priceId?: string;
    currentPeriodEnd?: number;
    cancelAtPeriodEnd: boolean;
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
    "subscriptionId": "example"
  },
  "output": {
    "subscription": {
      "cancelAtPeriodEnd": true,
      "currentPeriodEnd": 1760000000000,
      "customerId": "example",
      "id": "example",
      "priceId": "example",
      "status": "example"
    }
  }
}
```
