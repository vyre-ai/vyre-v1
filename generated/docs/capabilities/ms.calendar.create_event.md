# ms.calendar.create_event

Create an event; Exchange invites the attendees

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/calendar/create_event |
| MCP tool | ms_calendar_create_event (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  calendarId?: string;
  subject?: string;
  body?: string;
  location?: string;
  start?: Record<string, unknown>;
  end?: Record<string, unknown>;
  attendees?: Array<{
      email: string;
      optional?: boolean;
    }>;
  teamsMeeting?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  event: {
    id: string;
    subject?: string;
    start: Record<string, unknown>;
    end: Record<string, unknown>;
    location?: Record<string, unknown>;
    onlineMeeting?: Record<string, unknown>;
    attendees?: Array<{
        email: string;
        response?: string;
        type?: string;
      }>;
    organizer?: Record<string, unknown>;
    isCancelled?: boolean;
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
    "body": "example",
    "calendarId": "example",
    "connectionId": "con_a1b2c3",
    "end": {},
    "idempotencyKey": "idem_1",
    "location": "example",
    "start": {},
    "subject": "example",
    "teamsMeeting": true
  },
  "output": {
    "event": {
      "attendees": [
        {
          "email": "maya@example.com",
          "response": "example",
          "type": "example"
        }
      ],
      "end": {},
      "id": "example",
      "isCancelled": true,
      "location": {},
      "onlineMeeting": {},
      "organizer": {},
      "start": {},
      "subject": "example"
    }
  }
}
```
