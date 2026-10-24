# devices.epoch_bump

System: advance a person epoch (device revoked, suspended, removed, password reset, clearance lowered)

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
| HTTP | POST /v1/devices/epoch_bump |
| MCP tool | none |
| CLI | none |
| Emits | epoch.bumped |

## Input

```ts
type In = {
  person: string;
  reason: "device_revoked" | "suspended" | "removed" | "password_reset" | "clearance_lowered" | "key_rotation";
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "person": "usr_a1b2c3",
    "reason": "device_revoked"
  },
  "output": {
    "epoch": 1
  }
}
```
