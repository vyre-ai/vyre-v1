# goals.complete

When a goal ends (done or missed), write its retrospective: what worked, what did not, and a playbook worth repeating. It is saved to the goal, its project and Space memory. On an owner-says-done goal whose work is finished, it asks the owner to confirm instead

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
| HTTP | POST /v1/goals/complete |
| MCP tool | goals_complete (tasks) |
| CLI | none |
| Emits | goal.created, goal.started, goal.updated, goal.status_changed, goal.progress, goal.woken, goal.resumed, goal.reported, goal.step_done, goal.budget_warned, goal.ended, goal.extended |

## Input

```ts
type In = {
  goalId: string;
  retro: {
    summary: string;
    worked: Array<string>;
    didNot: Array<string>;
    playbook?: string;
  };
};
```

## Output

```ts
type Out = {
  saved: boolean;
  askedOwner: boolean;
  taskId?: string;
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
    "goalId": "gol_a1b2c3",
    "retro": {
      "didNot": [
        "example"
      ],
      "playbook": "example",
      "summary": "example",
      "worked": [
        "example"
      ]
    }
  },
  "output": {
    "askedOwner": true,
    "saved": true,
    "taskId": "tsk_a1b2c3"
  }
}
```
