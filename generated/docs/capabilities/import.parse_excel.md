# import.parse_excel

Stage the sheets of an Excel file and report their columns

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.create |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/import/parse_excel |
| MCP tool | import_parse_excel (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  sheets?: Array<string>;
};
```

## Output

```ts
type Out = {
  importId: string;
  source: "csv" | "excel" | "airtable" | "notion" | "google_sheets";
  tables: Array<{
      name: string;
      rowCount: number;
      columns: Array<{
          name: string;
          inferred: string;
          sample: Array<string>;
          distinct: number;
          empty: number;
        }>;
    }>;
  expiresAt: number;
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
    "sheets": [
      "example"
    ]
  },
  "output": {
    "expiresAt": 1760000000000,
    "importId": "imp_a1b2c3",
    "source": "csv",
    "tables": [
      {
        "columns": [
          {
            "distinct": 1,
            "empty": 1,
            "inferred": "email",
            "name": "example",
            "sample": [
              "example"
            ]
          }
        ],
        "name": "example",
        "rowCount": 1
      }
    ]
  }
}
```
