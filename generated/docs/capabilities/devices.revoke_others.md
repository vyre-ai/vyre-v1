# devices.revoke_others

Sign out everywhere except this device

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
| HTTP | POST /v1/devices/revoke_others |
| MCP tool | devices_revoke_others (meta) |
| CLI | none |
| Emits | device.revoked, session.revoked, epoch.bumped |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  revoked: number;
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
  "input": {},
  "output": {
    "revoked": 1
  }
}
```
