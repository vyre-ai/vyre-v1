# members.joins.retry

Retry a new member's join steps that did not work, now

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | members.invite |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/joins/retry |
| MCP tool | members_joins_retry (meta) |
| CLI | none |
| Emits | member.join_stuck |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  applied: number;
  pending: number;
  steps: Array<{
      key: string;
      title: string;
      error: string;
      tries: number;
    }>;
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
    "personId": "usr_a1b2c3"
  },
  "output": {
    "applied": 1,
    "pending": 1,
    "steps": [
      {
        "error": "example",
        "key": "example",
        "title": "example",
        "tries": 1
      }
    ]
  }
}
```
