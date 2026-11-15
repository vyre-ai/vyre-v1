# mounts.resolve

Settle a file that changed at the provider while it was edited in Vyre: keep both (the Vyre edit is saved beside it as a copy there) or use theirs

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
| HTTP | POST /v1/mounts/resolve |
| MCP tool | mounts_resolve (files) |
| CLI | none |
| Emits | file.version_added, mount.synced, mount.failed, mount.file_sent |

## Input

```ts
type In = {
  fileId: string;
  choice: "keep_both" | "use_theirs";
};
```

## Output

```ts
type Out = {
  resolved: boolean;
  copyName?: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "choice": "keep_both",
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "copyName": "example",
    "resolved": true
  }
}
```
