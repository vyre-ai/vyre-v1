# stripe.product.list

List products

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
| HTTP | POST /v1/stripe/product/list |
| MCP tool | stripe_product_list (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  active?: boolean;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  products: Array<{
      id: string;
      name: string;
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
    "pageToken": "example"
  },
  "output": {
    "nextPageToken": "example",
    "products": [
      {
        "active": true,
        "id": "example",
        "name": "example"
      }
    ]
  }
}
```
