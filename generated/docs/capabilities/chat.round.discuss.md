# chat.round.discuss

Let the agents that answered a message talk it over: the thread under the message gets the answers and a request for one short turn each, ending on one line that starts "Decided:". The engine's hand-off limits cap it at four turns. Only the person who asked

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
| HTTP | POST /v1/chat/round/discuss |
| MCP tool | none |
| CLI | none |
| Emits | agent.engaged, message.received, message.direct, message.mentioned, thread.replied, thread.unarchived, thread.updated |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
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
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "threadId": "thr_a1b2c3"
  }
}
```
