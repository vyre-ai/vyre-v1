# records.update

Update fields of a record (per-field merge for sync, base version for API callers)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/update |
| MCP tool | records_update (records) |
| CLI | none |
| Emits | record.updated, record.value_proposed |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  patch: Record<string, unknown>;
  baseVersion?: number;
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.field_locked
- validation.not_found
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "baseVersion": 1,
    "patch": {},
    "recordId": "rec_a1b2c3",
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
    }
  }
}
```
