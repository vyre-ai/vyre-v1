# sync.epoch.bump

Raise a person sync epoch (device revoked, person suspended or removed, password reset, clearance lowered, key rotation) so old replicas purge

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sync/epoch/bump |
| MCP tool | none |
| CLI | none |
| Emits | sync.epoch_bumped |

## Input

```ts
type In = {
  personId: string;
  reason: "device_revoked" | "suspended" | "removed" | "password_reset" | "clearance_lowered" | "key_rotation";
  deviceId?: string;
};
```

## Output

```ts
type Out = {
  epoch: number;
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
    "deviceId": "dev_a1b2c3",
    "personId": "usr_a1b2c3",
    "reason": "device_revoked"
  },
  "output": {
    "epoch": 1
  }
}
```
