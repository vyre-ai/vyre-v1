# access.roles.list

List roles with their permissions, clearance and holder counts

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/access/roles/list |
| MCP tool | access_roles_list (meta) |
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
  roles: Array<{
      id: string;
      name: string;
      builtIn: boolean;
      clearance: "public" | "internal" | "confidential" | "restricted";
      assignableToAgents: boolean;
      permissions: Array<string>;
      holders: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
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
    "next": "example",
    "roles": [
      {
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
    ],
    "total": 1
  }
}
```
