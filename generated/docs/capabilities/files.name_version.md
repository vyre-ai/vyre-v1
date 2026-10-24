# files.name_version

Name a version or give its reason

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/name_version |
| MCP tool | files_name_version (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId: string;
  name?: string;
  reason?: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "name": "example",
    "reason": "example",
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
