# records.restore_version

Restore a record to an earlier version

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/restore_version |
| MCP tool | records_restore_version (records) |
| CLI | none |
| Emits | record.updated |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  versionId: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "recordId": "rec_a1b2c3",
    "type": "contact",
    "versionId": "ver_a1b2c3"
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
