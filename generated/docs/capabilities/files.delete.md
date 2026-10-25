# files.delete

Move a file to Trash

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
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/delete |
| MCP tool | files_delete (files) |
| CLI | none |
| Emits | file.deleted, changeset.opened, changeset.updated |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
  changesetId?: string;
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
    "changesetId": "chg_a1b2c3",
    "deleted": true
  }
}
```
