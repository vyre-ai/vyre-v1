# records.query

Query rows of a record type with filter, sort, group and window

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/query |
| MCP tool | records_query (records) |
| CLI | vyre records query |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  filter?: unknown;
  sort?: Array<{
      field: string;
      dir: "asc" | "desc";
    }>;
  group?: string;
  fields?: Array<string>;
  offset?: number;
  limit?: number;
  cursor?: string;
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
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "fields": [
      "example"
    ],
    "filter": {},
    "group": "example",
    "limit": 1,
    "offset": 1,
    "sort": [
      {
        "dir": "asc",
        "field": "example"
      }
    ],
    "type": "contact"
  },
  "output": {
    "next": "example",
    "rows": [
      {
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
    ],
    "total": 1
  }
}
```
