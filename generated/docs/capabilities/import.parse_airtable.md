# import.parse_airtable

Stage the tables of an Airtable base using a key held in the Vault

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
| HTTP | POST /v1/import/parse_airtable |
| MCP tool | import_parse_airtable (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  baseUrl: string;
  key: string;
  tables?: Array<string>;
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
- provider.auth_failed
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "baseUrl": "https://airtable.com/appXXXXXXXX",
    "key": "#Dana_Lawmatics",
    "tables": [
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
