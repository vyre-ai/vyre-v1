# projects.members.set

Give a person, agent or group a project role: Lead, Member, Reviewer or Guest (an agent with a role is a teammate there)

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/members/set |
| MCP tool | projects_members_set (records) |
| CLI | none |
| Emits | project.member_set |

## Input

```ts
type In = {
  projectId: string;
  principal: string;
  role: "lead" | "member" | "reviewer" | "guest";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  member: {
    principal: string;
    role: "lead" | "member" | "reviewer" | "guest";
    kind: "person" | "agent" | "group";
    since: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_contained
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "principal": "usr_a1b2c3",
    "projectId": "prj_a1b2c3",
    "role": "lead"
  },
  "output": {
    "member": {
      "kind": "person",
      "principal": "usr_a1b2c3",
      "role": "lead",
      "since": 1760000000000
    }
  }
}
```
