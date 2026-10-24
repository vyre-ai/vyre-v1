# access.reviews.start

Open an access review now (the quarterly job calls this too)

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/access/reviews/start |
| MCP tool | access_reviews_start (engineer) |
| CLI | none |
| Emits | access_review.opened |

## Input

```ts
type In = {
  scope?: Array<"space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar">;
  idempotencyKey: string;
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
    "idempotencyKey": "idem_1",
    "scope": [
      "space"
    ]
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
