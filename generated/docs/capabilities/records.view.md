# records.view

Read a saved view of a record type resolved for the table: the view definition and its rows with the saved filter, sort and group applied, a page at a time

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
| HTTP | POST /v1/records/view |
| MCP tool | records_view (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  viewId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  view: {
    viewId: string;
    type: string;
    kind: string;
    title: string;
    shared: boolean;
    filter?: unknown;
    sort?: unknown;
    group?: string;
    hidden?: Array<string>;
    colorRules?: unknown;
    config?: Record<string, unknown>;
    updatedAt: number;
  };
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
    "limit": 1,
    "type": "contact",
    "viewId": "viw_a1b2c3"
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
    "total": 1,
    "view": {
      "colorRules": {},
      "config": {},
      "filter": {},
      "group": "example",
      "hidden": [
        "example"
      ],
      "kind": "table",
      "shared": true,
      "sort": {},
      "title": "example",
      "type": "contact",
      "updatedAt": 1760000000000,
      "viewId": "viw_a1b2c3"
    }
  }
}
```
