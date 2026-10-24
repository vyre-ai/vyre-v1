# engine.set_mode

Set an agent to Leading or Listening in a thread; exactly one lead per thread

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/set_mode |
| MCP tool | engine_set_mode (chats) |
| CLI | none |
| Emits | agent.mode_changed |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  mode: "lead" | "listen";
};
```

## Output

```ts
type Out = {
  mode: "lead" | "listen";
  leadAgentId: string | null;
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
    "mode": "lead",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "leadAgentId": "agt_a1b2c3",
    "mode": "lead"
  }
}
```
