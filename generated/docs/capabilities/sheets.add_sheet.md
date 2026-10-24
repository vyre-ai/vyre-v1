# sheets.add_sheet

Add a sheet (tab) to a workbook

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
| HTTP | POST /v1/sheets/add_sheet |
| MCP tool | sheets_add_sheet (files) |
| CLI | none |
| Emits | file.version_added |

## Input

```ts
type In = {
  fileId: string;
  sheet: string;
  columns: Array<string>;
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
    "columns": [
      "example"
    ],
    "fileId": "fil_a1b2c3",
    "sheet": "example"
  },
  "output": {
    "ok": true
  }
}
```
