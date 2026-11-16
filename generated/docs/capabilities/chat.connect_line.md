# chat.connect_line

The engine only: after a connect card is answered, leave one quiet line (not a message of the person) in the chat that wakes the agent that asked. It takes the answered request's id and reads the chat, the agent, the asker and the words from that request; only the request's own asker may call it

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/connect_line |
| MCP tool | none |
| CLI | none |
| Emits | message.received, message.direct, message.mentioned, thread.replied, thread.unarchived, thread.updated |

## Input

```ts
type In = {
  requestId: string;
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
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
