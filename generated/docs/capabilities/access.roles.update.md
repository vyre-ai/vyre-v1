# access.roles.update

Rename a custom role or change its clearance; built-in roles are locked

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
| HTTP | POST /v1/access/roles/update |
| MCP tool | access_roles_update (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  roleId: string;
  name?: string;
  clearance?: "public" | "internal" | "confidential" | "restricted";
  assignableToAgents?: boolean;
};
```

## Output

```ts
type Out = {
  role: {
    id: string;
    name: string;
    builtIn: boolean;
    clearance: "public" | "internal" | "confidential" | "restricted";
    assignableToAgents: boolean;
    permissions: Array<string>;
    holders: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.field_locked

## Example

```json
{
  "name": "example",
  "input": {
    "assignableToAgents": true,
    "clearance": "public",
    "name": "example",
    "roleId": "rol_a1b2c3"
  },
  "output": {
    "role": {
      "assignableToAgents": true,
      "builtIn": true,
      "clearance": "public",
      "holders": 1,
      "id": "rol_a1b2c3",
      "name": "example",
      "permissions": [
        "example"
      ]
    }
  }
}
```
