# projects.members.list

List people and agents on a project with their roles

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/members/list |
| MCP tool | projects_members_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  members: Array<{
      principal: string;
      role: "lead" | "member" | "reviewer" | "guest";
      kind: "person" | "agent" | "group";
      since: number;
    }>;
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
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "members": [
      {
        "kind": "person",
        "principal": "usr_a1b2c3",
        "role": "lead",
        "since": 1760000000000
      }
    ]
  }
}
```
