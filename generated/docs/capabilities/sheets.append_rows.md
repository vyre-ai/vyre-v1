# sheets.append_rows

Append rows to a sheet; each write is a version labelled with the automation and run, so parallel runs never overwrite

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sheets/append_rows |
| MCP tool | sheets_append_rows (files) |
| CLI | none |
| Emits | sheet.row_appended, file.version_added |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  rows: Array<Record<string, unknown>>;
  label?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  appended: number;
  rowIds: Array<string>;
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
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "label": "example",
    "rows": [
      {}
    ],
    "sheet": "example"
  },
  "output": {
    "appended": 1,
    "rowIds": [
      "r_12"
    ],
    "versionId": "ver_a1b2c3"
  }
}
```
