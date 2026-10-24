# events.replay

Replay a failed Run, a trace, a sync conflict or an event range against a copy of the Space; outward effects are recorded, not executed

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.logs |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/events/replay |
| MCP tool | events_replay (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  traceId?: string;
  runId?: string;
  conflictId?: string;
  fromSeq?: number;
  toSeq?: number;
  withClearance?: boolean;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "conflictId": "cfl_a1b2c3",
    "fromSeq": 1,
    "runId": "run_a1b2c3",
    "toSeq": 1,
    "traceId": "0123456789abcdef0123456789abcdef",
    "withClearance": true
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
