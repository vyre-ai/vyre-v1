# engine.queue.list

Messages waiting in a thread queue (steering, wakes, handoffs)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/queue/list |
| MCP tool | engine_queue_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  items: Array<{
      qseq: number;
      kind: "message" | "interrupt" | "wake" | "handoff";
      messageId?: string;
      from: string;
      priority: number;
      state: string;
    }>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "items": [
      {
        "from": "example",
        "kind": "message",
        "messageId": "msg_a1b2c3",
        "priority": 1,
        "qseq": 1,
        "state": "example"
      }
    ]
  }
}
```
