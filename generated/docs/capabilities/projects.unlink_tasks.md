# projects.unlink_tasks

Remove a dependency arrow

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
| HTTP | POST /v1/projects/unlink_tasks |
| MCP tool | projects_unlink_tasks (tasks) |
| CLI | none |
| Emits | project.tasks_unlinked, record.updated |

## Input

```ts
type In = {
  projectId: string;
  fromTaskId: string;
  toTaskId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "fromTaskId": "tsk_a1b2c3",
    "projectId": "prj_a1b2c3",
    "toTaskId": "tsk_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
