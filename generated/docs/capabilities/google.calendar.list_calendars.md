# google.calendar.list_calendars

List the calendars of the member

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
| HTTP | POST /v1/google/calendar/list_calendars |
| MCP tool | google_calendar_list_calendars (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
};
```

## Output

```ts
type Out = {
  calendars: Array<{
      id: string;
      summary: string;
      primary?: boolean;
      backgroundColor?: string;
      accessRole?: string;
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
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "calendars": [
      {
        "accessRole": "example",
        "backgroundColor": "example",
        "id": "example",
        "primary": true,
        "summary": "example"
      }
    ]
  }
}
```
