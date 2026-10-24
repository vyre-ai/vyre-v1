# files.purge

Delete a file from Trash for good

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.delete |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/purge |
| MCP tool | files_purge (files) |
| CLI | none |
| Emits | file.purged |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  purged: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "purged": true
  }
}
```
