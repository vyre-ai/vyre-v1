# google.meet.subscribe

Subscribe to Workspace Events for recording and transcript ready notices

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
| HTTP | POST /v1/google/meet/subscribe |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  target: string;
  eventTypes: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  subscription: string;
  expiration?: number;
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
    "connectionId": "con_a1b2c3",
    "eventTypes": [
      "example"
    ],
    "idempotencyKey": "idem_1",
    "target": "example"
  },
  "output": {
    "expiration": 1760000000000,
    "subscription": "example"
  }
}
```
