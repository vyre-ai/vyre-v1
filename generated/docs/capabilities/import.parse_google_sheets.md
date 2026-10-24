# import.parse_google_sheets

Stage the tabs of a Google Sheet the connected account can open

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
| HTTP | POST /v1/import/parse_google_sheets |
| MCP tool | import_parse_google_sheets (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
  connectionId?: string;
  tabs?: Array<string>;
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
    "connectionId": "con_a1b2c3",
    "tabs": [
      "example"
    ],
    "url": "example"
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
