# scheduler.catch_up

After downtime apply each schedule if-missed rule: run once if within the missed window, else skip with a note in the owner digest

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
| HTTP | POST /v1/scheduler/catch_up |
| MCP tool | none |
| CLI | none |
| Emits | schedule.missed, schedule.fired |

## Input

```ts
type In = {
  since: number;
};
```

## Output

```ts
type Out = {
  ranOnce: number;
  skipped: number;
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
    "since": 1760000000000
  },
  "output": {
    "ranOnce": 1,
    "skipped": 1
  }
}
```
