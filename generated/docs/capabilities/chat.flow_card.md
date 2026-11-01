# chat.flow_card

Leave the card of a drafted Flow in its chat: its name, what it does in plain words and Turn on and Test buttons. Written by the server from the draft itself; only a draft gets one

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
| HTTP | POST /v1/chat/flow_card |
| MCP tool | chat_flow_card (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  automationId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "idempotencyKey": "idem_1",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
