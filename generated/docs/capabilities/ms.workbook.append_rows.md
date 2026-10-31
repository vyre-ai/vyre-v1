# ms.workbook.append_rows

Add rows under the last used row of a worksheet in an Excel workbook

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/workbook/append_rows |
| MCP tool | ms_workbook_append_rows (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  driveId?: string;
  itemId: string;
  sheet: string;
  values: Array<Array<unknown>>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  address: string;
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
    "driveId": "example",
    "idempotencyKey": "idem_1",
    "itemId": "example",
    "sheet": "example",
    "values": [
      [
        {}
      ]
    ]
  },
  "output": {
    "address": "example",
    "updatedRows": 1
  }
}
```
