# tasks.history

Activity of a task: transitions, hand-overs, notes and sends back, newest first

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | task (/taskId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/history |
| MCP tool | tasks_history (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  taskId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      at: number;
      type: string;
      by: string;
      note?: string;
      eventId: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "entries": [
      {
        "at": 1760000000000,
        "by": "example",
        "eventId": "evt_a1b2c3",
        "note": "example",
        "type": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
