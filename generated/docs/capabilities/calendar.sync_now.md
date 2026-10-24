# calendar.sync_now

Sync a calendar now

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | calendar (/calendarId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/sync_now |
| MCP tool | calendar_sync_now (inbox) |
| CLI | none |
| Emits | calendar.synced |

## Input

```ts
type In = {
  calendarId: string;
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
    "calendarId": "cld_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
