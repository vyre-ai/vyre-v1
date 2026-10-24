# calendar.update_calendar

Rename a calendar or change its colour

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/update_calendar |
| MCP tool | calendar_update_calendar (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  calendarId: string;
  title?: string;
  color?: string;
};
```

## Output

```ts
type Out = {
  calendar: {
    id: string;
    title: string;
    color: string;
    provider: "google" | "microsoft" | "local";
    connectionId?: string;
    ownerId: string;
    personal: boolean;
    state: "syncing" | "paused" | "error";
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "calendarId": "cld_a1b2c3",
    "color": "example",
    "title": "example"
  },
  "output": {
    "calendar": {
      "color": "#4f6bed",
      "connectionId": "con_a1b2c3",
      "id": "cld_a1b2c3",
      "ownerId": "usr_a1b2c3",
      "personal": true,
      "provider": "google",
      "state": "syncing",
      "title": "example"
    }
  }
}
```
