# chat.answer_block

Answer a question or plan block; the answer is queued as a wake so the parked turn continues

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
| HTTP | POST /v1/chat/answer_block |
| MCP tool | chat_answer_block (chats) |
| CLI | none |
| Emits | block.answered |

## Input

```ts
type In = {
  threadId: string;
  blockId: string;
  answer: unknown;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "answer": {},
    "blockId": "blk_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
