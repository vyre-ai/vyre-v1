# records.update_many

Update a group of records of one type in one commit (the sync engine's sealed write-back)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/update_many |
| MCP tool | none |
| CLI | none |
| Emits | record.updated |

## Input

```ts
type In = {
  type: string;
  items: Array<{
      recordId: string;
      patch: Record<string, unknown>;
      baseVersion?: number;
    }>;
};
```

## Output

```ts
type Out = {
  results: Array<{
      recordId: string;
      record?: {
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
      error?: {
        code: string;
        message: string;
        reason?: string;
      };
    }>;
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
    "items": [
      {
        "baseVersion": 1,
        "patch": {},
        "recordId": "rec_a1b2c3"
      }
    ],
    "type": "contact"
  },
  "output": {
    "results": [
      {
        "error": {
          "code": "example",
          "message": "example",
          "reason": "example"
        },
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
        "recordId": "rec_a1b2c3"
      }
    ]
  }
}
```
