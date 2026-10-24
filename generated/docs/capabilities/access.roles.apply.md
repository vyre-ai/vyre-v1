# access.roles.apply

Apply a staged role permission change (the diff from preview)

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
| HTTP | POST /v1/access/roles/apply |
| MCP tool | access_roles_apply (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  roleId: string;
  permissions: Array<string>;
  previewHash: string;
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
- validation.field_locked
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "permissions": [
      "example"
    ],
    "previewHash": "example",
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
