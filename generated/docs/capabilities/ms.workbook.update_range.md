# ms.workbook.update_range

Write a block of cells in an Excel workbook; a single start cell grows to the size of the values

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
| HTTP | POST /v1/ms/workbook/update_range |
| MCP tool | ms_workbook_update_range (files, deferred) |
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
  range: string;
  values: Array<Array<unknown>>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  address: string;
  updatedCells: number;
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
    "range": "B2",
    "sheet": "example",
    "values": [
      [
        {}
      ]
    ]
  },
  "output": {
    "address": "example",
    "updatedCells": 1
  }
}
```
