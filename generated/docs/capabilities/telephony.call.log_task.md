# telephony.call.log_task

Log a task from a call

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/call/log_task |
| MCP tool | telephony_call_log_task (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  callId: string;
  title: string;
  assigneeId?: string;
  dueAt?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
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
    "assigneeId": "usr_a1b2c3",
    "callId": "cal_a1b2c3",
    "dueAt": 1760000000000,
    "idempotencyKey": "idem_1",
    "title": "example"
  },
  "output": {
    "taskId": "tsk_a1b2c3"
  }
}
```
