# google.calendar.get_event

Read one event

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/calendar/get_event |
| MCP tool | google_calendar_get_event (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  calendarId: string;
  eventId: string;
};
```

## Output

```ts
type Out = {
  event: {
    id: string;
    status?: string;
    summary?: string;
    start: Record<string, unknown>;
    end: Record<string, unknown>;
    location?: string;
    hangoutLink?: string;
    attendees?: Array<{
        email: string;
        responseStatus?: string;
        optional?: boolean;
      }>;
    organizer?: Record<string, unknown>;
    updated?: string;
  };
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
    "as": "maya@example.com",
    "calendarId": "example",
    "connectionId": "con_a1b2c3",
    "eventId": "example"
  },
  "output": {
    "event": {
      "attendees": [
        {
          "email": "maya@example.com",
          "optional": true,
          "responseStatus": "example"
        }
      ],
      "end": {},
      "hangoutLink": "example",
      "id": "example",
      "location": "example",
      "organizer": {},
      "start": {},
      "status": "example",
      "summary": "example",
      "updated": "example"
    }
  }
}
```
