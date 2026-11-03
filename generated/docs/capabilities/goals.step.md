# goals.step

Before a step with an effect (a send, a post, a record change), claim it by id; a step already done answers done with its result, so a retried wake-up never repeats it. Finish it with finish true

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
| HTTP | POST /v1/goals/step |
| MCP tool | goals_step (tasks) |
| CLI | none |
| Emits | goal.created, goal.started, goal.updated, goal.status_changed, goal.progress, goal.woken, goal.resumed, goal.reported, goal.step_done, goal.budget_warned, goal.ended, goal.extended |

## Input

```ts
type In = {
  goalId: string;
  stepId: string;
  title?: string;
  finish?: boolean;
  result?: string;
};
```

## Output

```ts
type Out = {
  state: "started" | "already_done" | "done";
  result?: string;
  idempotencyKey: string;
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
    "finish": true,
    "goalId": "gol_a1b2c3",
    "result": "example",
    "stepId": "reminder-email-lab7",
    "title": "example"
  },
  "output": {
    "idempotencyKey": "example",
    "result": "example",
    "state": "started"
  }
}
```
