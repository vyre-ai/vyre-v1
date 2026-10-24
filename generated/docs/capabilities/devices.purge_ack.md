# devices.purge_ack

System: a device reports that its replica, keychain entries and caches are gone

| | |
|---|---|
| Module | devices |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/devices/purge_ack |
| MCP tool | none |
| CLI | none |
| Emits | device.purged |

## Input

```ts
type In = {
  deviceId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "deviceId": "dev_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
