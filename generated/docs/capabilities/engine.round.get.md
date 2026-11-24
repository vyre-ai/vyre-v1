# engine.round.get

Who is on each message now, for the row under a message that asked several agents: each agent asked with its state (working, waiting behind its own earlier turn, replied, stopped). Read from the queue

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
| HTTP | POST /v1/engine/round/get |
| MCP tool | engine_round_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageIds: Array<string>;
};
```

## Output

```ts
type Out = {
  rounds: Array<{
      messageId: string;
      agents: Array<{
          agentId: string;
          state: "working" | "waiting" | "replied" | "stopped";
        }>;
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
    "messageIds": [
      "msg_a1b2c3"
    ],
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "rounds": [
      {
        "agents": [
          {
            "agentId": "agt_a1b2c3",
            "state": "working"
          }
        ],
        "messageId": "msg_a1b2c3"
      }
    ]
  }
}
```
