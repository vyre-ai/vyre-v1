# projects.teammates.create

Make a teammate for this project: an agent with no computer and a project role (Lead, Member or Reviewer), by one yes; it shows on the Teammates tab, not on the Agents page

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
| HTTP | POST /v1/projects/teammates/create |
| MCP tool | projects_teammates_create (records) |
| CLI | none |
| Emits | project.member_set, agent.created |

## Input

```ts
type In = {
  projectId: string;
  name: string;
  role: "lead" | "member" | "reviewer";
  brief?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  teammate: {
    agentId: string;
    name: string;
    role: "lead" | "member" | "reviewer" | "guest";
    roleLine?: string;
    status: "awake" | "working" | "asleep" | "paused";
    madeForProject: boolean;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_contained
- validation.bad_input
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "brief": "example",
    "idempotencyKey": "idem_1",
    "name": "Security reviewer",
    "projectId": "prj_a1b2c3",
    "role": "lead"
  },
  "output": {
    "teammate": {
      "agentId": "agt_a1b2c3",
      "madeForProject": true,
      "name": "example",
      "role": "lead",
      "roleLine": "example",
      "status": "awake"
    }
  }
}
```
