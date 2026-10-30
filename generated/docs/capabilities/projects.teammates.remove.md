# projects.teammates.remove

Take a teammate off the project; one made for this project moves to Trash with it

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
| HTTP | POST /v1/projects/teammates/remove |
| MCP tool | projects_teammates_remove (records) |
| CLI | none |
| Emits | project.member_removed, agent.deleted |

## Input

```ts
type In = {
  projectId: string;
  agentId: string;
  idempotencyKey: string;
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
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
