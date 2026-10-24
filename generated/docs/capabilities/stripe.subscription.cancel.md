# stripe.subscription.cancel

Cancel a subscription now or at period end

| | |
|---|---|
| Module | stripe |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | delete |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/stripe/subscription/cancel |
| MCP tool | stripe_subscription_cancel (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  subscriptionId: string;
  atPeriodEnd?: boolean;
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "atPeriodEnd": true,
    "idempotencyKey": "idem_1",
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
