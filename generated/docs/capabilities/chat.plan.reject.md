# chat.plan.reject

Reject a plan with a note; the agent stays in plan mode

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
| HTTP | POST /v1/chat/plan/reject |
| MCP tool | chat_plan_reject (chats) |
| CLI | none |
| Emits | plan.rejected, block.answered |

## Input

```ts
type In = {
  threadId: string;
  planId: string;
  note?: string;
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
    "note": "example",
    "planId": "pln_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
