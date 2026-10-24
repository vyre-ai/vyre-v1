# google.drive.watch_changes

Open a Drive changes.watch channel

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
| HTTP | POST /v1/google/drive/watch_changes |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  pageToken: string;
  channelId: string;
  address: string;
  driveId?: string;
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
    "channelId": "example",
    "connectionId": "con_a1b2c3",
    "driveId": "example",
    "idempotencyKey": "idem_1",
    "pageToken": "example"
  },
  "output": {
    "expiration": 1760000000000,
    "resourceId": "example"
  }
}
```
