# access.reviews.decide

Keep a grant or remove it in one click

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
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/reviews/decide |
| MCP tool | access_reviews_decide (engineer) |
| CLI | none |
| Emits | grant.revoked, access.changed |

## Input

```ts
type In = {
  reviewId: string;
  grantId: string;
  decision: "keep" | "remove";
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "decision": "keep",
    "grantId": "gnt_a1b2c3",
    "reviewId": "rvw_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
