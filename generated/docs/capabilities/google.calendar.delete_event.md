# google.calendar.delete_event

Delete an event; Google tells the attendees

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/calendar/delete_event |
| MCP tool | google_calendar_delete_event (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  calendarId: string;
  eventId: string;
  sendUpdates?: "all" | "externalOnly" | "none";
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "calendarId": "example",
    "connectionId": "con_a1b2c3",
    "eventId": "example",
    "idempotencyKey": "idem_1",
    "sendUpdates": "all"
  },
  "output": {
    "deleted": true
  }
}
```
