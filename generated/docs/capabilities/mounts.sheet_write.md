# mounts.sheet_write

Write cells of a mounted Google Sheet or Excel workbook in the provider file itself

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | file (/fileId) |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mounts/sheet_write |
| MCP tool | mounts_sheet_write (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  range: string;
  values: Array<Array<unknown>>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  updatedCells: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed
- validation.unsupported

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "range": "B2",
    "sheet": "example",
    "values": [
      [
        {}
      ]
    ]
  },
  "output": {
    "updatedCells": 1
  }
}
```
