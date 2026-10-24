# engine.turn.enqueue

Queue a turn for a responder (message, interrupt, wake or handoff)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/enqueue |
| MCP tool | none |
| CLI | none |
| Emits | turn.queued |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  kind: "message" | "interrupt" | "wake" | "handoff";
  messageId?: string;
  priority?: number;
  from: string;
};
```

## Output

```ts
type Out = {
  qseq: number;
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
    "from": "example",
    "kind": "message",
    "messageId": "msg_a1b2c3",
    "priority": 1,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "qseq": 1
  }
}
```
