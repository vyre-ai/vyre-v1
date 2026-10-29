# projects.teammates.list

The teammates of a project: agents with a role there, with the lead first. The lead is the default participant in a new chat in the project.

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
| HTTP | POST /v1/projects/teammates/list |
| MCP tool | projects_teammates_list (records) |
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
  teammates: Array<{
      agentId: string;
      name: string;
      role: "lead" | "member" | "reviewer" | "guest";
      roleLine?: string;
      status: "awake" | "working" | "asleep" | "paused";
      madeForProject: boolean;
    }>;
  leadAgentId?: string;
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
    "leadAgentId": "agt_a1b2c3",
    "teammates": [
      {
        "agentId": "agt_a1b2c3",
        "madeForProject": true,
        "name": "example",
        "role": "lead",
        "roleLine": "example",
        "status": "awake"
      }
    ]
  }
}
```
