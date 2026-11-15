# chat.round.decide

Go with one agent's answer after a message asked several: one quiet line, "Decided: going with Nova's answer", in the chat. Only the person who asked, only for an agent that answered; no agent is woken by it

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
| HTTP | POST /v1/chat/round/decide |
| MCP tool | none |
| CLI | none |
| Emits | message.edited |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  agentId: string;
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
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
