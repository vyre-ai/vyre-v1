# goals.ask

Ask the owner (or a named person) for a decision only they can make: one Waiting-on item, with the options. The same decision asked again returns the first ask; the answer wakes you

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
| HTTP | POST /v1/goals/ask |
| MCP tool | goals_ask (tasks) |
| CLI | none |
| Emits | goal.created, goal.started, goal.updated, goal.status_changed, goal.progress, goal.woken, goal.resumed, goal.reported, goal.step_done, goal.budget_warned, goal.ended, goal.extended |

## Input

```ts
type In = {
  goalId: string;
  decision: string;
  question: string;
  options?: Array<string>;
  to?: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
  asked: boolean;
  answer?: string;
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
    "decision": "lab7-reminder-audience",
    "goalId": "gol_a1b2c3",
    "options": [
      "example"
    ],
    "question": "example",
    "to": "usr_a1b2c3"
  },
  "output": {
    "answer": "example",
    "asked": true,
    "taskId": "tsk_a1b2c3"
  }
}
```
