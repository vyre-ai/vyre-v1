# folders.delete

Delete a folder; its items go back to their owners

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/folders/delete |
| MCP tool | folders_delete (meta) |
| CLI | none |
| Emits | folder.deleted, item.moved |

## Input

```ts
type In = {
  folderId: string;
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
    "deleted": true
  }
}
```
