# stripe.price.list

List prices

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
| HTTP | POST /v1/stripe/price/list |
| MCP tool | stripe_price_list (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  productId?: string;
  active?: boolean;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  prices: Array<{
      id: string;
      productId: string;
      unitAmount?: number;
      currency: string;
      recurring?: "day" | "week" | "month" | "year";
      active: boolean;
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
    "active": true,
    "pageToken": "example",
    "productId": "example"
  },
  "output": {
    "nextPageToken": "example",
    "prices": [
      {
        "active": true,
        "currency": "example",
        "id": "example",
        "productId": "example",
        "recurring": "day",
        "unitAmount": 1
      }
    ]
  }
}
```
