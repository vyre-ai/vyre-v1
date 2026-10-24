# access.roles.create

Create a custom role, usually by cloning a built-in one

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
| Team Space only | no |
| HTTP | POST /v1/access/roles/create |
| MCP tool | access_roles_create (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  name: string;
  cloneFrom?: string;
  clearance?: "public" | "internal" | "confidential" | "restricted";
  assignableToAgents?: boolean;
  idempotencyKey: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "assignableToAgents": true,
    "clearance": "public",
    "cloneFrom": "rol_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "example"
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
