# chat.plan.propose

Propose a plan with steps as a plan block; used when plan mode is on

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/plan/propose |
| MCP tool | plan_propose (chats) |
| CLI | none |
| Emits | plan.proposed, message.received, block.waiting |

## Input

```ts
type In = {
  threadId: string;
  title: string;
  steps: Array<{
      text: string;
      detail?: string;
    }>;
  docFileId?: string;
};
```

## Output

```ts
type Out = {
  planId: string;
  blockId: string;
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
    "docFileId": "fil_a1b2c3",
    "steps": [
      {
        "detail": "example",
        "text": "example"
      }
    ],
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "blockId": "blk_a1b2c3",
    "planId": "pln_a1b2c3"
  }
}
```
