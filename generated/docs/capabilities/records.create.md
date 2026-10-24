# records.create

Create a record

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
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/create |
| MCP tool | records_create (records) |
| CLI | vyre records create |
| Emits | record.created |

## Input

```ts
type In = {
  type: string;
  fields: Record<string, unknown>;
  idempotencyKey: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "fields": {},
    "idempotencyKey": "idem_1",
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
