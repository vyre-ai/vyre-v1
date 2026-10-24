# google.sheets.get_values

Read a range of cells

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
| HTTP | POST /v1/google/sheets/get_values |
| MCP tool | google_sheets_get_values (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  spreadsheetId: string;
  range: string;
};
```

## Output

```ts
type Out = {
  values: Array<Array<string>>;
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
    "range": "Sheet1!A1:D50",
    "spreadsheetId": "example"
  },
  "output": {
    "values": [
      [
        "example"
      ]
    ]
  }
}
```
