# engine.live_turns

The turns being written in a thread right now, with the text so far: what a chat opened or reconnected mid-turn shows before it follows the live stream

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
| HTTP | POST /v1/engine/live_turns |
| MCP tool | engine_live_turns (chats) |
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
  turns: Array<{
      turnId: string;
      agentId: string;
      text: string;
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
    "turns": [
      {
        "agentId": "agt_a1b2c3",
        "text": "example",
        "turnId": "example"
      }
    ]
  }
}
```
