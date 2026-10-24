# google.sheets.get_spreadsheet

Spreadsheet metadata: sheets and ranges

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/sheets/get_spreadsheet |
| MCP tool | google_sheets_get_spreadsheet (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  spreadsheetId: string;
};
```

## Output

```ts
type Out = {
  title: string;
  sheets: Array<{
      sheetId: number;
      title: string;
      rows?: number;
      columns?: number;
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
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "spreadsheetId": "example"
  },
  "output": {
    "sheets": [
      {
        "columns": 1,
        "rows": 1,
        "sheetId": 1,
        "title": "example"
      }
    ],
    "title": "example"
  }
}
```
