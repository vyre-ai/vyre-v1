# records.get_many

Read up to 200 records of one type by id in one call: each comes back as records.get gives it, with the fields the caller's grant, label and provider allow; an id that does not exist or that the caller may not see is simply not in the answer

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/get_many |
| MCP tool | records_get_many (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  ids: Array<string>;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      id: string;
      type: string;
      version: number;
      label: number;
      fields: Record<string, unknown>;
      createdAt: number;
      updatedAt: number;
      deletedAt?: number;
      holds: number;
      updating?: Array<string>;
      computedAt?: Record<string, unknown>;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "ids": [
      "rec_a1b2c3"
    ],
    "type": "contact"
  },
  "output": {
    "rows": [
      {
        "computedAt": {},
        "createdAt": 1760000000000,
        "deletedAt": 1760000000000,
        "fields": {},
        "holds": 1,
        "id": "rec_a1b2c3",
        "label": 1,
        "type": "contact",
        "updatedAt": 1760000000000,
        "updating": [
          "example"
        ],
        "version": 1
      }
    ]
  }
}
```
