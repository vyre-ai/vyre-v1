# chat.rewind

Go back in a private chat with an agent to a point: the agent's work folder is put back as it was, the agents stop reading the messages after it, and one line says so. Every message stays; anything already sent stays sent. Off in a chat with other people. Only the person themselves

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/chat/rewind |
| MCP tool | chat_rewind (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  pointId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  restored: number;
  removed: number;
  at: number;
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
    "pointId": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "removed": 1,
    "restored": 1
  }
}
```
