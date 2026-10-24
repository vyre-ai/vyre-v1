# sheets.read_rows

Read rows from a sheet with a filter over column values

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
| HTTP | POST /v1/sheets/read_rows |
| MCP tool | sheets_read_rows (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  where?: unknown;
  columns?: Array<string>;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      rowId: string;
      values: Record<string, unknown>;
    }>;
  next?: string;
  total?: number;
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
    "columns": [
      "example"
    ],
    "cursor": "example",
    "fileId": "fil_a1b2c3",
    "limit": 1,
    "sheet": "example",
    "where": {}
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "rowId": "r_12",
        "values": {}
      }
    ],
    "total": 1
  }
}
```
