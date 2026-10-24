# projects.open_task_thread

Open the thread of a task in the project channel (made when someone first speaks about the task)

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/open_task_thread |
| MCP tool | projects_open_task_thread (tasks) |
| CLI | none |
| Emits | project.task_thread_opened |

## Input

```ts
type In = {
  projectId: string;
  taskId: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
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
    "projectId": "prj_a1b2c3",
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "threadId": "thr_a1b2c3"
  }
}
```
