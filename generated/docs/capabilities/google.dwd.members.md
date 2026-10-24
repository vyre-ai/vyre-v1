# google.dwd.members

Workspace users mapped to Space members by email, with exclusion and mailbox state

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/dwd/members |
| MCP tool | google_dwd_members (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  members: Array<{
      email: string;
      userId?: string;
      mapped: boolean;
      excluded: boolean;
      mailboxState?: string;
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
    "limit": 1
  },
  "output": {
    "members": [
      {
        "email": "maya@example.com",
        "excluded": true,
        "mailboxState": "example",
        "mapped": true,
        "userId": "usr_a1b2c3"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
