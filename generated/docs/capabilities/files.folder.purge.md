# files.folder.purge

Delete a folder in Trash for good, with every file and folder in it

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.delete |
| Grant level | edit |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/folder/purge |
| MCP tool | files_folder_purge (files) |
| CLI | none |
| Emits | folder.purged, file.purged |

## Input

```ts
type In = {
  folderId: string;
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
    "folderId": "fld_a1b2c3"
  },
  "output": {
    "purged": true
  }
}
```
