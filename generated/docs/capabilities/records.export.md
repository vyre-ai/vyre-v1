# records.export

Export rows as CSV or Excel (permissioned), the whole view or only the picked recordIds

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.export |
| Grant level | view |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/records/export |
| MCP tool | records_export (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  format: "csv" | "xlsx";
  filter?: unknown;
  sort?: Array<{
      field: string;
      dir: "asc" | "desc";
    }>;
  group?: string;
  fields?: Array<string>;
  offset?: number;
  limit?: number;
  recordIds?: Array<string>;
};
```

## Output

```ts
type Out = {
  fileId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fields": [
      "example"
    ],
    "filter": {},
    "format": "csv",
    "group": "example",
    "limit": 1,
    "offset": 1,
    "recordIds": [
      "rec_a1b2c3"
    ],
    "sort": [
      {
        "dir": "asc",
        "field": "example"
      }
    ],
    "type": "contact"
  },
  "output": {
    "fileId": "fil_a1b2c3"
  }
}
```
