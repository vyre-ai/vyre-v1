# git.init

Turn a folder into a git repository (local history only until a remote is added)

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/git/init |
| MCP tool | git_init (files) |
| CLI | vyre git init |
| Emits | git.initialized |

## Input

```ts
type In = {
  folderId: string;
  branch?: string;
};
```

## Output

```ts
type Out = {
  branch: string;
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
    "branch": "main",
    "folderId": "fld_a1b2c3"
  },
  "output": {
    "branch": "main"
  }
}
```
