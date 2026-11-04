# chat.helper.steer

Ask a helper that is working something, in its own chat: the person it works for only, while it runs

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/helper/steer |
| MCP tool | chat_helper_steer (chats) |
| CLI | none |
| Emits | message.received, helper.note, message.direct, message.mentioned, thread.replied, thread.unarchived |

## Input

```ts
type In = {
  threadId: string;
  body: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
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
    "body": "example",
    "idempotencyKey": "idem_1",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
