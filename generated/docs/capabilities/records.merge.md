# records.merge

Merge records into a survivor with a value picked per field (undoable for 30 days)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.delete |
| Grant level | edit |
| Risk | medium |
| Resource | record (/survivorId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/records/merge |
| MCP tool | records_merge (records) |
| CLI | none |
| Emits | record.merged |

## Input

```ts
type In = {
  type: string;
  survivorId: string;
  mergedIds: Array<string>;
  picks: Record<string, string>;
};
```

## Output

```ts
type Out = {
  record: {
    id: string;
    type: string;
    version: number;
    label: number;
    fields: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number;
    holds: number;
  };
  undoUntil: number;
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
    "mergedIds": [
      "rec_a1b2c3"
    ],
    "picks": {},
    "survivorId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "record": {
      "createdAt": 1760000000000,
      "deletedAt": 1760000000000,
      "fields": {},
      "holds": 1,
      "id": "rec_a1b2c3",
      "label": 1,
      "type": "contact",
      "updatedAt": 1760000000000,
      "version": 1
    },
    "undoUntil": 1760000000000
  }
}
```
