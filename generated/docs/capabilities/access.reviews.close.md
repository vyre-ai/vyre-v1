# access.reviews.close

Close a review

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/access/reviews/close |
| MCP tool | access_reviews_close (engineer) |
| CLI | none |
| Emits | access_review.closed |

## Input

```ts
type In = {
  reviewId: string;
};
```

## Output

```ts
type Out = {
  review: {
    id: string;
    state: "open" | "closed";
    openedAt: number;
    closedAt?: number;
    items: number;
    decided: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "reviewId": "rvw_a1b2c3"
  },
  "output": {
    "review": {
      "closedAt": 1760000000000,
      "decided": 1,
      "id": "rvw_a1b2c3",
      "items": 1,
      "openedAt": 1760000000000,
      "state": "open"
    }
  }
}
```
