# calendar.delete_calendar

Delete a local calendar (provider calendars are disconnected, not deleted)

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | calendar (/calendarId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/delete_calendar |
| MCP tool | calendar_delete_calendar (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  calendarId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
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
    "deleted": true
  }
}
```
