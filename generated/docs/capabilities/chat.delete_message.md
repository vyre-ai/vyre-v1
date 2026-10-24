# chat.delete_message

Delete a message you wrote (kept in the audit trail)

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/chat/delete_message |
| MCP tool | chat_delete_message (chats) |
| CLI | none |
| Emits | message.deleted |

## Input

```ts
type In = {
  messageId: string;
  threadId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
