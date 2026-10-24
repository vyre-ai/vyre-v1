# git.remote_remove

Remove a remote

| | |
|---|---|
| Module | git |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | manage |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/git/remote_remove |
| MCP tool | git_remote_remove (files) |
| CLI | none |
| Emits | git.remote_removed |

## Input

```ts
type In = {
  folderId: string;
  name: string;
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
    "folderId": "fld_a1b2c3",
    "name": "origin"
  },
  "output": {
    "ok": true
  }
}
```
