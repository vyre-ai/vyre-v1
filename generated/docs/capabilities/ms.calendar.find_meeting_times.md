# ms.calendar.find_meeting_times

Suggested meeting times for a set of attendees

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
| HTTP | POST /v1/ms/calendar/find_meeting_times |
| MCP tool | ms_calendar_find_meeting_times (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  emails: Array<string>;
  durationMinutes: number;
  start: string;
  end: string;
};
```

## Output

```ts
type Out = {
  slots: Array<{
      start: string;
      end: string;
      confidence?: number;
    }>;
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
    "durationMinutes": 5,
    "emails": [
      "maya@example.com"
    ],
    "end": "example",
    "start": "example"
  },
  "output": {
    "slots": [
      {
        "confidence": 1,
        "end": "example",
        "start": "example"
      }
    ]
  }
}
```
