# engine.placement.decide

Decide where a turn runs: host or the asker device (private chat rules, computers, routines, phone and web askers)

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
| HTTP | POST /v1/engine/placement/decide |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  kind: "message" | "interrupt" | "wake" | "handoff";
};
```

## Output

```ts
type Out = {
  placement: "host" | "device" | "wait";
  reason: string;
  wakeLine?: string;
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
    "kind": "message",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "placement": "host",
    "reason": "example",
    "wakeLine": "Your computer is off"
  }
}
```
