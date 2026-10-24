# devices.revoke

Revoke a device: its sessions end and its replica is purged on next contact

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/devices/revoke |
| MCP tool | devices_revoke (meta) |
| CLI | none |
| Emits | device.revoked, session.revoked, epoch.bumped |

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
