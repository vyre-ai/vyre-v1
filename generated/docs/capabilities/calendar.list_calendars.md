# calendar.list_calendars

List calendars: Work Google, Microsoft and the private Personal one, with colours

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/calendar/list_calendars |
| MCP tool | calendar_list_calendars (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "mine" | "shared" | "all";
};
```

## Output

```ts
type Out = {
  calendars: Array<{
      id: string;
      title: string;
      color: string;
      provider: "google" | "microsoft" | "local";
      connectionId?: string;
      ownerId: string;
      personal: boolean;
      state: "syncing" | "paused" | "error";
    }>;
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
    "scope": "mine"
  },
  "output": {
    "calendars": [
      {
        "color": "#4f6bed",
        "connectionId": "con_a1b2c3",
        "id": "cld_a1b2c3",
        "ownerId": "usr_a1b2c3",
        "personal": true,
        "provider": "google",
        "state": "syncing",
        "title": "example"
      }
    ]
  }
}
```
