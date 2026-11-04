# goals.activity

The activity of a goal, newest first: every reading, wake-up, step, task and status change, and why

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/activity |
| MCP tool | goals_activity (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
  before?: number;
  limit?: number;
};
```

## Output

```ts
type Out = {
  activity: Array<{
      at: number;
      kind: string;
      text: string;
      by?: string;
      ref?: string;
      tpl?: string;
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
    "before": 1760000000000,
    "goalId": "gol_a1b2c3",
    "limit": 1
  },
  "output": {
    "activity": [
      {
        "at": 1760000000000,
        "by": "example",
        "kind": "reading",
        "ref": "example",
        "text": "example",
        "tpl": "example"
      }
    ]
  }
}
```
