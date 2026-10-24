# ms.calendar.respond

Accept, decline or answer maybe to an invitation

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/calendar/respond |
| MCP tool | ms_calendar_respond (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  eventId: string;
  response: "accept" | "decline" | "tentativelyAccept";
  comment?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sent: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "comment": "example",
    "connectionId": "con_a1b2c3",
    "eventId": "example",
    "idempotencyKey": "idem_1",
    "response": "accept"
  },
  "output": {
    "sent": true
  }
}
```
