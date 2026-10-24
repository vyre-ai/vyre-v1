# projects.members.remove

Remove a project role and revoke its grants by source

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/members/remove |
| MCP tool | projects_members_remove (records) |
| CLI | none |
| Emits | project.member_removed |

## Input

```ts
type In = {
  projectId: string;
  principal: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "principal": "usr_a1b2c3",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
