# mounts.pause

Pause syncing of a mount

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/pause |
| MCP tool | mounts_pause (files) |
| CLI | none |
| Emits | mount.paused |

## Input

```ts
type In = {
  mountId: string;
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "mountId": "mnt_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
