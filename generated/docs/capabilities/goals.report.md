# goals.report

Post the check-in in the goal chat: the real number against the pace, what changed and why, what was done, the next best step. One per wake-up; short and specific

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
| HTTP | POST /v1/goals/report |
| MCP tool | goals_checkin_post (tasks) |
| CLI | none |
| Emits | goal.created, goal.started, goal.updated, goal.status_changed, goal.progress, goal.woken, goal.resumed, goal.reported, goal.step_done, goal.budget_warned, goal.ended, goal.extended |

## Input

```ts
type In = {
  goalId: string;
  wakeId?: string;
  summary: string;
  done?: Array<string>;
  next?: Array<string>;
};
```

## Output

```ts
type Out = {
  posted: boolean;
  messageId?: string;
  value?: number;
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
    "done": [
      "example"
    ],
    "goalId": "gol_a1b2c3",
    "next": [
      "example"
    ],
    "summary": "example",
    "wakeId": "example"
  },
  "output": {
    "messageId": "msg_a1b2c3",
    "posted": true,
    "value": 1
  }
}
```
