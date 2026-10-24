# sheets.info

List the sheets of a table file with row counts, columns and the key column

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sheets/info |
| MCP tool | sheets_info (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  sheets: Array<{
      name: string;
      rows: number;
      columns: Array<string>;
      keyColumn?: string;
    }>;
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "sheets": [
      {
        "columns": [
          "example"
        ],
        "keyColumn": "example",
        "name": "example",
        "rows": 1
      }
    ]
  }
}
```
