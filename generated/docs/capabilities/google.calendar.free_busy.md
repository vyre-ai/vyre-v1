# google.calendar.free_busy

Busy blocks for people over a range

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
| HTTP | POST /v1/google/calendar/free_busy |
| MCP tool | google_calendar_free_busy (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  emails: Array<string>;
  timeMin: string;
  timeMax: string;
};
```

## Output

```ts
type Out = {
  busy: Array<{
      email: string;
      start: string;
      end: string;
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
    "emails": [
      "maya@example.com"
    ],
    "timeMax": "example",
    "timeMin": "example"
  },
  "output": {
    "busy": [
      {
        "email": "maya@example.com",
        "end": "example",
        "start": "example"
      }
    ]
  }
}
```
