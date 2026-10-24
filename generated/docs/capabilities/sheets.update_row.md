# sheets.update_row

Update one row by row id or by a key column value

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
| HTTP | POST /v1/sheets/update_row |
| MCP tool | sheets_update_row (files) |
| CLI | none |
| Emits | sheet.row_updated, file.version_added |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  rowId?: string;
  key?: {
    column: string;
    value: unknown;
  };
  values: Record<string, unknown>;
  label?: string;
};
```

## Output

```ts
type Out = {
  rowId: string;
  versionId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "key": {
      "column": "example",
      "value": {}
    },
    "label": "example",
    "rowId": "r_12",
    "sheet": "example",
    "values": {}
  },
  "output": {
    "rowId": "r_12",
    "versionId": "ver_a1b2c3"
  }
}
```
