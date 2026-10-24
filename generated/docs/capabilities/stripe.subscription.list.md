# stripe.subscription.list

List subscriptions

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
| HTTP | POST /v1/stripe/subscription/list |
| MCP tool | stripe_subscription_list (sites, deferred) |
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
  subscriptions: Array<{
      id: string;
      status: string;
      customerId: string;
      priceId?: string;
      currentPeriodEnd?: number;
      cancelAtPeriodEnd: boolean;
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
    "nextPageToken": "example",
    "subscriptions": [
      {
        "cancelAtPeriodEnd": true,
        "currentPeriodEnd": 1760000000000,
        "customerId": "example",
        "id": "example",
        "priceId": "example",
        "status": "example"
      }
    ]
  }
}
```
