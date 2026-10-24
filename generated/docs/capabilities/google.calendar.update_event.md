# google.calendar.update_event

Change an event; Google updates the attendees

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
| HTTP | POST /v1/google/calendar/update_event |
| MCP tool | google_calendar_update_event (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  calendarId: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Record<string, unknown>;
  end?: Record<string, unknown>;
  attendees?: Array<{
      email: string;
      optional?: boolean;
    }>;
  conference?: boolean;
  sendUpdates?: "all" | "externalOnly" | "none";
  eventId: string;
  idempotencyKey: string;
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
    "attendees": [
      {
        "email": "maya@example.com",
        "optional": true
      }
    ],
    "calendarId": "primary",
    "conference": true,
    "connectionId": "con_a1b2c3",
    "description": "example",
    "end": {},
    "eventId": "example",
    "idempotencyKey": "idem_1",
    "location": "example",
    "sendUpdates": "all",
    "start": {},
    "summary": "example"
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
