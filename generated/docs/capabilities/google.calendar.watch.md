# google.calendar.watch

Open an events.watch channel for a calendar

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/calendar/watch |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  calendarId: string;
  channelId: string;
  address: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  resourceId: string;
  expiration: number;
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
    "address": "example",
    "as": "maya@example.com",
    "calendarId": "example",
    "channelId": "example",
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "expiration": 1760000000000,
    "resourceId": "example"
  }
}
```
