# goals.progress

Where a goal stands: the number from its source, read now when asked, and its history

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/progress |
| MCP tool | goals_progress_read (tasks) |
| CLI | none |
| Emits | goal.created, goal.started, goal.updated, goal.status_changed, goal.progress, goal.woken, goal.resumed, goal.reported, goal.step_done, goal.budget_warned, goal.ended, goal.extended |

## Input

```ts
type In = {
  goalId: string;
  refresh?: boolean;
};
```

## Output

```ts
type Out = {
  progress: {
    value?: number;
    target?: number;
    start?: number;
    percent?: number;
    readAt?: number;
    error?: string;
    itemsDone?: number;
    items?: number;
    tasksDone: number;
    tasks: number;
  };
  readings: Array<{
      at: number;
      value?: number;
      ok: boolean;
      error?: string;
    }>;
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
    "goalId": "gol_a1b2c3",
    "refresh": true
  },
  "output": {
    "progress": {
      "error": "example",
      "items": 1,
      "itemsDone": 1,
      "percent": 1,
      "readAt": 1760000000000,
      "start": 1,
      "target": 1,
      "tasks": 1,
      "tasksDone": 1,
      "value": 1
    },
    "readings": [
      {
        "at": 1760000000000,
        "error": "example",
        "ok": true,
        "value": 1
      }
    ]
  }
}
```
