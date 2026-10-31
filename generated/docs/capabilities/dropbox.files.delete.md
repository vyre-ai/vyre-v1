# dropbox.files.delete

Delete a Dropbox file or folder (Dropbox keeps it in its deleted files for a while)

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | delete |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/dropbox/files/delete |
| MCP tool | dropbox_files_delete (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  path: string;
  rev?: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "path": "example",
    "rev": "example"
  },
  "output": {
    "deleted": true
  }
}
```
