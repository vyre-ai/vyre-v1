# records.bulk_upsert

Create or update many records by match key, quietly (no automations unless asked)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | record (create under /type) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/bulk_upsert |
| MCP tool | records_bulk_upsert (records) |
| CLI | vyre records upsert |
| Emits | record.created, record.updated |

## Input

```ts
type In = {
  type: string;
  rows: Array<Record<string, unknown>>;
  match: Array<string>;
  runAutomations?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  created: number;
  updated: number;
  skipped: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "match": [
      "example"
    ],
    "rows": [
      {}
    ],
    "runAutomations": true,
    "type": "contact"
  },
  "output": {
    "created": 1,
    "skipped": 1,
    "updated": 1
  }
}
```
