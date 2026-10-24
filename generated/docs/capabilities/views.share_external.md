# views.share_external

Make a read-only link to a saved view for a client

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | records.share_external |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/views/share_external |
| MCP tool | views_share_external (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  viewId: string;
  expiresAt?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  url: string;
  expiresAt?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "expiresAt": 1760000000000,
    "idempotencyKey": "idem_1",
    "viewId": "viw_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "url": "example"
  }
}
```
