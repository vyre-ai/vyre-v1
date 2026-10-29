# calendar.connect_provider

Put a member's Google or Microsoft calendar in Calendar, owned by them and read as their account; connected false (an excluded member) removes it

| | |
|---|---|
| Module | calendar |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/calendar/connect_provider |
| MCP tool | calendar_connect_provider (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  provider: "google" | "microsoft";
  ownerId: string;
  account: string;
  connectionId: string;
  remoteId?: string;
  title?: string;
  connected?: boolean;
};
```

## Output

```ts
type Out = {
  calendarId?: string;
  created: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "account": "maya@example.com",
    "connected": true,
    "connectionId": "con_a1b2c3",
    "ownerId": "usr_a1b2c3",
    "provider": "google",
    "remoteId": "example",
    "title": "example"
  },
  "output": {
    "calendarId": "cld_a1b2c3",
    "created": true
  }
}
```
