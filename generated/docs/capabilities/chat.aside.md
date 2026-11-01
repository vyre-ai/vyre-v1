# chat.aside

Ask a side question (/btw) while an agent works: it runs as a separate short read-only turn on your own account with what this chat knows, in a hidden thread; nothing is written into this chat and the agent working here does not see it

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/aside |
| MCP tool | chat_aside (chats) |
| CLI | none |
| Emits | thread.started, message.received, message.direct, message.mentioned, thread.replied, thread.unarchived |

## Input

```ts
type In = {
  threadId: string;
  question: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  asideThreadId: string;
  messageId: string;
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
    "idempotencyKey": "idem_1",
    "question": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "asideThreadId": "thr_a1b2c3",
    "messageId": "msg_a1b2c3"
  }
}
```
