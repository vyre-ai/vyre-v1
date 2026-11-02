# tasks.by_key

Find a task by its short key, such as VY-123

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/by_key |
| MCP tool | tasks_by_key (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
};
```

## Output

```ts
type Out = {
  taskId: string | null;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "key": "VY-123"
  },
  "output": {
    "taskId": "tsk_a1b2c3"
  }
}
```
