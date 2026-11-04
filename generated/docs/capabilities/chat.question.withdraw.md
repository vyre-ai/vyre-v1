# chat.question.withdraw

Take back a question: its turn ended without waiting for it. The card closes as withdrawn and its task leaves the Needs you list. Only the agent that asked, or a person in the chat

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
| HTTP | POST /v1/chat/question/withdraw |
| MCP tool | none |
| CLI | none |
| Emits | block.withdrawn |

## Input

```ts
type In = {
  threadId: string;
  blockId: string;
};
```

## Output

```ts
type Out = {
  withdrawn: boolean;
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
    "blockId": "blk_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "withdrawn": true
  }
}
```
