# calendar.create_calendar

Create a local calendar (for example a private Personal one)

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/create_calendar |
| MCP tool | calendar_create_calendar (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  title: string;
  color?: string;
  personal?: boolean;
  idempotencyKey: string;
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
    "color": "example",
    "idempotencyKey": "idem_1",
    "personal": true,
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
