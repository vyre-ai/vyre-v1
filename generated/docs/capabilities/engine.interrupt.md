# engine.interrupt

Interrupt now: cancel the current turn and queue the message at top priority ("stop and send")

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/interrupt |
| MCP tool | engine_interrupt (chats) |
| CLI | none |
| Emits | turn.cancelled, turn.queued |

## Input

```ts
type In = {
  threadId: string;
  messageId?: string;
};
```

## Output

```ts
type Out = {
  queued: boolean;
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
    "queued": true
  }
}
```
