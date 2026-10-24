# ms.calendar.get_event

Read one event

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/calendar/get_event |
| MCP tool | ms_calendar_get_event (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  eventId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "eventId": "example"
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
