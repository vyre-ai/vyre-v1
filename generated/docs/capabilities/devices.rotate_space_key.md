# devices.rotate_space_key

Rotate the Space data key epoch (wrapped anew for each remaining member; old data re-encrypted in the background)

| | |
|---|---|
| Module | devices |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/devices/rotate_space_key |
| MCP tool | devices_rotate_space_key (engineer) |
| CLI | none |
| Emits | epoch.bumped |

## Input

```ts
type In = {
  reason?: string;
  idempotencyKey: string;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "reason": "example"
  },
  "output": {
    "epoch": 1
  }
}
```
