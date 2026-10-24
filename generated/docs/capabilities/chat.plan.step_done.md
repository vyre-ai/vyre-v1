# chat.plan.step_done

Mark one plan step done so the plan block ticks it

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/plan/step_done |
| MCP tool | chat_plan_step_done (chats) |
| CLI | none |
| Emits | plan.step_done |

## Input

```ts
type In = {
  threadId: string;
  planId: string;
  stepId: string;
};
```

## Output

```ts
type Out = {
  plan: {
    planId: string;
    steps: Array<{
        stepId: string;
        text: string;
        state: "todo" | "doing" | "done" | "skipped";
        detail?: string;
      }>;
  };
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
    "planId": "pln_a1b2c3",
    "stepId": "stp_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "plan": {
      "planId": "pln_a1b2c3",
      "steps": [
        {
          "detail": "example",
          "state": "todo",
          "stepId": "stp_a1b2c3",
          "text": "example"
        }
      ]
    }
  }
}
```
