# access.roles.preview

Stage a change to the permissions of a role as a diff: who gains and who loses what

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
| HTTP | POST /v1/access/roles/preview |
| MCP tool | access_roles_preview (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  roleId: string;
  permissions: Array<string>;
};
```

## Output

```ts
type Out = {
  gains: Array<{
      principal: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      permission: string;
    }>;
  losses: Array<{
      principal: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      permission: string;
    }>;
  previewHash: string;
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
    "permissions": [
      "example"
    ],
    "roleId": "rol_a1b2c3"
  },
  "output": {
    "gains": [
      {
        "permission": "example",
        "principal": {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      }
    ],
    "losses": [
      {
        "permission": "example",
        "principal": {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      }
    ],
    "previewHash": "example"
  }
}
```
