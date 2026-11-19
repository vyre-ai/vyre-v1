# engine.subagent.stop

Ask one subagent of a command-line engine to stop: its next call is refused and it ends (the node that stands for it in the run tree)

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
| HTTP | POST /v1/engine/subagent/stop |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  runId: string;
  reason?: string;
};
```

## Output

```ts
type Out = {
  requested: boolean;
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
    "reason": "example",
    "runId": "run_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "requested": true
  }
}
```
