# scheduler.cancel

Cancel a schedule

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
| HTTP | POST /v1/scheduler/cancel |
| MCP tool | scheduler_cancel (automations) |
| CLI | none |
| Emits | schedule.canceled |

## Input

```ts
type In = {
  scheduleId: string;
};
```

## Output

```ts
type Out = {
  canceled: boolean;
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
    "canceled": true
  }
}
```
