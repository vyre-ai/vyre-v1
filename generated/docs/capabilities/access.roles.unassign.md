# access.roles.unassign

Take a role away from a person, group or agent

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
| Team Space only | no |
| HTTP | POST /v1/access/roles/unassign |
| MCP tool | access_roles_unassign (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  subject: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  roleId: string;
};
```

## Output

```ts
type Out = {
  roles: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "roleId": "rol_a1b2c3",
    "subject": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "roles": [
      "rol_a1b2c3"
    ]
  }
}
```
