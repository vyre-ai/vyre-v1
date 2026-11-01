# mounts.sheet_read

Read cells of a mounted Google Sheet or Excel workbook from the provider, without downloading the file

| | |
|---|---|
| Module | mounts |
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
| HTTP | POST /v1/mounts/sheet_read |
| MCP tool | mounts_sheet_read (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  sheet?: string;
  range: string;
};
```

## Output

```ts
type Out = {
  values: Array<Array<unknown>>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
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
    "range": "A1:D20",
    "sheet": "example"
  },
  "output": {
    "values": [
      [
        {}
      ]
    ]
  }
}
```
