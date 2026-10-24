# chat.unpin

Remove the pinned marker from a message

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/unpin |
| MCP tool | chat_unpin (chats) |
| CLI | none |
| Emits | message.pinned |

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
  pinned: boolean;
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
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "pinned": true
  }
}
```
