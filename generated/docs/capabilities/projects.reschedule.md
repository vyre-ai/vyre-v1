# projects.reschedule

Move a task bar or resize it on the timeline; if it slips, the response carries a cascade proposal

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/reschedule |
| MCP tool | projects_reschedule (tasks) |
| CLI | none |
| Emits | project.task_rescheduled, project.cascade_proposed, record.updated |

## Input

```ts
type In = {
  projectId: string;
  taskId: string;
  start?: number;
  due?: number;
  stage?: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
  start?: number;
  due?: number;
  proposalId?: string;
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
    "due": 1760000000000,
    "projectId": "prj_a1b2c3",
    "stage": "draft",
    "start": 1760000000000,
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "due": 1760000000000,
    "proposalId": "csc_a1b2c3",
    "start": 1760000000000,
    "taskId": "tsk_a1b2c3"
  }
}
```
