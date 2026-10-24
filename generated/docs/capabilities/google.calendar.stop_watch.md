# google.calendar.stop_watch

Close an events.watch channel

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
| HTTP | POST /v1/google/calendar/stop_watch |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  channelId: string;
  resourceId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  stopped: boolean;
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
    "channelId": "example",
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1",
    "resourceId": "example"
  },
  "output": {
    "stopped": true
  }
}
```
