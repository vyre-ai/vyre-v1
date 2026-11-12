# chat.share

Share a message to another chat (a channel or a person): a card there carries it, and a card here says where it went; both open the other chat. You must be able to write in the chat it goes to

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
| HTTP | POST /v1/chat/share |
| MCP tool | chat_share (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  toThreadId: string;
  to?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
  toThreadId: string;
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
    "idempotencyKey": "idem_1",
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3",
    "to": "example",
    "toThreadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3",
    "toThreadId": "thr_a1b2c3"
  }
}
```
