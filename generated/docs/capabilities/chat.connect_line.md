# chat.connect_line

The engine only: after a connect card is answered, leave one quiet line (not a message of the person) in the chat that wakes the agent that asked

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
  threadId: string;
  agentId: string;
  asker: string;
  body: string;
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
    "agentId": "agt_a1b2c3",
    "asker": "usr_a1b2c3",
    "body": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
