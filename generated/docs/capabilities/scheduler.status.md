# scheduler.status

Cheap health probe of the scheduler: tick lag, due schedules, open waits

| | |
|---|---|
| Module | scheduler-api |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/scheduler/status |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
  detail?: string;
  latencyMs?: number;
  tickLagMs: number;
  dueNow: number;
  openWaits: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "detail": "example",
    "dueNow": 1,
    "latencyMs": 1,
    "openWaits": 1,
    "state": "healthy",
    "tickLagMs": 1
  }
}
```
