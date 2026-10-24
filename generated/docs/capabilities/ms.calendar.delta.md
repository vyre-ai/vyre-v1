# ms.calendar.delta

Changes in a calendar view since a delta link

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
| HTTP | POST /v1/ms/calendar/delta |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  calendarId?: string;
  start: string;
  end: string;
  deltaLink?: string;
};
```

## Output

```ts
type Out = {
  changed: Array<{
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
    }>;
  removed: Array<string>;
  deltaLink: string;
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
    "deltaLink": "example",
    "end": "example",
    "start": "example"
  },
  "output": {
    "changed": [
      {
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
    ],
    "deltaLink": "example",
    "removed": [
      "example"
    ]
  }
}
```
