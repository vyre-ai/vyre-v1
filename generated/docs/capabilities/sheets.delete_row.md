# sheets.delete_row

Remove a row from a sheet

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
| HTTP | POST /v1/sheets/delete_row |
| MCP tool | sheets_delete_row (files) |
| CLI | none |
| Emits | sheet.row_deleted, file.version_added |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  rowId: string;
  label?: string;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "label": "example",
    "rowId": "r_12",
    "sheet": "example"
  },
  "output": {
    "deleted": true
  }
}
```
