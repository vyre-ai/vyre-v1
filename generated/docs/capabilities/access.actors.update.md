# access.actors.update

Change the roles or declared provider of an outside actor

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
| HTTP | POST /v1/access/actors/update |
| MCP tool | access_actors_update (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  actorId: string;
  roleIds?: Array<string>;
  provider?: string;
};
```

## Output

```ts
type Out = {
  actor: {
    id: string;
    name: string;
    owner: string;
    provider: string;
    roles: Array<string>;
    status: "pending" | "active" | "revoked";
    engineerMcp: boolean;
    lastSeenAt?: number;
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
    "actorId": "act_a1b2c3",
    "provider": "example",
    "roleIds": [
      "rol_a1b2c3"
    ]
  },
  "output": {
    "actor": {
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
  }
}
```
