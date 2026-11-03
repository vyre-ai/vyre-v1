# members.joins.list

Joins that have not finished: each new member with the steps that did not work yet, in words, how often each was tried, and whether it is stuck (three tries or more)

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | members.invite |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/joins/list |
| MCP tool | members_joins_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  stuck?: boolean;
};
```

## Output

```ts
type Out = {
  joins: Array<{
      personId: string;
      name: string;
      joinedAt: number;
      stuck: boolean;
      steps: Array<{
          key: string;
          title: string;
          error: string;
          tries: number;
        }>;
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
    "stuck": true
  },
  "output": {
    "joins": [
      {
        "joinedAt": 1760000000000,
        "name": "example",
        "personId": "usr_a1b2c3",
        "steps": [
          {
            "error": "example",
            "key": "example",
            "title": "example",
            "tries": 1
          }
        ],
        "stuck": true
      }
    ]
  }
}
```
