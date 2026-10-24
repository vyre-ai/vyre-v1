# import.parse_csv

Stage a CSV or pasted CSV text and report its columns with inferred field types

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.create |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/import/parse_csv |
| MCP tool | import_parse_csv (records) |
| CLI | vyre import csv |
| Emits | none |

## Input

```ts
type In = {
  fileId?: string;
  text?: string;
  delimiter?: string;
  hasHeader?: boolean;
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

## Example

```json
{
  "name": "example",
  "input": {
    "delimiter": "e",
    "fileId": "fil_a1b2c3",
    "hasHeader": true,
    "text": "example"
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
