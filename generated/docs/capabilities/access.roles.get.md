# access.roles.get

Read one role with holders and where it is granted

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
| HTTP | POST /v1/access/roles/get |
| MCP tool | access_roles_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  roleId: string;
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
  holders: Array<{
      kind: "person" | "agent" | "actor" | "service";
      id: string;
    }>;
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
    "roleId": "rol_a1b2c3"
  },
  "output": {
    "holders": [
      {
        "id": "usr_a1b2c3",
        "kind": "person"
      }
    ],
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
