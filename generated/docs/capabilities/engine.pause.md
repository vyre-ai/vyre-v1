# engine.pause

Pause one agent's turn in a thread at its next safe point, keeping everything it did (a limit was reached)

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
| HTTP | POST /v1/engine/pause |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  agentId?: string;
  reason?: string;
};
```

## Output

```ts
type Out = {
  paused: number;
  held: number;
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
    "reason": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "held": 1,
    "paused": 1
  }
}
```
