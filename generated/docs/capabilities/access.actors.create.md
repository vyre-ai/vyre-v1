# access.actors.create

Register an outside actor and issue a one-time token (works once, within 10 minutes)

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
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/actors/create |
| MCP tool | access_actors_create (engineer) |
| CLI | none |
| Emits | principal.created, access.changed |

## Input

```ts
type In = {
  name: string;
  provider: string;
  roleIds?: Array<string>;
  idempotencyKey: string;
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
  oneTimeToken: string;
  expiresAt: number;
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
    "name": "example",
    "provider": "anthropic",
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
    },
    "expiresAt": 1760000000000,
    "oneTimeToken": "example"
  }
}
```
