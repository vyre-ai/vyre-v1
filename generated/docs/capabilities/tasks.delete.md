# tasks.delete

Delete a task; Undo brings it back. A held act and a task a Run waits on are canceled instead

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | task (/taskId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/delete |
| MCP tool | tasks_delete (tasks) |
| CLI | none |
| Emits | task.deleted |

## Input

```ts
type In = {
  taskId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
