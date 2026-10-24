# scheduler.fire

Fire a due schedule: invoke its capability as its principal (called by the host tick)

| | |
|---|---|
| Module | scheduler-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/scheduler/fire |
| MCP tool | none |
| CLI | none |
| Emits | schedule.fired |

## Input

```ts
type In = {
  scheduleId: string;
  scheduledFor: number;
};
```

## Output

```ts
type Out = {
  runId?: string;
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
  "input": {
    "scheduleId": "sch_a1b2c3",
    "scheduledFor": 1760000000000
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
