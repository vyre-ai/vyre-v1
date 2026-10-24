# google.sheets.append_values

Append rows to a sheet

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/sheets/append_values |
| MCP tool | google_sheets_append_values (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  spreadsheetId: string;
  range: string;
  values: Array<Array<string>>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  updatedRows: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1",
    "range": "example",
    "spreadsheetId": "example",
    "values": [
      [
        "example"
      ]
    ]
  },
  "output": {
    "updatedRows": 1
  }
}
```
