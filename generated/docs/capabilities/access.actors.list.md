# access.actors.list

List outside actors (registered external tools such as Claude Code or Codex)

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
| HTTP | POST /v1/access/actors/list |
| MCP tool | access_actors_list (engineer) |
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
  actors: Array<{
      id: string;
      name: string;
      owner: string;
      provider: string;
      roles: Array<string>;
      status: "pending" | "active" | "revoked";
      engineerMcp: boolean;
      lastSeenAt?: number;
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
    "actors": [
      {
        "engineerMcp": true,
        "id": "act_a1b2c3",
        "lastSeenAt": 1760000000000,
        "name": "example",
        "owner": "usr_a1b2c3",
        "provider": "anthropic",
        "roles": [
          "rol_a1b2c3"
        ],
        "status": "pending"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
