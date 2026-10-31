# mounts.restore

Put an earlier revision of a file back as the newest; it goes out like any edit

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mounts/restore |
| MCP tool | mounts_restore (files) |
| CLI | none |
| Emits | file.version_added, mount.synced, mount.failed, mount.file_sent, mount.conflict |

## Input

```ts
type In = {
  fileId: string;
  revisionId: string;
};
```

## Output

```ts
type Out = {
  restored: boolean;
  changesetId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "revisionId": "example"
  },
  "output": {
    "changesetId": "chg_a1b2c3",
    "restored": true
  }
}
```
