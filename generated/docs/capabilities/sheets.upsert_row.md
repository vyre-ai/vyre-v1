# sheets.upsert_row

Update the row that matches the given columns, or append a new one

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
| HTTP | POST /v1/sheets/upsert_row |
| MCP tool | sheets_upsert_row (files) |
| CLI | none |
| Emits | sheet.row_appended, sheet.row_updated, file.version_added |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  match: Array<string>;
  values: Record<string, unknown>;
  label?: string;
};
```

## Output

```ts
type Out = {
  rowId: string;
  created: boolean;
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

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "label": "example",
    "match": [
      "example"
    ],
    "sheet": "example",
    "values": {}
  },
  "output": {
    "created": true,
    "rowId": "r_12",
    "versionId": "ver_a1b2c3"
  }
}
```
