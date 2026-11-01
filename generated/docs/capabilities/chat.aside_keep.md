# chat.aside_keep

Keep the answer of an aside: it is posted into the chat it came from as one card from you

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/asideThreadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/aside_keep |
| MCP tool | chat_aside_keep (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  asideThreadId: string;
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
    "asideThreadId": "thr_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
