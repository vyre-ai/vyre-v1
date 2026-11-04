# members.join_link.get

The reusable Request to join link: on or off, the role people join as, the address when on (shown again any time), and how many requests wait

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
| HTTP | POST /v1/members/join_link/get |
| MCP tool | members_join_link_get (meta) |
| CLI | none |
| Emits | none |

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
