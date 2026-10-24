# access.reviews.list

List access reviews

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/access/reviews/list |
| MCP tool | access_reviews_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: "open" | "closed";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  reviews: Array<{
      id: string;
      state: "open" | "closed";
      openedAt: number;
      closedAt?: number;
      items: number;
      decided: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "state": "open"
  },
  "output": {
    "next": "example",
    "reviews": [
      {
        "closedAt": 1760000000000,
        "decided": 1,
        "id": "rvw_a1b2c3",
        "items": 1,
        "openedAt": 1760000000000,
        "state": "open"
      }
    ],
    "total": 1
  }
}
```
