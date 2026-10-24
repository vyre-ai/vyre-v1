# github.issue.assign_agent

Assign an issue to an agent: creates a task whose result lands as a linked changeset

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/github/issue/assign_agent |
| MCP tool | github_issue_assign_agent (records) |
| CLI | none |
| Emits | github.issue_assigned |

## Input

```ts
type In = {
  recordId: string;
  agentId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "taskId": "tsk_a1b2c3"
  }
}
```
