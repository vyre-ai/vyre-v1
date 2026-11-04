# members.join_link.rotate

Make a new Request to join address; the old one stops working at once and requests already waiting stay

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
| HTTP | POST /v1/members/join_link/rotate |
| MCP tool | members_join_link_rotate (meta) |
| CLI | none |
| Emits | member.join_link_changed |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  link: {
    on: boolean;
    role: string;
    waiting: number;
    total: number;
    address?: string;
    createdAt?: number;
    rotatedAt?: number;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "link": {
      "address": "https://team.example.com/join/request/K7P2-9QXA",
      "createdAt": 1760000000000,
      "on": true,
      "role": "rol_a1b2c3",
      "rotatedAt": 1760000000000,
      "total": 1,
      "waiting": 1
    }
  }
}
```
