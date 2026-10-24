# records.values.review

Accept or reject an agent-filled value; an accepted value counts, a rejected one is dropped and stays in history

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/records/values/review |
| MCP tool | records_values_review (records) |
| CLI | none |
| Emits | record.value_reviewed, record.updated |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  field: string;
  decision: "accept" | "reject";
  note?: string;
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
    "decision": "accept",
    "field": "example",
    "note": "example",
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
