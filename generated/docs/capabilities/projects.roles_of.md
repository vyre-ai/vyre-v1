# projects.roles_of

The projects where one person holds a role, and which role, limited to the projects the asker can see

| | |
|---|---|
| Module | projects |
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
| HTTP | POST /v1/projects/roles_of |
| MCP tool | projects_roles_of (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  roles: Array<{
      projectId: string;
      title: string;
      role: "lead" | "member" | "reviewer" | "guest";
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
    "personId": "usr_a1b2c3"
  },
  "output": {
    "roles": [
      {
        "projectId": "prj_a1b2c3",
        "role": "lead",
        "title": "example"
      }
    ]
  }
}
```
