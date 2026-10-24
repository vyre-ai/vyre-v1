# scheduler.waits.cancel

Cancel a wait

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
| HTTP | POST /v1/scheduler/waits/cancel |
| MCP tool | none |
| CLI | none |
| Emits | wait.canceled |

## Input

```ts
type In = {
  waitId: string;
  reason: "subject_deleted" | "left_stage" | "stopped" | "manual";
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
    "reason": "subject_deleted",
    "waitId": "wat_a1b2c3"
  },
  "output": {
    "canceled": true
  }
}
```
