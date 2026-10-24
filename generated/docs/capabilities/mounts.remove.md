# mounts.remove

Remove a mount; keep the files as a plain folder or delete the copy

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mounts/remove |
| MCP tool | mounts_remove (files) |
| CLI | vyre mounts remove |
| Emits | mount.removed |

## Input

```ts
type In = {
  mountId: string;
  keepCopy?: boolean;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "keepCopy": true,
    "mountId": "mnt_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
