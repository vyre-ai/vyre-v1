# chat.approve_plan

Approve a plan, optionally with edits; clears plan mode for those steps and the agent executes

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/approve_plan |
| MCP tool | chat_approve_plan (chats) |
| CLI | none |
| Emits | plan.approved, block.answered, thread.plan_mode_changed |

## Input

```ts
type In = {
  threadId: string;
  planId: string;
  edits?: Array<{
      stepId: string;
      text?: string;
      remove?: boolean;
    }>;
};
```

## Output

```ts
type Out = {
  plan: {
    planId: string;
    state: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "edits": [
      {
        "remove": true,
        "stepId": "stp_a1b2c3",
        "text": "example"
      }
    ],
    "planId": "pln_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "plan": {
      "planId": "pln_a1b2c3",
      "state": "example",
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
