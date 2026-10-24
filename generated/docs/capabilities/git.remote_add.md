# git.remote_add

Add a remote by HTTPS address (credentials never go in the address)

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
| HTTP | POST /v1/git/remote_add |
| MCP tool | git_remote_add (files) |
| CLI | vyre git remote add |
| Emits | git.remote_added |

## Input

```ts
type In = {
  folderId: string;
  name: string;
  url: string;
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
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "folderId": "fld_a1b2c3",
    "name": "origin",
    "url": "https://github.com/vyre-ai/website.git"
  },
  "output": {
    "ok": true
  }
}
```
