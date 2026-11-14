# scheduler.claim

System: the engine claims a due fire of a wake. The one claim rule: only the writer whose conditional write changes the row goes on; a claim older than its lease is taken again

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
| HTTP | POST /v1/scheduler/claim |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scheduleId: string;
  dueKey: string;
  host: string;
};
```

## Output

```ts
type Out = {
  claimed: boolean;
  fireId?: string;
  attempt?: number;
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
    "dueKey": "1793696460000",
    "host": "host_a",
    "scheduleId": "sch_a1b2c3"
  },
  "output": {
    "attempt": 1,
    "claimed": true,
    "fireId": "example"
  }
}
```
