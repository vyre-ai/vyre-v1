# ms.calendar.get_schedule

Free and busy blocks for people over a range

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
| HTTP | POST /v1/ms/calendar/get_schedule |
| MCP tool | ms_calendar_get_schedule (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  emails: Array<string>;
  start: string;
  end: string;
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
    "end": "example",
    "start": "example"
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
