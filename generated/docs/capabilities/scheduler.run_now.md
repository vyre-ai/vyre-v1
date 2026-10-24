# scheduler.run_now

Fire a schedule once now without changing its cron

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
| HTTP | POST /v1/scheduler/run_now |
| MCP tool | scheduler_run_now (automations) |
| CLI | none |
| Emits | schedule.fired |

## Input

```ts
type In = {
  scheduleId: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "scheduleId": "sch_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
