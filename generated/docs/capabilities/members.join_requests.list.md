# members.join_requests.list

People who asked to join through the Request to join link, newest first

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
| HTTP | POST /v1/members/join_requests/list |
| MCP tool | members_join_requests_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: "waiting" | "approved" | "declined";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  requests: Array<{
      id: string;
      name: string;
      email: string;
      note?: string;
      role: string;
      state: "waiting" | "approved" | "declined";
      at: number;
      inviteId?: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "state": "waiting"
  },
  "output": {
    "next": "example",
    "requests": [
      {
        "at": 1760000000000,
        "email": "maya@example.com",
        "id": "jrq_a1b2c3",
        "inviteId": "inv_a1b2c3",
        "name": "example",
        "note": "example",
        "role": "rol_a1b2c3",
        "state": "waiting"
      }
    ],
    "total": 1
  }
}
```
